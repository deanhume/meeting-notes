/**
 * Local speech-to-text for the Meeting Notes app (Electron main process only).
 *
 * Wraps smart-whisper (whisper.cpp compiled to a Node native addon).
 * The Whisper model is loaded lazily on first transcription request and kept
 * resident in memory for subsequent calls — avoids the ~2s model load on every chunk.
 *
 * Privacy: transcription runs entirely on-device. No audio data ever leaves the machine.
 *
 * Post-processing pipeline (applied after Whisper decodes):
 *   1. stripNonSpeech — remove [BLANK_AUDIO], (background noise), ♪ music ♪, etc.
 *   2. removeFillers — drop "um", "uh", "erm" and similar hesitation words
 *   3. collapseRepeats — deduplicate stuttered/hallucinated repetitions
 *   4. normalizeWhitespace — fix spacing around punctuation
 *   5. toSentenceLines — split into one sentence per line for the summariser
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const MODEL_FILENAME = 'ggml-base.bin'; // ~140MB Whisper "base" model

// ── Thread count tuning ──────────────────────────────────────
// Use ~75% of logical cores but always leave at least 1 free for the UI/OS.
// More threads than physical cores yields diminishing returns due to
// hyper-thread contention, and pinning 100% CPU makes the app feel unresponsive.
const LOGICAL_CORES = Math.max(1, os.cpus().length);
const N_THREADS = Math.max(
  1,
  Math.min(LOGICAL_CORES - 1, Math.round(LOGICAL_CORES * 0.75))
);

let whisper = null;        // Resident Whisper instance (loaded once, stays in memory)
let loadingPromise = null; // De-duplicates concurrent load attempts

// ── Model path resolution ────────────────────────────────────
// In dev mode the model is at ./models/; when packaged it's in the app's resources.

function resolveModelPath(app) {
  if (app && app.isPackaged) {
    return path.join(process.resourcesPath, 'models', MODEL_FILENAME);
  }
  return path.join(__dirname, 'models', MODEL_FILENAME);
}

function isModelAvailable(app) {
  return fs.existsSync(resolveModelPath(app));
}

async function getWhisper(app) {
  if (whisper) return whisper;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const modelPath = resolveModelPath(app);
    if (!fs.existsSync(modelPath)) {
      throw new Error(`Speech-to-text model not found at ${modelPath}`);
    }
    // Lazy require so the native addon only loads when transcription is used.
    const { Whisper } = require('smart-whisper');
    whisper = new Whisper(modelPath, { gpu: false });
    return whisper;
  })();

  try {
    return await loadingPromise;
  } catch (err) {
    whisper = null;
    throw err;
  } finally {
    loadingPromise = null;
  }
}

// ── Transcript cleanup patterns ───────────────────────────────

// Hesitation / filler words Whisper transcribes verbatim.
// Matched whole-word, case-insensitive. The "m{2,}" avoids stripping the "m" in "I'm".
const FILLER_PATTERN = /\b(?:u+m+|u+h+|e+r+m?|a+h+|e+h+|h+m+|m+h+m+|m{2,}|uh[\s-]?huh)\b[,]?/gi;

// Non-speech annotations Whisper emits (e.g. "[BLANK_AUDIO]", "(background noise)", "♪ music ♪")
const NON_SPEECH_PATTERN = /[\[(*][^\])*]*[\])*]|[♪♫]+/g;

// ── Cleanup functions (each handles one type of noise) ────────

function stripNonSpeech(text) {
  return text.replace(NON_SPEECH_PATTERN, ' ');
}

function removeFillers(text) {
  return text.replace(FILLER_PATTERN, ' ');
}

// Collapse Whisper's repetition hallucinations (e.g. "the the the" → "the").
// Runs to a fixed point so even long loops fully collapse.
function collapseRepeats(text) {
  let prev;
  do {
    prev = text;
    text = text.replace(/\b([\w']+)(?:\s+\1\b)+/gi, '$1');
  } while (text !== prev);
  do {
    prev = text;
    text = text.replace(/\b((?:[\w']+\s+){1,5}[\w']+)(?:[\s,.;:!?-]+\1\b)+/gi, '$1');
  } while (text !== prev);
  return text;
}

// Tidy spacing: no space before punctuation, collapse multiple spaces, trim
function normalizeWhitespace(text) {
  return text
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Split text into one sentence per line (the format the summariser expects)
function toSentenceLines(text) {
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*|\S[^.!?]*$/g);
  if (!sentences) return text;
  return sentences.map((s) => s.trim()).filter(Boolean).join('\n');
}

/**
 * Full cleanup pipeline: apply all post-processing steps to raw Whisper output.
 * Exported so it can be unit-tested without loading the native Whisper addon.
 */
function cleanTranscript(text) {
  if (!text) return '';
  let out = stripNonSpeech(text);
  out = removeFillers(out);
  out = collapseRepeats(out);
  out = normalizeWhitespace(out);
  return toSentenceLines(out);
}

/**
 * Transcribe 16kHz mono PCM samples to text.
 * @param {Float32Array} pcm - mono Float32 samples at 16kHz
 * @param {object} app - the Electron app object (for path resolution)
 * @returns {Promise<string>} the transcribed, cleaned text (one sentence per line)
 */
async function transcribePcm(pcm, app) {
  if (!pcm || pcm.length === 0) {
    throw new Error('No audio captured');
  }
  const w = await getWhisper(app);
  const task = await w.transcribe(pcm, {
    // Fix the language to English (skips Whisper's language-detection pass) and
    // use all available cores — both shave time off each transcription.
    language: 'en',
    n_threads: N_THREADS,
    // Don't condition on previously decoded text: each chunk decodes independently,
    // which stops hallucinated phrases from snowballing into repetition loops.
    no_context: true,
    // Suppress blank and non-speech tokens (e.g. "[noise]", hesitation markers).
    suppress_blank: true,
    suppress_non_speech_tokens: true,
    // Quality gates: skip near-silent windows and reject degenerate (repeating /
    // low-confidence) decodes, falling back via temperature rather than emitting junk.
    no_speech_thold: 0.6,
    entropy_thold: 2.4,
    logprob_thold: -1.0,
    temperature: 0,
    temperature_inc: 0.2,
  });
  const result = await task.result;
  const raw = result.map((segment) => segment.text).join(' ');
  return cleanTranscript(raw);
}

module.exports = {
  MODEL_FILENAME,
  resolveModelPath,
  isModelAvailable,
  transcribePcm,
  cleanTranscript,
};
