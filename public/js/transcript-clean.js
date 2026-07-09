/* ── Whisper transcript cleanup ───────────────────────────────
 * Pure, dependency-free text post-processing for raw Whisper output.
 *
 * Whisper decodes speech verbatim, including hesitation fillers, non-speech
 * annotations ("[BLANK_AUDIO]", "(background noise)"), and repetition
 * hallucinations. These helpers tidy a single decoded chunk (cleanTranscript)
 * and finalise the accumulated transcript before summarising (finalizeTranscript).
 *
 * This module is shared by the browser (loaded as a global before app.js, where
 * transcription now runs on-device via Transformers.js/WebGPU) and by Node — the
 * Electron main process (finalizeTranscript for `transcript-read`) and the Jest
 * suite both require it as a CommonJS module. It performs no DOM or I/O work.
 *
 * Chunk cleanup pipeline (cleanTranscript):
 *   1. stripNonSpeech — remove [BLANK_AUDIO], (background noise), ♪ music ♪, etc.
 *   2. removeFillers — drop "um", "uh", "erm" and similar hesitation words
 *   3. collapseRepeats — deduplicate stuttered/hallucinated repetitions
 *   4. normalizeWhitespace — fix spacing around punctuation
 *   5. toSentenceLines — split into one sentence per line for the summariser
 */

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

// ── Whole-transcript finalisation (for summarisation) ─────────
// cleanTranscript above tidies a single Whisper chunk. finalizeTranscript runs
// over the *accumulated* transcript once recording has produced many chunks, to
// undo two artefacts that hurt the summariser:
//   1. Every appended chunk is force-terminated with a "." (see transcript-append),
//      so utterances Whisper split across audio windows become false sentence
//      boundaries. We re-join fragments that clearly trail off mid-thought.
//   2. Conversational backchannel ("Yeah.", "Exactly.", "Bye.") floods the
//      transcript and dilutes TextRank centrality. We drop backchannel-only lines.
// It is deliberately conservative (merges at most two adjacent fragments, only on
// high-confidence continuation cues) so it never fabricates run-on sentences.

// A line made up solely of these acknowledgement words carries no meeting content.
const BACKCHANNEL_WORDS = new Set(('yeah yes yep yup no nope nah ok okay k right exactly sure cool nice '
  + 'great good fine thanks thank you bye goodbye cheers absolutely alright wow oh oops hmm mhm mmhm '
  + 'huh haha lol well so um uh er erm ah eh definitely totally agreed correct indeed maybe perhaps '
  + 'hello hi hey mate man guys please welcome').split(/\s+/));

// A connective/pronoun a chunk tends to end on when one sentence was split across
// two audio windows ("...I can't" + "risk this"). Used to re-join those fragments.
const CONTINUATION_WORD = new Set(('and but so or to with of in on for that because the a an is are was '
  + 'were will would can cant cannot could should i we you he she they my our your this these those '
  + 'if when then at as by from into over after before about').split(/\s+/));

function isBackchannelLine(line) {
  const words = line.toLowerCase().match(/[a-z']+/g) || [];
  if (words.length === 0) return true;
  return words.every((w) => BACKCHANNEL_WORDS.has(w));
}

function stripTerminalPunct(s) {
  const out = s.replace(/["')\]]*\s*[.!?]+["')\]]*\s*$/, '').trim();
  return out || s.trim();
}

function lastWordOf(s) {
  const m = s.toLowerCase().match(/[a-z']+/g);
  return m ? m[m.length - 1].replace(/'/g, '') : '';
}

// A fragment should be merged into the previous one when the previous fragment
// clearly hasn't finished — it ends on a comma/semicolon or a dangling connective.
function isIncompleteFragment(prev) {
  const core = stripTerminalPunct(prev);
  if (/[,;:]$/.test(core)) return true;
  return CONTINUATION_WORD.has(lastWordOf(core));
}

function finalizeTranscript(text) {
  if (!text) return '';
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !isBackchannelLine(l));

  const merged = [];
  let run = 0; // consecutive merges onto the current tail — capped so we never
  //             chain more than two fragments into one sentence.
  for (const line of lines) {
    if (merged.length && run < 1 && isIncompleteFragment(merged[merged.length - 1])) {
      const tail = stripTerminalPunct(merged[merged.length - 1]).replace(/[,;:]$/, '');
      merged[merged.length - 1] = `${tail} ${line}`;
      run += 1;
    } else {
      merged.push(line);
      run = 0;
    }
  }

  let out = merged.join(' ');
  out = collapseRepeats(out);
  out = normalizeWhitespace(out);
  return toSentenceLines(out);
}

/**
 * Full cleanup pipeline: apply all post-processing steps to raw Whisper output.
 * Exported so it can be unit-tested without loading any speech-to-text engine.
 */
function cleanTranscript(text) {
  if (!text) return '';
  let out = stripNonSpeech(text);
  out = removeFillers(out);
  out = collapseRepeats(out);
  out = normalizeWhitespace(out);
  return toSentenceLines(out);
}

// Dual export: attach to the browser global scope, and expose for CommonJS
// (Electron main + Jest) without breaking when `module` is undefined in the renderer.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    stripNonSpeech,
    removeFillers,
    collapseRepeats,
    normalizeWhitespace,
    toSentenceLines,
    cleanTranscript,
    finalizeTranscript,
  };
}
