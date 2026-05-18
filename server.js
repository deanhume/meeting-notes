/**
 * Standalone web server for Meeting Notes.
 * Used for development/testing without Electron (npm run web).
 * All shared logic lives in shared.js.
 */

const express = require('express');
const path = require('path');
const { createApiRoutes } = require('./shared');

const app = express();
const PORT = 3000;
// Standalone web mode stores data in a local ./data directory
const DATA_DIR = path.join(__dirname, 'data');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Mount all API routes using the shared route factory
createApiRoutes(app, { dataDir: DATA_DIR });

// Serve index.html for any unmatched routes (SPA fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n📋 Meeting Notes running at http://localhost:${PORT}\n`);
});
