const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  transcriptionAvailable: () => ipcRenderer.invoke('transcription-available'),
  transcribeAudio: (pcm) => ipcRenderer.invoke('transcribe-audio', pcm),
  transcriptStart: () => ipcRenderer.invoke('transcript-start'),
  transcriptAppend: (text) => ipcRenderer.invoke('transcript-append', text),
  transcriptRead: () => ipcRenderer.invoke('transcript-read')
});
