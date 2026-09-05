const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getStats: () => ipcRenderer.invoke('get-stats'),
  openDashboard: () => ipcRenderer.invoke('open-dashboard'),
  toggleMiniWidget: (visible) => ipcRenderer.invoke('toggle-mini-widget', visible),
  resizeMiniWidget: (width) => ipcRenderer.invoke('resize-mini-widget', width),
});
