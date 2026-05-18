/**
 * Electron main process for Meeting Notes.
 * Creates the browser window and starts an embedded Express server.
 * All shared logic (validation, routes, helpers) lives in shared.js.
 */

const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const express = require('express');
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

// Create the main Electron browser window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'public', 'images', 'logo-256.png'),
    autoHideMenuBar: true
  });

  Menu.setApplicationMenu(null);

  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

// Start the embedded Express server that serves the API and static files
function startServer() {
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

// Electron lifecycle: start server first, then open the window
app.whenReady().then(() => {
  startServer();
  createWindow();

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
