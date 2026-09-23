const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  saveFile: (defaultName, data) => ipcRenderer.invoke('save-file', { defaultName, data }),
  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath)
})
