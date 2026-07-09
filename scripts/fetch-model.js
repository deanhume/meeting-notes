/**
 * Downloads the Whisper speech-to-text model used for local transcription.
 * The model (ggml-small.en.bin, ~466 MB) is intentionally NOT committed to git.
 * Run this once after cloning, and before building the installer: `npm run fetch-model`.
 * The build bundles this file into the app so end users never download anything.
 */

const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const MODEL_FILENAME = 'ggml-small.en.bin';
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_FILENAME}`;
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
