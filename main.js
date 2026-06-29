/**
 * Electron main process for Meeting Notes.
 *
 * Responsibilities:
 *   1. Start an embedded Express server (same API as web mode)
 *   2. Create the BrowserWindow that loads the app UI
 *   3. Handle IPC calls from the renderer (folder picker, transcription, updates)
 *   4. Manage auto-updates via electron-updater + GitHub Releases
 *
 * Settings and data live under the Electron user-data directory:
 *   Windows: %APPDATA%/meeting-notes/
 *   macOS:   ~/Library/Application Support/meeting-notes/
 */

const { app, BrowserWindow, ipcMain, dialog, Menu, session, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const express = require('express');
const { autoUpdater } = require('electron-updater');
const { safeLoadJSON, atomicWriteFile, createApiRoutes } = require('./shared');
const transcription = require('./transcription');

let mainWindow;
let server;
const PORT = 3000;

// Track the current auto-update state so the renderer can poll it via IPC
let updateStatus = { state: 'idle', message: '' };

// Settings are stored in the Electron user data directory (e.g. %APPDATA%/meeting-notes/)
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');

// ── Settings persistence ──────────────────────────────────────
// Settings determine where data files are stored. Falls back to a "data"
// subfolder inside the Electron user-data directory on first run.

function loadSettings() {
  const settings = safeLoadJSON(SETTINGS_FILE, null);
  if (settings && settings.dataLocation) {
    return settings;
  }
  return { dataLocation: path.join(app.getPath('userData'), 'data') };
}

function saveSettings(settings) {
  atomicWriteFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// ── Auto-updater ─────────────────────────────────────────────
// Uses electron-updater to check GitHub Releases for new versions.
// Downloads happen silently in the background; the user is prompted
// to restart only after the download completes.

function setUpdateStatus(nextStatus) {
  updateStatus = nextStatus;
}

function setupAutoUpdater() {
  // Log auto-updater events
  autoUpdater.logger = require('electron-log');
  autoUpdater.logger.transports.file.level = 'info';
  
  // Silently download updates in the background
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    setUpdateStatus({ state: 'checking', message: 'Checking for updates…' });
  });

  autoUpdater.on('update-available', (info) => {
    setUpdateStatus({
      state: 'downloading',
      version: info.version,
      message: `Downloading version ${info.version} in the background. You can continue working.`
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.round(progress.percent || 0);
    setUpdateStatus({
      state: 'downloading',
      version: updateStatus.version,
      progress: percent,
      message: `Downloading version ${updateStatus.version || 'the latest update'} in the background (${percent}%). You can continue working.`
    });
  });

  autoUpdater.on('update-not-available', () => {
    setUpdateStatus({ state: 'up-to-date', message: 'You already have the latest version installed.' });
  });

  autoUpdater.on('update-downloaded', (info) => {
    setUpdateStatus({
      state: 'downloaded',
      version: info.version,
      message: `Version ${info.version} has been downloaded and will be installed when you restart.`
    });
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Ready',
      message: `Version ${info.version} has been downloaded and will be installed when you restart.`,
      buttons: ['Restart Now', 'Later']
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall(false, true);
      }
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err);
    setUpdateStatus({
      state: 'error',
      message: err && err.message ? `Unable to check for updates: ${err.message}` : 'Unable to check for updates right now.'
    });
  });

  // Check for updates on startup (after a delay) and then every hour
  setTimeout(() => {
    autoUpdater.checkForUpdates();
  }, 3000);
  
  setInterval(() => {
    autoUpdater.checkForUpdates();
  }, 60 * 60 * 1000); // Check every hour
}

// ── Browser window ───────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false, // Don't show until content is rendered (avoids blank flash)
    backgroundColor: '#0f0f0f', // Match app background for instant visual
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'public', 'images', 'logo-app-256.png'),
    autoHideMenuBar: true
  });

  Menu.setApplicationMenu(null);

  // Show window only after the page has fully painted
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

// ── Embedded Express server ───────────────────────────────────
// The renderer loads from localhost:<PORT>. This keeps the app architecture
// identical to web mode — the frontend always talks to an HTTP API.

function startServer() {
  return new Promise((resolve) => {
    const expressApp = express();
    const settings = loadSettings();

    expressApp.use(express.json());
    expressApp.use(express.static(path.join(__dirname, 'public')));

    // Mount all API routes using the shared route factory
    createApiRoutes(expressApp, {
      dataDir: settings.dataLocation,
      loadSettings,
      saveSettings
    });

    // Serve index.html for any unmatched routes (SPA fallback)
    expressApp.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    server = expressApp.listen(PORT, () => {
      console.log(`Meeting Notes server running at http://localhost:${PORT}`);
      console.log(`Data stored in: ${settings.dataLocation}`);
      resolve();
    });
  });
}

