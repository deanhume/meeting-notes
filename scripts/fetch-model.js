/**
 * Downloads a Whisper speech-to-text model used for local transcription.
 * Models are intentionally NOT committed to git (they range from ~75 MB to
 * ~466 MB). Run this once after cloning: `npm run fetch-model` for the default
 * (base) model, or pick another tier: `npm run fetch-model -- small`.
 */

const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';
// Keep in sync with the MODELS registry in transcription.js.
const MODELS = {
  tiny: 'ggml-tiny.en.bin',
  base: 'ggml-base.bin',
  small: 'ggml-small.en.bin',
};
const DEFAULT_KEY = 'base';

const key = (process.argv[2] || DEFAULT_KEY).toLowerCase();
const MODEL_FILENAME = MODELS[key];
if (!MODEL_FILENAME) {
  console.error(`Unknown model "${key}". Choose one of: ${Object.keys(MODELS).join(', ')}`);
  process.exit(1);
}
const MODEL_URL = `${MODEL_BASE_URL}${MODEL_FILENAME}`;
const destDir = path.join(__dirname, '..', 'models');
const destPath = path.join(destDir, MODEL_FILENAME);

async function main() {
  if (fs.existsSync(destPath)) {
    console.log(`${MODEL_FILENAME} already present at ${destPath}`);
    return;
  }

  fs.mkdirSync(destDir, { recursive: true });
  console.log(`Downloading ${MODEL_FILENAME} from ${MODEL_URL} …`);

  const res = await fetch(MODEL_URL); // follows redirects automatically
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }

  const tmpPath = `${destPath}.tmp`;
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmpPath));
  fs.renameSync(tmpPath, destPath);

  const mb = (fs.statSync(destPath).size / 1024 / 1024).toFixed(1);
  console.log(`Saved ${MODEL_FILENAME} (${mb} MB) to ${destPath}`);
}

main().catch((err) => {
  console.error(`fetch-model failed: ${err.message}`);
  process.exit(1);
});
