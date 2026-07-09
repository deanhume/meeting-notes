/* ── On-device speech-to-text (renderer) ──────────────────────
 * Transcribes 16 kHz mono PCM to text entirely on the user's machine using
 * Transformers.js + ONNX Runtime Web. Runs on the GPU via WebGPU where the
 * hardware/driver support it, and transparently falls back to the WASM CPU
 * backend everywhere else — so recording always works, just faster on modern GPUs.
 *
 * Why the renderer (not the Electron main process)? WebGPU only exists in the
 * Chromium renderer, so the model must run here. Audio is already captured in the
 * renderer, so no large buffers cross the IPC boundary.
 *
 * Fully offline: the Transformers.js runtime, the ONNX Runtime WASM binaries, and
 * the quantised (q4) Whisper-small.en model are all bundled with the app and
 * served locally. Nothing is ever fetched from the network. (`npm run fetch-model`
 * populates public/models/ before packaging.)
 *
 * dtype note: q4 is used deliberately. fp16 whisper on WebGPU throws a numeric
 * ONNX Runtime WASM abort during session creation; q4 is fast, accurate, and the
 * smallest weight set (~290 MB).
 *
 * This is an ES module (it imports Transformers.js). It exposes its API on
 * `window.rendererTranscription` so the classic-script app.js can call it.
 */

import { pipeline, env } from '/vendor/transformers/transformers.js';

// ── Offline configuration ─────────────────────────────────────
// Never touch the Hugging Face hub: load the model from the app's own static
// server and the ORT WASM binaries from the vendored copy.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/models/';
env.backends.onnx.wasm.wasmPaths = '/vendor/transformers/';

const MODEL_ID = 'whisper-small.en';
const DTYPE = 'q4';

let transcriber = null;      // Resident ASR pipeline (loaded once, kept in memory)
let loadingPromise = null;   // De-duplicates concurrent load attempts
let backend = null;          // 'webgpu' | 'wasm' once loaded

// Whether the browser exposes a usable WebGPU adapter. Cached after first probe.
let webgpuSupported = null;
async function hasWebGPU() {
  if (webgpuSupported !== null) return webgpuSupported;
  webgpuSupported = false;
  try {
    if (navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      webgpuSupported = !!adapter;
    }
  } catch (_) {
    webgpuSupported = false;
  }
  return webgpuSupported;
}

// Build (once) the ASR pipeline, preferring WebGPU and falling back to WASM.
async function load() {
  if (transcriber) return transcriber;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const useGpu = await hasWebGPU();
    const device = useGpu ? 'webgpu' : 'wasm';
    try {
      transcriber = await pipeline('automatic-speech-recognition', MODEL_ID, { device, dtype: DTYPE });
      backend = device;
    } catch (err) {
      // WebGPU init can fail on some drivers even when an adapter is reported —
      // fall back to CPU so transcription still works.
      if (device !== 'webgpu') throw err;
      console.warn('WebGPU transcription init failed, falling back to WASM CPU:', err);
      transcriber = await pipeline('automatic-speech-recognition', MODEL_ID, { device: 'wasm', dtype: DTYPE });
      backend = 'wasm';
    }
    console.log(`On-device transcription ready (backend: ${backend}).`);
    return transcriber;
  })();

  try {
    return await loadingPromise;
  } catch (err) {
    transcriber = null;
    backend = null;
    throw err;
  } finally {
    loadingPromise = null;
  }
}

/**
 * Transcribe 16 kHz mono PCM samples to raw text.
 * @param {Float32Array} pcm - mono Float32 samples at 16 kHz
 * @returns {Promise<string>} raw (un-cleaned) transcribed text
 */
async function transcribe(pcm) {
  if (!pcm || pcm.length === 0) return '';
  const asr = await load();
  // whisper-small.en is English-only, so no language/task options are passed.
  // Chunking mirrors the previous engine: 30s windows with 5s stride overlap.
  const out = await asr(pcm, {
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: false,
  });
  return ((out && out.text) || '').trim();
}

window.rendererTranscription = {
  // Whether on-device transcription can run here (Transformers.js loaded fine).
  isAvailable: () => true,
  // Kick off model loading ahead of first use (e.g. when recording starts).
  warmup: () => load().catch((e) => console.warn('Transcription warmup failed:', e)),
  transcribe,
  getBackend: () => backend,
  hasWebGPU,
};

// This module is deferred (it imports Transformers.js), so it finishes loading
// after app.js has already run. Announce readiness so app.js can reveal the
// Record button once the engine is available, rather than racing the load.
window.dispatchEvent(new Event('rendererTranscriptionReady'));
