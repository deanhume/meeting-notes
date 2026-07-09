/**
 * Speech-to-text support helpers for the Electron main process.
 *
 * Transcription itself no longer runs here. It runs in the renderer via
 * Transformers.js + ONNX Runtime Web (WebGPU, with a WASM CPU fallback) — see
 * public/js/transcriber.js. WebGPU only exists in the Chromium renderer, so the
 * model must run there, and the audio is already captured there.
 *
 * This module keeps the main-process concerns that remain:
 *   - isModelAvailable: does the bundled ONNX model exist? (gates the Record button)
 *   - cleanTranscript / finalizeTranscript: pure text cleanup, re-exported from the
 *     shared dual-mode module so `transcript-read` (main) and the Jest suite can
 *     use them without pulling in any browser globals.
 *
 * Privacy: transcription runs entirely on-device. No audio ever leaves the machine.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { cleanTranscript, finalizeTranscript } = require('./public/js/transcript-clean');

// ── Model resolution ─────────────────────────────────────────
// The quantised (q4) Whisper-small.en ONNX model is bundled and served to the
// renderer as static files. Its location differs between dev and packaged builds:
//   - dev:      public/models/whisper-small.en/... (inside the project)
//   - packaged: <resources>/models/whisper-small.en/... (shipped via extraResources,
//               kept OUT of the asar to keep the archive small)
// The decoder weight is the largest piece, so its presence is a reliable proxy for
// "the model is installed".
const MODEL_REL_PATH = path.join('whisper-small.en', 'onnx', 'decoder_model_merged_q4.onnx');

// Resolve the model file for the current runtime. `app` is Electron's app module;
// when packaged the model lives under process.resourcesPath/models, otherwise it
// sits in the project's public/models directory (same path the static host serves).
function modelPath(app) {
  const modelsRoot = app && app.isPackaged
    ? path.join(process.resourcesPath, 'models')
    : path.join(__dirname, 'public', 'models');
  return path.join(modelsRoot, MODEL_REL_PATH);
}

// Speech-to-text is available when the bundled model file is present.
function isModelAvailable(app) {
  return fs.existsSync(modelPath(app));
}

// ── CPU / thread tuning (retained helper) ────────────────────
// Default to ~75% of logical cores but always leave at least 1 free for the UI/OS.
const LOGICAL_CORES = Math.max(1, os.cpus().length);
const DEFAULT_THREADS = Math.max(
  1,
  Math.min(LOGICAL_CORES - 1, Math.round(LOGICAL_CORES * 0.75))
);

// Resolve a thread count: an explicit positive integer (clamped to the core
// count), otherwise the default heuristic.
function computeThreads(requested) {
  const n = Number(requested);
  if (Number.isInteger(n) && n >= 1) return Math.min(n, LOGICAL_CORES);
  return DEFAULT_THREADS;
}

module.exports = {
  isModelAvailable,
  computeThreads,
  cleanTranscript,
  finalizeTranscript,
};