// ── IPC Handlers ─────────────────────────────────────────────
// These are the only bridges between the renderer and the main process.
// Each maps to a method exposed via preload.js's contextBridge.

// Opens a native folder picker dialog for the settings page
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory']
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// Reports whether local speech-to-text is available (Whisper model file present)
ipcMain.handle('transcription-available', () => {
  return transcription.isModelAvailable(app);
});

// Transcribe 16kHz mono PCM audio to text using on-device Whisper
ipcMain.handle('transcribe-audio', async (_event, pcm) => {
  return transcription.transcribePcm(pcm, app);
});

// Return the current auto-update status to the renderer (polled from settings modal)
ipcMain.handle('get-update-status', () => updateStatus);

// Trigger a manual update check from the settings modal
ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) {
    setUpdateStatus({
      state: 'unavailable',
      message: 'Update checks are only available in installed desktop builds.'
    });
    return updateStatus;
  }

  if (updateStatus.state === 'checking' || updateStatus.state === 'downloading') {
    return updateStatus;
  }

  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    console.error('Manual update check failed:', err);
    setUpdateStatus({
      state: 'error',
      message: err && err.message ? `Unable to check for updates: ${err.message}` : 'Unable to check for updates right now.'
    });
  }

  return updateStatus;
});

// ── Transcript file management ────────────────────────────────
// During a recording, transcribed audio chunks are appended to a text file in
// a "transcriptions" subfolder of the data directory. This lets the app build
// a rolling summary without keeping the entire transcript in memory.

// Path of the transcript text file for the in-progress recording
let currentTranscriptPath = null;

// Begin a new transcript file for this recording session
ipcMain.handle('transcript-start', () => {
  const dir = path.join(loadSettings().dataLocation, 'transcriptions');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  currentTranscriptPath = path.join(dir, `transcript_${stamp}.txt`);
  fs.writeFileSync(currentTranscriptPath, '', 'utf8');
  return path.basename(currentTranscriptPath);
});

// Append a transcribed chunk to the current transcript file.
// Each chunk is written on its own line and guaranteed to end with sentence
// punctuation so the summariser can split cleanly on sentence boundaries.
ipcMain.handle('transcript-append', (_event, text) => {
  if (!currentTranscriptPath || typeof text !== 'string' || !text.trim()) return false;
  let chunk = text.trim();
  if (!/[.!?]["')\]]?$/.test(chunk)) chunk += '.';
  fs.appendFileSync(currentTranscriptPath, `${chunk}\n`, 'utf8');
  return true;
});

// Read back the full transcript so far (used to produce a summary at recording stop)
ipcMain.handle('transcript-read', () => {
  if (!currentTranscriptPath || !fs.existsSync(currentTranscriptPath)) return '';
  return fs.readFileSync(currentTranscriptPath, 'utf8');
});

// ── Electron lifecycle ────────────────────────────────────────
// Wait for the Express server to be ready before opening the window, so the
// renderer never hits a "connection refused" on its initial page load.

app.whenReady().then(async () => {
  await startServer();

  // Allow microphone access for in-app recording / transcription
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });

  // Grant system-audio (loopback) capture for getDisplayMedia, so meetings/videos
  // playing on the machine can be transcribed. Windows uses WASAPI loopback.
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    // Use a 1x1 thumbnail to skip the expensive full-screen screenshot of every
    // display — we only use sources[0] as the loopback source id, never its
    // thumbnail, so full-size thumbnails just add startup latency. (A 0x0 size is
    // avoided as some platforms reject it.)
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }).then((sources) => {
      if (!sources.length) {
        console.error('No screen sources available for loopback capture');
        callback();
        return;
      }
      callback({ video: sources[0], audio: 'loopback' });
    }).catch((err) => {
      console.error('desktopCapturer.getSources failed:', err);
      callback();
    });
  });

  createWindow();
  
  // Setup auto-updater after window is created
  if (!app.isPackaged) {
    console.log('Running in development mode - auto-updates disabled');
  } else {
    setupAutoUpdater();
  }

  app.on('activate', function () {
    if (mainWindow === null) createWindow();
  });
});

// Shut down the Express server when all windows are closed (standard Electron pattern)
app.on('window-all-closed', function () {
  if (server) {
    server.close();
  }
  if (process.platform !== 'darwin') app.quit();
});
