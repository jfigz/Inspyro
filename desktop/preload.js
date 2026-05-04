const { contextBridge, ipcRenderer } = require('electron');

const menuActionListeners = new Set();

ipcRenderer.on('desktop:menu-action', (_event, action) => {
  menuActionListeners.forEach((listener) => {
    try {
      listener(action);
    } catch (error) {
      console.error('Desktop menu action listener failed:', error);
    }
  });
});

contextBridge.exposeInMainWorld('inspyroDesktop', {
  isDesktop: true,
  version: process.env.npm_package_version || '1.0.0',
  openExternal: (url) => ipcRenderer.invoke('desktop:openExternal', url),
  openPath: (targetPath) => ipcRenderer.invoke('desktop:openPath', targetPath),
  openDevTools: () => ipcRenderer.send('desktop:open-devtools'),
  reloadRenderer: () => ipcRenderer.send('desktop:reload-renderer'),
  reportWorkspace: (path) => ipcRenderer.send('desktop:report-workspace', path),
  reportRendererPhase: (phase, payload = {}) => ipcRenderer.send('desktop:renderer-phase', { phase, payload }),
  emitDesktopNotification: (payload) => ipcRenderer.send('desktop:notify', payload),
  onMenuAction: (handler) => {
    if (typeof handler !== 'function') {
      return () => {};
    }
    menuActionListeners.add(handler);
    return () => {
      menuActionListeners.delete(handler);
    };
  },
  notifyRendererReady: () => ipcRenderer.send('desktop:renderer-phase', {
    phase: 'renderer_app_ready',
    payload: { legacy: true },
  }),
});
