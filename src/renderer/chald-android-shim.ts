// Подключить в src/renderer/main.tsx ПЕРВЫМ импортом. Работает только в Android WebView.
// Делает так, чтобы существующий UI (window.chald.invoke / on) работал без изменений.
declare global {
  interface Window {
    ChaldNative?: { invoke(id: string, channel: string, json: string): void };
    chald?: unknown;
    __chaldResolve?: (id: string, ok: boolean, json: string) => void;
    __chaldEmit?: (channel: string, json: string) => void;
  }
}

if (window.ChaldNative) {
  let seq = 0;
  const pending = new Map<string, { res: (v: unknown) => void; rej: (e: Error) => void }>();
  const listeners = new Map<string, Set<(p: unknown) => void>>();

  window.__chaldResolve = (id, ok, json) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    const val = json ? JSON.parse(json) : undefined;
    if (ok) p.res(val);
    else p.rej(new Error(String(val ?? 'native error')));
  };
  window.__chaldEmit = (channel, json) => {
    listeners.get(channel)?.forEach((cb) => cb(json ? JSON.parse(json) : undefined));
  };

  window.chald = {
    setZoom() {},
    invoke(channel: string, arg?: unknown) {
      const id = String(++seq);
      return new Promise((res, rej) => {
        pending.set(id, { res, rej });
        window.ChaldNative!.invoke(id, channel, JSON.stringify(arg ?? null));
      });
    },
    on(channel: string, cb: (p: unknown) => void) {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(cb);
      return () => listeners.get(channel)!.delete(cb);
    },
  };
}
export {};
