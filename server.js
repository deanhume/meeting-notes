/**
 * Standalone web server for Meeting Notes.
 *
 * Used for UI development/testing without Electron (npm run web).
 * Mounts the same API routes from shared.js, serving data from a local ./data
 * directory. Settings and transcription are NOT available in this mode —
 * those features require the Electron host (main.js).
 */

const express = require('express');
const path = require('path');
const { createApiRoutes } = require('./shared');

const app = express();
const PORT = 3000;
const DATA_DIR = path.join(__dirname, 'data');

app.use(express.json());

// Cross-origin isolation (parity with the Electron host) so ONNX Runtime Web can
// use multi-threaded WASM. All resources are same-origin, so require-corp is safe.
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Mount the shared API routes (same ones Electron uses)
createApiRoutes(app, { dataDir: DATA_DIR });

// SPA fallback: serve index.html for any unmatched routes so client-side
// navigation works if the user refreshes on a deep path
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n📋 Meeting Notes running at http://localhost:${PORT}\n`);
});
