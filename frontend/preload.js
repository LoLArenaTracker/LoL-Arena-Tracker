const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getPort: () => ipcRenderer.invoke('get-port'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  apiRequest: (path, method = 'GET', body = null) =>
    ipcRenderer.invoke('api-request', { path, method, body }),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (_, status) => cb(status)),
  onUpdateProgress: (cb) => ipcRenderer.on('update-progress', (_, pct) => cb(pct)),
})
