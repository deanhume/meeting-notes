/**
 * Prepares the on-device speech-to-text assets used for local transcription.
 *
 * The app transcribes speech in the renderer with Transformers.js + ONNX Runtime
 * Web (WebGPU where available, WASM CPU otherwise). This script:
 *   1. Vendors the Transformers.js runtime + the ORT `asyncify` WASM binary out of
 *      node_modules into `public/vendor/transformers/` (so the app can load them
 *      locally with no bundler and no network).
 *   2. Fetches the quantised (q4) ONNX build of Whisper small (English-only) from
 *      the Hugging Face hub into `public/models/whisper-small.en/`, laid out exactly
 *      the way Transformers.js expects to load a *local* model.
 *
 * Neither the model (~290 MB) nor the vendored runtime is committed to git. Run
 * this once after cloning and before building the installer: `npm run fetch-model`.
 * The build bundles everything into the app so end users never download anything.
 */

const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const REPO = 'onnx-community/whisper-small.en';
const BASE_URL = `https://huggingface.co/${REPO}/resolve/main/`;
const publicDir = path.join(__dirname, '..', 'public');
const modelDir = path.join(publicDir, 'models', 'whisper-small.en');
const vendorDir = path.join(publicDir, 'vendor', 'transformers');
const nodeModules = path.join(__dirname, '..', 'node_modules');

const CHECK = '\u2713';

// Files Transformers.js needs to load this model locally with dtype `q4`.
// Only the q4 ONNX weights are fetched (fp16 is broken on WebGPU; the full-size
// variants are unnecessary), keeping the download to the essential ~290 MB.
const MODEL_FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'vocab.json',
  'merges.txt',
  'added_tokens.json',
  'special_tokens_map.json',
  'normalizer.json',
  'onnx/encoder_model_q4.onnx',
  'onnx/decoder_model_merged_q4.onnx',
];

// Runtime files copied verbatim from node_modules. The renderer loads these via an
// import map (see public/index.html); the ORT `asyncify` WASM covers both the
// WebGPU and WASM-CPU execution paths.
const VENDOR_COPIES = [
  { from: '@huggingface/transformers/dist/transformers.web.min.js', to: 'transformers.js' },
  { from: 'onnxruntime-web/dist/ort.webgpu.bundle.min.mjs', to: 'ort.webgpu.bundle.min.mjs' },
  { from: 'onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs', to: 'ort-wasm-simd-threaded.asyncify.mjs' },
  { from: 'onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm', to: 'ort-wasm-simd-threaded.asyncify.wasm' },
];

function vendorRuntime() {
  console.log(`Vendoring Transformers.js runtime into ${vendorDir} ...`);
  fs.mkdirSync(vendorDir, { recursive: true });

  for (const { from, to } of VENDOR_COPIES) {
    const src = path.join(nodeModules, from);
    if (!fs.existsSync(src)) {
      throw new Error(`Missing ${from} - run \`npm install\` first.`);
    }
    fs.copyFileSync(src, path.join(vendorDir, to));
    console.log(`  ${CHECK} ${to}`);
  }

  // onnxruntime-common ESM (a small multi-file tree imported by name via the map).
  const commonSrc = path.join(nodeModules, 'onnxruntime-common', 'dist', 'esm');
  const commonDst = path.join(vendorDir, 'ort-common');
  fs.mkdirSync(commonDst, { recursive: true });
  for (const f of fs.readdirSync(commonSrc)) {
    if (f.endsWith('.js')) fs.copyFileSync(path.join(commonSrc, f), path.join(commonDst, f));
  }
  console.log(`  ${CHECK} ort-common/`);
}

async function fetchFile(relPath) {
  const destPath = path.join(modelDir, relPath);
  if (fs.existsSync(destPath)) {
    console.log(`  ${CHECK} ${relPath} (already present)`);
    return;
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  const url = BASE_URL + relPath;
  const res = await fetch(url); // follows redirects automatically
  if (!res.ok || !res.body) {
    throw new Error(`Download failed for ${relPath}: ${res.status} ${res.statusText}`);
  }

  const tmpPath = `${destPath}.tmp`;
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmpPath));
  fs.renameSync(tmpPath, destPath);

  const mb = (fs.statSync(destPath).size / 1024 / 1024).toFixed(1);
  console.log(`  ${CHECK} ${relPath} (${mb} MB)`);
}

async function main() {
  vendorRuntime();
  console.log(`Fetching ${REPO} (q4) into ${modelDir} ...`);
  for (const relPath of MODEL_FILES) {
    await fetchFile(relPath);
  }
  console.log('Transcription assets ready.');
}

main().catch((err) => {
  console.error(`fetch-model failed: ${err.message}`);
  process.exit(1);
});
