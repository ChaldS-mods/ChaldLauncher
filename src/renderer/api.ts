import type { IpcContract, IpcEvents, IpcResult } from '../shared/ipc';

declare global {
  interface Window {
    chald: {
      invoke(channel: string, arg?: unknown): Promise<unknown>;
      on(channel: string, cb: (payload: unknown) => void): () => void;
    };
  }
}

export class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

type Args<C extends keyof IpcContract> = IpcContract[C]['req'] extends void ? [] : [IpcContract[C]['req']];

export async function call<C extends keyof IpcContract>(channel: C, ...args: Args<C>): Promise<IpcContract[C]['res']> {
  if (!window.chald) throw new ApiError('NO_BRIDGE', 'Интерфейс запущен вне ChaldLauncher');
  const r = (await window.chald.invoke(channel, args[0])) as IpcResult<IpcContract[C]['res']>;
  if (!r.ok) throw new ApiError(r.error.code, r.error.message);
  return r.data;
}

export function on<K extends keyof IpcEvents>(channel: K, cb: (payload: IpcEvents[K]) => void): () => void {
  return window.chald.on(channel, cb as (p: unknown) => void);
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
