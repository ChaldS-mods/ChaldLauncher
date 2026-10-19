import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

// Sandboxed preload: only `electron` can be required here, so shared code is not imported at runtime.
const CHANNEL_RE = /^[a-z]+:[a-zA-Z]+$/;
const EVENT_RE = /^(op|game|auth):[a-zA-Z]+$/;

contextBridge.exposeInMainWorld('chald', {
  invoke(channel: string, arg?: unknown): Promise<unknown> {
    if (!CHANNEL_RE.test(channel)) return Promise.reject(new Error('Недопустимый канал'));
    return ipcRenderer.invoke(channel, arg);
  },
  on(channel: string, cb: (payload: unknown) => void): () => void {
    if (!EVENT_RE.test(channel)) throw new Error('Недопустимое событие');
    const listener = (_e: IpcRendererEvent, payload: unknown) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
