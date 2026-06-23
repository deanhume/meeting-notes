const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  transcriptionAvailable: () => ipcRenderer.invoke('transcription-available'),
  transcribeAudio: (pcm) => ipcRenderer.invoke('transcribe-audio', pcm)
});
