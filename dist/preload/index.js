"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// Sandboxed preload: only `electron` can be required here, so shared code is not imported at runtime.
const CHANNEL_RE = /^[a-z]+:[a-zA-Z]+$/;
const EVENT_RE = /^(op|game|auth):[a-zA-Z]+$/;
electron_1.contextBridge.exposeInMainWorld('chald', {
    setZoom(factor) {
        if (Number.isFinite(factor))
            electron_1.webFrame.setZoomFactor(Math.min(1.3, Math.max(0.8, factor)));
    },
    invoke(channel, arg) {
        if (!CHANNEL_RE.test(channel))
            return Promise.reject(new Error('Недопустимый канал'));
        return electron_1.ipcRenderer.invoke(channel, arg);
    },
    on(channel, cb) {
        if (!EVENT_RE.test(channel))
            throw new Error('Недопустимое событие');
        const listener = (_e, payload) => cb(payload);
        electron_1.ipcRenderer.on(channel, listener);
        return () => electron_1.ipcRenderer.removeListener(channel, listener);
    },
});
//# sourceMappingURL=index.js.map