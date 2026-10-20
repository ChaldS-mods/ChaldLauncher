import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('setup', {
  info: () => ipcRenderer.invoke('setup:info'),
  chooseDir: (current: string) => ipcRenderer.invoke('setup:chooseDir', current),
  checkDir: (dir: string) => ipcRenderer.invoke('setup:checkDir', dir),
  install: (opts: { dir: string; desktopShortcut: boolean; startMenuShortcut: boolean }) => ipcRenderer.invoke('setup:install', opts),
  cancel: () => ipcRenderer.invoke('setup:cancel'),
  launch: () => ipcRenderer.invoke('setup:launch'),
  minimize: () => ipcRenderer.invoke('setup:minimize'),
  close: () => ipcRenderer.invoke('setup:close'),
  onProgress: (cb: (p: { phase: string; percent: number; file?: string }) => void) => {
    const h = (_e: unknown, p: { phase: string; percent: number; file?: string }): void => cb(p);
    ipcRenderer.on('setup:progress', h);
    return () => ipcRenderer.removeListener('setup:progress', h);
  },
});
