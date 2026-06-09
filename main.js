/**
 * Electron main process for Meeting Notes.
 * Creates the browser window and starts an embedded Express server.
 * All shared logic (validation, routes, helpers) lives in shared.js.
 */

const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const express = require('express');
const { autoUpdater } = require('electron-updater');
const { safeLoadJSON, atomicWriteFile, createApiRoutes } = require('./shared');

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
  
  // Check for updates every hour
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Available',
      message: `A new version (${info.version}) is available. Would you like to download it now?`,
      buttons: ['Download', 'Later']
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.downloadUpdate();
      }
    });
  });

  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Ready',
      message: 'Update downloaded. The application will restart to install the update.',
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
    icon: path.join(__dirname, 'public', 'images', 'logo-256.png'),
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

// Electron lifecycle: wait for server to be ready before opening the window
app.whenReady().then(async () => {
  await startServer();
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
