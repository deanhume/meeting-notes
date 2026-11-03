const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const asar = require('@electron/asar');
const {
  MODEL_FILES,
  SPEAKER_MODELS,
  SPEAKER_MODEL_FILES,
  VENDOR_COPIES,
  modelDir,
  vendorDir,
} = require('./fetch-model');

const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const packageJson = require(path.join(rootDir, 'package.json'));

function fail(message) {
  throw new Error(message);
}

function requireFile(filePath, minimumBytes = 1) {
  if (!fs.existsSync(filePath)) {
    fail(`Missing required release file: ${path.relative(rootDir, filePath)}`);
  }
  const size = fs.statSync(filePath).size;
  if (size < minimumBytes) {
    fail(`Release file is unexpectedly small (${size} bytes): ${path.relative(rootDir, filePath)}`);
  }
}

function verifyTag() {
  const tag = process.env.RELEASE_TAG;
  if (!tag) return;
  const tagVersion = tag.startsWith('v') ? tag.slice(1) : tag;
  if (tagVersion !== packageJson.version) {
    fail(`Release tag ${tag} does not match package.json version ${packageJson.version}`);
  }
}

function verifyDependencies() {
  const windows = process.platform === 'win32';
  const command = windows ? (process.env.ComSpec || 'cmd.exe') : 'npm';
  const args = windows
    ? ['/d', '/s', '/c', 'npm ls --omit=dev --depth=0']
    : ['ls', '--omit=dev', '--depth=0'];
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const detail = (result.stdout || result.stderr || result.error?.message || '').trim();
    fail(`Production dependencies are incomplete.\n${detail}`);
  }
}

function verifyTranscriptionAssets(baseModelDir = modelDir, baseVendorDir = vendorDir) {
  for (const relativePath of MODEL_FILES) {
    const minimumBytes = relativePath.endsWith('.onnx') ? 10 * 1024 * 1024 : 1;
    requireFile(path.join(baseModelDir, relativePath), minimumBytes);
  }
  verifySpeakerAssets(path.dirname(baseModelDir));
  requireFile(path.join(rootDir, 'public', 'speaker-model-notices.txt'));
  for (const { to } of VENDOR_COPIES) {
    requireFile(path.join(baseVendorDir, to));
  }
  requireFile(path.join(baseVendorDir, 'ort-common', 'env-impl.js'));
}

function verifySpeakerAssets(modelsRoot) {
  for (const { name } of SPEAKER_MODELS) {
    for (const file of [...SPEAKER_MODEL_FILES, 'LICENSE.txt']) {
      requireFile(path.join(modelsRoot, name, file), file.endsWith('.onnx') ? 1024 * 1024 : 1);
    }
  }
}

function sha512Base64(filePath) {
  return crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('base64');
}

function readManifestValue(manifest, key) {
  const match = manifest.match(new RegExp(`^${key}:\\s*(.+)\\s*$`, 'm'));
  if (!match) fail(`latest.yml does not contain ${key}`);
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}

function verifyPackagedModules(asarPath) {
  const packagedFiles = new Set(asar.listPackage(asarPath).map((file) => file.replace(/\\/g, '/')));
  for (const dependency of Object.keys(packageJson.dependencies)) {
    const packagePath = `/node_modules/${dependency}/package.json`;
    if (!packagedFiles.has(packagePath)) {
      fail(`Packaged app is missing production dependency: ${dependency}`);
    }
  }
  for (const file of ['main.js', 'preload.js', 'shared.js', 'transcription.js', 'transcript-file.js']) {
    if (!packagedFiles.has(`/${file}`)) {
      fail(`Packaged app is missing application module: ${file}`);
    }
  }
  for (const { to } of VENDOR_COPIES) {
    const vendorPath = `/public/vendor/transformers/${to}`;
    if (!packagedFiles.has(vendorPath)) {
      fail(`Packaged app is missing transcription runtime: ${to}`);
    }
  }
  if (!packagedFiles.has('/public/vendor/transformers/ort-common/env-impl.js')) {
    fail('Packaged app is missing the ONNX Runtime common modules');
  }
  for (const file of ['diarizer.js', 'speaker-labels.js']) {
    if (!packagedFiles.has(`/public/js/${file}`)) {
      fail(`Packaged app is missing speaker-labeling runtime: ${file}`);
    }
  }
  if (!packagedFiles.has('/public/speaker-model-notices.txt')) {
    fail('Packaged app is missing speaker model attribution');
  }
}

function verifyPrebuild() {
  verifyTag();
  verifyDependencies();
  verifyTranscriptionAssets();
  console.log('Release pre-build checks passed.');
}

function verifyPostbuild() {
  const artifactName = `Meeting-Notes-Setup-${packageJson.version}.exe`;
  const installerPath = path.join(distDir, artifactName);
  const blockmapPath = `${installerPath}.blockmap`;
  const manifestPath = path.join(distDir, 'latest.yml');
  const asarPath = path.join(distDir, 'win-unpacked', 'resources', 'app.asar');

  requireFile(installerPath, 1024 * 1024);
  requireFile(blockmapPath);
  requireFile(manifestPath);
  requireFile(asarPath);

  const manifest = fs.readFileSync(manifestPath, 'utf8');
  const manifestPathValue = readManifestValue(manifest, 'path');
  const manifestUrl = readManifestValue(manifest, '\\s+- url');
  const manifestHash = readManifestValue(manifest, 'sha512');

  if (manifestPathValue !== artifactName || manifestUrl !== artifactName) {
    fail(`latest.yml references ${manifestPathValue}/${manifestUrl}, expected ${artifactName}`);
  }
  if (manifestHash !== sha512Base64(installerPath)) {
    fail('latest.yml SHA-512 does not match the generated installer');
  }

  verifyPackagedModules(asarPath);
  verifySpeakerAssets(path.join(distDir, 'win-unpacked', 'resources', 'models'));
  for (const relativePath of MODEL_FILES) {
    const minimumBytes = relativePath.endsWith('.onnx') ? 10 * 1024 * 1024 : 1;
    requireFile(
      path.join(distDir, 'win-unpacked', 'resources', 'models', 'whisper-small.en', relativePath),
      minimumBytes,
    );
  }
  console.log('Release package checks passed.');
}

const phase = process.argv[2];
try {
  if (phase === 'pre') {
    verifyPrebuild();
  } else if (phase === 'post') {
    verifyPostbuild();
  } else {
    fail('Usage: node scripts/verify-release.js <pre|post>');
  }
} catch (error) {
  console.error(`Release verification failed: ${error.message}`);
  process.exit(1);
}
