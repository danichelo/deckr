const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('presenter', {
  // File actions
  openDialog: () => ipcRenderer.invoke('open-dialog'),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  locateFile: () => ipcRenderer.invoke('locate-file'),
  reloadFile: () => ipcRenderer.invoke('reload-file'),
  closeFile: () => ipcRenderer.send('close-file'),
  exportPDF: (mode) => ipcRenderer.send('export-pdf', mode || 'smart'),
  revealFile: () => ipcRenderer.send('reveal-file'),

  // Recent files (persisted to disk in main)
  getRecent: () => ipcRenderer.invoke('get-recent'),
  removeRecent: (p) => ipcRenderer.invoke('remove-recent', p),
  clearRecent: () => ipcRenderer.invoke('clear-recent'),

  // Misc
  appInfo: () => ipcRenderer.invoke('app-info'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (patch) => ipcRenderer.invoke('set-settings', patch),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  setViewerState: (viewing, locked) => ipcRenderer.send('viewer-state', { viewing, locked }),

  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  toggleFullscreen: () => ipcRenderer.send('window-fullscreen'),
  exitFullscreen: () => ipcRenderer.send('exit-fullscreen'),

  // Events from main
  onLoadFile: (cb) => ipcRenderer.on('load-file', (_, d) => cb(d)),
  onFileUpdated: (cb) => ipcRenderer.on('file-updated', (_, d) => cb(d)),
  onFileError: (cb) => ipcRenderer.on('file-error', (_, d) => cb(d)),
  onMenuCommand: (cb) => ipcRenderer.on('menu-command', (_, c) => cb(c)),
  onMaximizeChange: (cb) => ipcRenderer.on('window-maximized', (_, v) => cb(v)),
  onFullscreenChange: (cb) => ipcRenderer.on('fullscreen-changed', (_, v) => cb(v)),
  onToast: (cb) => ipcRenderer.on('toast', (_, d) => cb(d)),
  onRecentChanged: (cb) => ipcRenderer.on('recent-changed', () => cb()),
});
