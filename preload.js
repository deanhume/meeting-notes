/**
 * Preload script — the IPC bridge between the renderer and the main process.
 *
 * The renderer runs with nodeIntegration: false and contextIsolation: true,
 * so this is the ONLY way it can talk to Node/Electron APIs. Every method
 * here maps 1:1 to an ipcMain.handle() in main.js.
 *
 * To add a new renderer↔main capability:
 *   1. Add the ipcMain.handle('channel-name', handler) in main.js
 *   2. Expose it here via contextBridge
 *   3. Call it in the renderer as window.electronAPI.methodName(...)
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Settings: open a native folder picker
  selectFolder: () => ipcRenderer.invoke('select-folder'),

  // Auto-updates: check for new versions and poll download progress
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),

  // Transcription: check model availability and transcribe audio buffers
  transcriptionAvailable: () => ipcRenderer.invoke('transcription-available'),
  transcribeAudio: (pcm) => ipcRenderer.invoke('transcribe-audio', pcm),

  // Transcript file: start/append/read the on-disk transcript during recording
  transcriptStart: (noteId) => ipcRenderer.invoke('transcript-start', noteId),
  transcriptAppend: (text) => ipcRenderer.invoke('transcript-append', text),
  transcriptRead: () => ipcRenderer.invoke('transcript-read')
});
