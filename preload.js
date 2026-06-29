const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
  transcriptionAvailable: () => ipcRenderer.invoke('transcription-available'),
  transcribeAudio: (pcm) => ipcRenderer.invoke('transcribe-audio', pcm),
  transcriptStart: () => ipcRenderer.invoke('transcript-start'),
  transcriptAppend: (text) => ipcRenderer.invoke('transcript-append', text),
  transcriptRead: () => ipcRenderer.invoke('transcript-read')
});
