/**
 * Electron main process for Meeting Notes.
 * Creates the browser window and starts an embedded Express server.
 * All shared logic (validation, routes, helpers) lives in shared.js.
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
// Settings are stored in the Electron user data directory (e.g. %APPDATA%/meeting-notes/)
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');

// Load settings from disk, falling back to default data location
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

// Configure auto-updater
function setupAutoUpdater() {
  // Log auto-updater events
  autoUpdater.logger = require('electron-log');
  autoUpdater.logger.transports.file.level = 'info';
  
  // Silently download updates in the background
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', (info) => {
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
  });

  // Check for updates on startup (after a delay) and then every hour
  setTimeout(() => {
    autoUpdater.checkForUpdates();
  }, 3000);
  
  setInterval(() => {
    autoUpdater.checkForUpdates();
  }, 60 * 60 * 1000); // Check every hour
}

// Create the main Electron browser window
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

// Start the embedded Express server and return a promise that resolves when listening
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

// IPC handler: opens a native folder picker dialog for the settings page
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory']
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// IPC handler: reports whether local speech-to-text is available (model present)
ipcMain.handle('transcription-available', () => {
  return transcription.isModelAvailable(app);
});

// IPC handler: transcribe 16kHz mono PCM (Float32Array) to text, fully on-device
ipcMain.handle('transcribe-audio', async (_event, pcm) => {
  return transcription.transcribePcm(pcm, app);
});

// Path of the transcript text file for the in-progress recording. The renderer
// writes transcribed audio to this file in chunks (performant append) and reads
// it back periodically to produce a live, rolling summary of the meeting.
let currentTranscriptPath = null;

// IPC handler: begin a new transcript file in a "transcriptions" subfolder of the
// configured data folder and return its filename. A fresh file is created per
// recording session, and the subfolder is created on demand if it doesn't exist.
ipcMain.handle('transcript-start', () => {
  const dir = path.join(loadSettings().dataLocation, 'transcriptions');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  currentTranscriptPath = path.join(dir, `transcript_${stamp}.txt`);
  fs.writeFileSync(currentTranscriptPath, '', 'utf8');
  return path.basename(currentTranscriptPath);
});

// IPC handler: append a transcribed chunk to the current transcript file. Uses
// a plain append (not atomic rewrite) so writing stays cheap as the file grows.
// Each chunk is written on its own line and guaranteed to end with sentence
// punctuation: the summariser splits on . ! ?, so a pause-cut chunk left without
// terminal punctuation would otherwise merge with the next into a run-on sentence.
ipcMain.handle('transcript-append', (_event, text) => {
  if (!currentTranscriptPath || typeof text !== 'string' || !text.trim()) return false;
  let chunk = text.trim();
  if (!/[.!?]["')\]]?$/.test(chunk)) chunk += '.';
  fs.appendFileSync(currentTranscriptPath, `${chunk}\n`, 'utf8');
  return true;
});

// IPC handler: read back the full transcript text for the current recording.
ipcMain.handle('transcript-read', () => {
  if (!currentTranscriptPath || !fs.existsSync(currentTranscriptPath)) return '';
  return fs.readFileSync(currentTranscriptPath, 'utf8');
});

// Electron lifecycle: wait for server to be ready before opening the window
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

// Shut down the Express server when all windows are closed
app.on('window-all-closed', function () {
  if (server) {
    server.close();
  }
  if (process.platform !== 'darwin') app.quit();
});
