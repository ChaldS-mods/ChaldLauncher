"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiscordRpc = exports.FrameReader = void 0;
exports.encodeFrame = encodeFrame;
exports.pipePaths = pipePaths;
const net = __importStar(require("node:net"));
const path = __importStar(require("node:path"));
const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;
const MAX_FRAME = 1024 * 1024;
function encodeFrame(op, data) {
    const json = Buffer.from(JSON.stringify(data), 'utf8');
    const buf = Buffer.alloc(8 + json.length);
    buf.writeInt32LE(op, 0);
    buf.writeInt32LE(json.length, 4);
    json.copy(buf, 8);
    return buf;
}
/** Collects socket chunks and returns whole frames. */
class FrameReader {
    buf = Buffer.alloc(0);
    push(chunk) {
        this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
        const out = [];
        while (this.buf.length >= 8) {
            const op = this.buf.readInt32LE(0);
            const len = this.buf.readInt32LE(4);
            if (len < 0 || len > MAX_FRAME)
                throw new Error('Некорректный кадр Discord');
            if (this.buf.length < 8 + len)
                break;
            const body = this.buf.subarray(8, 8 + len).toString('utf8');
            this.buf = this.buf.subarray(8 + len);
            let data = null;
            try {
                data = body ? JSON.parse(body) : null;
            }
            catch {
                data = null;
            }
            out.push({ op, data });
        }
        return out;
    }
}
exports.FrameReader = FrameReader;
/** Places where Discord (stable, Snap, Flatpak) creates discord-ipc-0..9. */
function pipePaths(platform, env) {
    const out = [];
    for (let i = 0; i < 10; i++) {
        if (platform === 'win32') {
            out.push(`\\\\?\\pipe\\discord-ipc-${i}`);
            continue;
        }
        const dirs = [env.XDG_RUNTIME_DIR, env.TMPDIR, env.TMP, env.TEMP, '/tmp'].filter((d) => !!d);
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
function connectSocket(p) {
    return new Promise((resolve, reject) => {
        const s = net.createConnection(p);
        const onError = (e) => {
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
class DiscordRpc {
    o;
    sock = null;
    ready = false;
    stopped = true;
    connecting = false;
    wanted = null;
    lastSent = null;
    lastSentAt = 0;
    nonce = 0;
    retryTimer = null;
    flushTimer = null;
    helloTimer = null;
    missingLogged = false;
    constructor(o) {
        this.o = o;
    }
    get isReady() {
        return this.ready;
    }
    start() {
        if (!this.stopped)
            return;
        this.stopped = false;
        void this.connectLoop();
    }
    stop() {
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
            }
            catch {
                /* pipe already gone */
            }
            s.end();
            setTimeout(() => s.destroy(), 200).unref();
        }
    }
    setActivity(a) {
        this.wanted = a;
        this.flush();
    }
    log(m) {
        this.o.log?.(m);
    }
    clearTimers() {
        for (const t of [this.retryTimer, this.flushTimer, this.helloTimer])
            if (t)
                clearTimeout(t);
        this.retryTimer = this.flushTimer = this.helloTimer = null;
    }
    scheduleRetry() {
        if (this.stopped || this.retryTimer)
            return;
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            void this.connectLoop();
        }, this.o.retryMs ?? 15000);
        this.retryTimer.unref();
    }
    async connectLoop() {
        if (this.stopped || this.connecting || this.sock)
            return;
        this.connecting = true;
        try {
            const paths = (this.o.paths ?? (() => pipePaths(process.platform, process.env)))();
            for (const p of paths) {
                if (this.stopped)
                    return;
                let s;
                try {
                    s = await (this.o.connect ?? connectSocket)(p);
                }
                catch {
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
        }
        finally {
            this.connecting = false;
        }
    }
    attach(s) {
        this.sock = s;
        this.ready = false;
        const reader = new FrameReader();
        const drop = () => {
            if (this.sock !== s)
                return;
            this.log('соединение с Discord закрыто');
            this.sock = null;
            this.ready = false;
            this.lastSent = null;
            if (this.helloTimer)
                clearTimeout(this.helloTimer);
            this.helloTimer = null;
            s.destroy();
            this.scheduleRetry();
        };
        s.on('data', (chunk) => {
            let frames;
            try {
                frames = reader.push(chunk);
            }
            catch {
                return drop();
            }
            for (const f of frames) {
                if (f.op === OP_PING)
                    s.write(encodeFrame(OP_PONG, f.data));
                else if (f.op === OP_CLOSE)
                    return drop();
                else if (f.op === OP_FRAME && f.data?.evt === 'ERROR') {
                    this.log(`Discord ответил ошибкой: ${JSON.stringify(f.data)}`);
                }
                else if (f.op === OP_FRAME && f.data?.cmd === 'SET_ACTIVITY') {
                    this.log('статус принят Discord');
                }
                else if (f.op === OP_FRAME && f.data?.evt === 'READY') {
                    this.log('Discord готов');
                    this.ready = true;
                    if (this.helloTimer)
                        clearTimeout(this.helloTimer);
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
    flush() {
        if (!this.ready || !this.sock)
            return;
        const key = JSON.stringify(this.wanted);
        if (key === this.lastSent)
            return;
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
exports.DiscordRpc = DiscordRpc;
//# sourceMappingURL=discord.js.map