import * as net from 'node:net';
import * as path from 'node:path';

/** Discord Rich Presence over the local IPC pipe/socket of the desktop client. No dependencies, nothing leaves the computer from here. */

export interface Activity {
  details?: string;
  state?: string;
  timestamps?: { start?: number };
  assets?: { large_image?: string; large_text?: string };
  buttons?: { label: string; url: string }[];
}

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;
const MAX_FRAME = 1024 * 1024;

export function encodeFrame(op: number, data: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(data), 'utf8');
  const buf = Buffer.alloc(8 + json.length);
  buf.writeInt32LE(op, 0);
  buf.writeInt32LE(json.length, 4);
  json.copy(buf, 8);
  return buf;
}

export interface Frame {
  op: number;
  data: unknown;
}

/** Collects socket chunks and returns whole frames. */
export class FrameReader {
  private buf: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): Frame[] {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
    const out: Frame[] = [];
    while (this.buf.length >= 8) {
      const op = this.buf.readInt32LE(0);
      const len = this.buf.readInt32LE(4);
      if (len < 0 || len > MAX_FRAME) throw new Error('Некорректный кадр Discord');
      if (this.buf.length < 8 + len) break;
      const body = this.buf.subarray(8, 8 + len).toString('utf8');
      this.buf = this.buf.subarray(8 + len);
      let data: unknown = null;
      try {
        data = body ? JSON.parse(body) : null;
      } catch {
        data = null;
      }
      out.push({ op, data });
    }
    return out;
  }
}

/** Places where Discord (stable, Snap, Flatpak) creates discord-ipc-0..9. */
export function pipePaths(platform: string, env: Record<string, string | undefined>): string[] {
  const out: string[] = [];
  for (let i = 0; i < 10; i++) {
    if (platform === 'win32') {
      out.push(`\\\\?\\pipe\\discord-ipc-${i}`);
      continue;
    }
    const dirs = [env.XDG_RUNTIME_DIR, env.TMPDIR, env.TMP, env.TEMP, '/tmp'].filter((d): d is string => !!d);
    for (const dir of [...new Set(dirs)]) {
      out.push(path.posix.join(dir, `discord-ipc-${i}`));
      if (platform === 'linux') {
        out.push(path.posix.join(dir, 'snap.discord', `discord-ipc-${i}`));
        out.push(path.posix.join(dir, 'app', 'com.discordapp.Discord', `discord-ipc-${i}`));
      }
    }
  }
  return out;
}

function connectSocket(p: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const s = net.createConnection(p);
    const onError = (e: Error) => {
      s.destroy();
      reject(e);
    };
    s.once('error', onError);
    s.once('connect', () => {
      s.off('error', onError);
      resolve(s);
    });
  });
}

export interface DiscordRpcOptions {
  clientId: string;
  pid: number;
  /** candidate pipe paths, default: pipePaths(process.platform, process.env) */
  paths?: () => string[];
  connect?: (path: string) => Promise<net.Socket>;
  /** pause between attempts while Discord is not running */
  retryMs?: number;
  /** minimum pause between two status updates (Discord allows about 5 per 20 s) */
  minGapMs?: number;
  now?: () => number;
  /** diagnostics: connection, errors answered by Discord */
  log?: (message: string) => void;
}

export class DiscordRpc {
  private sock: net.Socket | null = null;
  private ready = false;
  private stopped = true;
  private connecting = false;
  private wanted: Activity | null = null;
  private lastSent: string | null = null;
  private lastSentAt = 0;
  private nonce = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private helloTimer: ReturnType<typeof setTimeout> | null = null;
  private missingLogged = false;

  constructor(private o: DiscordRpcOptions) {}

  get isReady(): boolean {
    return this.ready;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.connectLoop();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    const s = this.sock;
    this.sock = null;
    this.ready = false;
    this.lastSent = null;
    if (s && !s.destroyed) {
      // clear the status before leaving, so it does not hang until Discord notices the closed pipe
      try {
        s.write(encodeFrame(OP_FRAME, { cmd: 'SET_ACTIVITY', args: { pid: this.o.pid, activity: null }, nonce: String(++this.nonce) }));
      } catch {
        /* pipe already gone */
      }
      s.end();
      setTimeout(() => s.destroy(), 200).unref();
    }
  }

