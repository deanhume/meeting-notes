/**
 * Local speech-to-text for the Meeting Notes app (Electron main process only).
 * Wraps smart-whisper (whisper.cpp). The model is loaded lazily on first use
 * and kept resident for subsequent transcriptions.
 *
 * Transcription runs on-device — no audio ever leaves the machine.
 */

const fs = require('fs');
const path = require('path');

const MODEL_FILENAME = 'ggml-base.bin';

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

/**
 * Transcribe 16kHz mono PCM samples to text.
 * @param {Float32Array} pcm - mono Float32 samples at 16kHz
 * @param {object} app - the Electron app object (for path resolution)
 * @returns {Promise<string>} the transcribed text
 */
async function transcribePcm(pcm, app) {
  if (!pcm || pcm.length === 0) {
    throw new Error('No audio captured');
  }
  const w = await getWhisper(app);
  const task = await w.transcribe(pcm, { language: 'auto' });
  const result = await task.result;
  return result.map((segment) => segment.text).join('').trim();
}

module.exports = {
  MODEL_FILENAME,
  resolveModelPath,
  isModelAvailable,
  transcribePcm,
};
