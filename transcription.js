/**
 * Local speech-to-text for the Meeting Notes app (Electron main process only).
 * Wraps smart-whisper (whisper.cpp). The model is loaded lazily on first use
 * and kept resident for subsequent transcriptions.
 *
 * Transcription runs on-device — no audio ever leaves the machine.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const MODEL_FILENAME = 'ggml-base.bin';

// Pick a thread count that keeps each transcribe call fast WITHOUT pinning the
// whole machine. Using every logical core (whisper.cpp's behaviour when given
// os.cpus().length) drives the CPU to ~100% and, because of hyper-thread
// contention, yields little speed-up past the physical core count anyway.
//
// Thread count changes only throughput, never the decoded output (results are
// deterministic for a given audio buffer), so leaving headroom does not affect
// transcription accuracy. We target ~75% of logical cores and always leave at
// least one core free for the UI / OS, with a floor of 1 thread.
const LOGICAL_CORES = Math.max(1, os.cpus().length);
const N_THREADS = Math.max(
  1,
  Math.min(LOGICAL_CORES - 1, Math.round(LOGICAL_CORES * 0.75))
);

let whisper = null;       // resident Whisper instance
let loadingPromise = null; // de-dupe concurrent loads

// Resolve the bundled model path: ./models in dev, resourcesPath when packaged.
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

// Hesitation / filler words Whisper transcribes verbatim. Matched whole-word and
// case-insensitively (and with any trailing run of the same vowel, e.g. "uhhh").
// Note: the bare "m" filler requires 2+ m's (m{2,}) so it never strips the "m"
// from contractions like "I'm".
const FILLER_PATTERN = /\b(?:u+m+|u+h+|e+r+m?|a+h+|e+h+|h+m+|m+h+m+|m{2,}|uh[\s-]?huh)\b[,]?/gi;

// Non-speech annotations Whisper emits on noise/silence, e.g. "[BLANK_AUDIO]",
// "(background noise)", "*laughs*", "♪ music ♪".
const NON_SPEECH_PATTERN = /[\[(*][^\])*]*[\])*]|[♪♫]+/g;

// Strip bracketed/parenthesised non-speech markers and musical-note glyphs.
function stripNonSpeech(text) {
  return text.replace(NON_SPEECH_PATTERN, ' ');
}

// Drop standalone filler/hesitation words ("um", "uh", "erm", "hmm"…).
function removeFillers(text) {
  return text.replace(FILLER_PATTERN, ' ');
}

// Collapse Whisper's repetition hallucinations: immediately repeated words
// ("the the the" → "the") and back-to-back repeated short phrases
// ("thank you thank you" → "thank you"). Runs to a fixed point so long loops
// fully collapse.
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

// Tidy spacing: no space before punctuation, single spaces, trimmed.
function normalizeWhitespace(text) {
  return text
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Put each sentence on its own line. Whisper-base sometimes omits terminal
// punctuation, so a fallback keeps any trailing unpunctuated remainder.
function toSentenceLines(text) {
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*|\S[^.!?]*$/g);
  if (!sentences) return text;
  return sentences.map((s) => s.trim()).filter(Boolean).join('\n');
}

// Clean a raw Whisper transcript: remove non-speech markers and filler words,
// collapse repetition loops, normalise whitespace, and split into one sentence
// per line. Exported for unit testing (no native addon required).
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