  setActivity(a: Activity | null): void {
    this.wanted = a;
    this.flush();
  }

  private log(m: string): void {
    this.o.log?.(m);
  }

  private clearTimers(): void {
    for (const t of [this.retryTimer, this.flushTimer, this.helloTimer]) if (t) clearTimeout(t);
    this.retryTimer = this.flushTimer = this.helloTimer = null;
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connectLoop();
    }, this.o.retryMs ?? 15000);
    this.retryTimer.unref();
  }

  private async connectLoop(): Promise<void> {
    if (this.stopped || this.connecting || this.sock) return;
    this.connecting = true;
    try {
      const paths = (this.o.paths ?? (() => pipePaths(process.platform, process.env)))();
      for (const p of paths) {
        if (this.stopped) return;
        let s: net.Socket;
        try {
          s = await (this.o.connect ?? connectSocket)(p);
        } catch {
          continue;
        }
        if (this.stopped) {
          s.destroy();
          return;
        }
        this.missingLogged = false;
        this.log(`подключено к ${p}`);
        this.attach(s);
        return;
      }
      if (!this.missingLogged) {
        this.missingLogged = true;
        this.log('Discord не найден: запущен ли Discord для компьютера (не браузерный)? Повторяю попытки.');
      }
      this.scheduleRetry();
    } finally {
      this.connecting = false;
    }
  }

  private attach(s: net.Socket): void {
    this.sock = s;
    this.ready = false;
    const reader = new FrameReader();
    const drop = () => {
      if (this.sock !== s) return;
      this.log('соединение с Discord закрыто');
      this.sock = null;
      this.ready = false;
      this.lastSent = null;
      if (this.helloTimer) clearTimeout(this.helloTimer);
      this.helloTimer = null;
      s.destroy();
      this.scheduleRetry();
    };
    s.on('data', (chunk: Buffer) => {
      let frames: Frame[];
      try {
        frames = reader.push(chunk);
      } catch {
        return drop();
      }
      for (const f of frames) {
        if (f.op === OP_PING) s.write(encodeFrame(OP_PONG, f.data));
        else if (f.op === OP_CLOSE) return drop();
        else if (f.op === OP_FRAME && (f.data as { evt?: string } | null)?.evt === 'ERROR') {
          this.log(`Discord ответил ошибкой: ${JSON.stringify(f.data)}`);
        } else if (f.op === OP_FRAME && (f.data as { cmd?: string; evt?: string | null } | null)?.cmd === 'SET_ACTIVITY') {
          this.log('статус принят Discord');
        } else if (f.op === OP_FRAME && (f.data as { evt?: string } | null)?.evt === 'READY') {
          this.log('Discord готов');
          this.ready = true;
          if (this.helloTimer) clearTimeout(this.helloTimer);
          this.helloTimer = null;
          this.lastSent = null;
          this.flush();
        }
      }
    });
    s.on('error', drop);
    s.on('close', drop);
    s.write(encodeFrame(OP_HANDSHAKE, { v: 1, client_id: this.o.clientId }));
    // Discord that never answers the handshake: drop and try again later
    this.helloTimer = setTimeout(() => {
      this.log('Discord не ответил на приветствие');
      drop();
    }, 10000);
    this.helloTimer.unref();
  }

  private flush(): void {
    if (!this.ready || !this.sock) return;
    const key = JSON.stringify(this.wanted);
    if (key === this.lastSent) return;
    const now = (this.o.now ?? Date.now)();
    const wait = (this.o.minGapMs ?? 1500) - (now - this.lastSentAt);
    if (wait > 0) {
      if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => {
          this.flushTimer = null;
          this.flush();
        }, wait);
        this.flushTimer.unref();
      }
      return;
    }
    this.lastSent = key;
    this.lastSentAt = now;
    this.sock.write(encodeFrame(OP_FRAME, { cmd: 'SET_ACTIVITY', args: { pid: this.o.pid, activity: this.wanted }, nonce: String(++this.nonce) }));
  }
}
