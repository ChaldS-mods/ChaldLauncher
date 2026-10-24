import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiscordRpc, encodeFrame, FrameReader, pipePaths, type Activity } from '../src/main/discord';
import { buildActivity, PAGE_LABELS, PresenceService, type PresenceState, type RpcLike } from '../src/main/presence';
import { PRESENCE_PAGES } from '../src/shared/presence';

const state = (o: Partial<PresenceState> = {}): PresenceState => ({
  page: 'home', playing: null, showInstance: true, appVersion: '0.2.0', startedAt: 1_700_000_000_000, downloadUrl: 'https://github.com/ChaldS-mods/ChaldLauncher/releases/latest', ...o,
});

describe('frames', () => {
  it('encode → read, also when the data arrives in pieces', () => {
    const buf = Buffer.concat([encodeFrame(1, { a: 'Привет' }), encodeFrame(3, { n: 1 })]);
    const r = new FrameReader();
    const got = [...r.push(buf.subarray(0, 5)), ...r.push(buf.subarray(5, 20)), ...r.push(buf.subarray(20))];
    expect(got).toEqual([{ op: 1, data: { a: 'Привет' } }, { op: 3, data: { n: 1 } }]);
  });
  it('a frame with an absurd length is refused', () => {
    const bad = Buffer.alloc(8);
    bad.writeInt32LE(1, 0);
    bad.writeInt32LE(0x7fffffff, 4);
    expect(() => new FrameReader().push(bad)).toThrow();
  });
});

describe('pipePaths', () => {
  it('Windows: named pipes 0..9', () => {
    const p = pipePaths('win32', {});
    expect(p).toHaveLength(10);
    expect(p[0]).toBe('\\\\?\\pipe\\discord-ipc-0');
  });
  it('Linux: runtime dir first, Snap and Flatpak too', () => {
    const p = pipePaths('linux', { XDG_RUNTIME_DIR: '/run/user/1000' });
    expect(p[0]).toBe('/run/user/1000/discord-ipc-0');
    expect(p).toContain('/run/user/1000/snap.discord/discord-ipc-0');
    expect(p).toContain('/run/user/1000/app/com.discordapp.Discord/discord-ipc-0');
  });
});

describe('buildActivity', () => {
  it('menu: page text, version, time since the launcher started', () => {
    const a = buildActivity(state());
    expect(a.details).toBe('В главном меню');
    expect(a.state).toBe('Chald Launcher 0.2.0');
    expect(a.timestamps?.start).toBe(1_700_000_000);
    expect(a.buttons?.[0]?.url).toContain('releases/latest');
  });
  it('every page has a text of valid length', () => {
    for (const page of PRESENCE_PAGES) {
      const t = buildActivity(state({ page })).details ?? '';
      expect(PAGE_LABELS[page]).toBe(t);
      expect(t.length).toBeGreaterThanOrEqual(2);
      expect(t.length).toBeLessThanOrEqual(128);
    }
  });
  it('game: instance, Minecraft version, loader, time of the start', () => {
    const a = buildActivity(state({ playing: { id: 'x', name: 'Моя сборка', mcVersion: '1.21.1', loader: 'neoforge', since: 1_700_000_500_000 } }));
    expect(a.details).toBe('Играет в «Моя сборка»');
    expect(a.state).toBe('Minecraft 1.21.1 · NeoForge');
    expect(a.timestamps?.start).toBe(1_700_000_500);
  });
  it('vanilla has no loader in the text; hidden instance name stays hidden', () => {
    const a = buildActivity(state({ showInstance: false, playing: { id: 'x', name: 'Секретная', mcVersion: '1.20.4', loader: 'vanilla', since: 0 } }));
    expect(a.state).toBe('Minecraft 1.20.4');
    expect(JSON.stringify(a)).not.toContain('Секретная');
  });
});

describe('PresenceService', () => {
  const fake = () => {
    const calls: (Activity | null | 'start' | 'stop')[] = [];
    const rpc: RpcLike = { start: () => void calls.push('start'), stop: () => void calls.push('stop'), setActivity: (a) => void calls.push(a) };
    const svc = new PresenceService({ appVersion: '1', clientId: '123', downloadUrl: 'https://x.y/', pid: 1, makeRpc: () => rpc, now: () => 0 });
    return { calls, svc };
  };
  it('does nothing while the setting is off or there is no application id', () => {
    const { calls, svc } = fake();
    svc.configure(false, true);
    svc.setPage('wardrobe');
    expect(calls).toEqual([]);
    const none = new PresenceService({ appVersion: '1', clientId: '', downloadUrl: 'https://x.y/', pid: 1, makeRpc: () => { throw new Error('must not start'); } });
    none.configure(true, true);
    none.setPage('home');
  });
  it('turning on starts and shows the page; page changes and games update it; turning off clears', () => {
    const { calls, svc } = fake();
    svc.configure(true, true);
    expect(calls[0]).toBe('start');
    expect((calls[1] as Activity).details).toBe('В главном меню');
    svc.setPage('settings');
    expect((calls[2] as Activity).details).toBe('В настройках');
    svc.gameStarted({ id: 'a', name: 'A', mcVersion: '1.21.1', loader: 'fabric', since: 5000 });
    expect((calls[3] as Activity).details).toBe('Играет в «A»');
    svc.gameStopped('a');
    expect((calls[4] as Activity).details).toBe('В настройках');
    svc.configure(false, true);
    expect(calls[5]).toBe('stop');
  });
  it('two games: the latest one is shown, after it ends the earlier one comes back', () => {
    const { calls, svc } = fake();
    svc.configure(true, true);
    svc.gameStarted({ id: 'a', name: 'A', mcVersion: '1.21.1', loader: 'vanilla', since: 1000 });
    svc.gameStarted({ id: 'b', name: 'B', mcVersion: '1.20.1', loader: 'forge', since: 2000 });
    expect((calls[calls.length - 1] as Activity).details).toBe('Играет в «B»');
    svc.gameStopped('b');
    expect((calls[calls.length - 1] as Activity).details).toBe('Играет в «A»');
  });
});

/** a tiny stand-in for the Discord client on a local pipe/socket */
function fakeDiscord() {
  const name = `chald-test-${process.pid}-${Math.random().toString(36).slice(2)}`;
  const file = process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : path.join(os.tmpdir(), name);
  const received: { op: number; data: any }[] = [];
  const sockets: net.Socket[] = [];
  const server = net.createServer((sock) => {
    sockets.push(sock);
    const reader = new FrameReader();
    sock.on('data', (c) => {
      for (const f of reader.push(c)) {
        received.push({ op: f.op, data: f.data });
        if (f.op === 0) sock.write(encodeFrame(1, { cmd: 'DISPATCH', evt: 'READY', data: { v: 1 } }));
      }
    });
    sock.on('error', () => undefined);
  });
  const listening = new Promise<void>((res) => server.listen(file, res));
  const close = () => {
    for (const s of sockets) s.destroy();
    server.close();
    if (process.platform !== 'win32') fs.rmSync(file, { force: true });
  };
  return { file, received, listening, close, sockets };
}

const until = async (cond: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('DiscordRpc against a fake Discord', () => {
  it('handshake, status, update, and clearing on stop', async () => {
    const d = fakeDiscord();
    await d.listening;
    const rpc = new DiscordRpc({ clientId: '42', pid: 777, paths: () => ['/definitely/not/there', d.file], retryMs: 50, minGapMs: 0 });
    try {
      rpc.setActivity({ details: 'В главном меню', state: 'Chald Launcher' }); // set before connecting: must be sent after READY
      rpc.start();
      await until(() => d.received.some((f) => f.op === 1 && f.data.cmd === 'SET_ACTIVITY'));
      expect(d.received[0]).toEqual({ op: 0, data: { v: 1, client_id: '42' } });
      const first = d.received.find((f) => f.op === 1)!;
      expect(first.data.args.pid).toBe(777);
      expect(first.data.args.activity.details).toBe('В главном меню');

      rpc.setActivity({ details: 'В настройках' });
      await until(() => d.received.filter((f) => f.op === 1).length === 2);
      expect(d.received.filter((f) => f.op === 1)[1]!.data.args.activity.details).toBe('В настройках');

      rpc.setActivity({ details: 'В настройках' }); // same thing: not sent again
      await new Promise((r) => setTimeout(r, 80));
      expect(d.received.filter((f) => f.op === 1)).toHaveLength(2);

      rpc.stop();
      await until(() => d.received.filter((f) => f.op === 1).length === 3);
      expect(d.received.filter((f) => f.op === 1)[2]!.data.args.activity).toBeNull();
    } finally {
      rpc.stop();
      d.close();
    }
  });

  it('keeps trying while Discord is not running and connects when it appears', async () => {
    const d = fakeDiscord();
    const rpc = new DiscordRpc({ clientId: '1', pid: 1, paths: () => [d.file], retryMs: 40, minGapMs: 0 });
    try {
      rpc.setActivity({ details: 'Привет' });
      rpc.start(); // nobody listens yet
      await new Promise((r) => setTimeout(r, 100));
      await d.listening;
      await until(() => d.received.some((f) => f.op === 1));
      expect(d.received.find((f) => f.op === 1)!.data.args.activity.details).toBe('Привет');
    } finally {
      rpc.stop();
      d.close();
    }
  });

  it('reconnects after Discord restarts and sends the status again', async () => {
    const d = fakeDiscord();
    await d.listening;
    const rpc = new DiscordRpc({ clientId: '1', pid: 1, paths: () => [d.file], retryMs: 40, minGapMs: 0 });
    try {
      rpc.setActivity({ details: 'Снова' });
      rpc.start();
      await until(() => d.received.filter((f) => f.op === 1).length === 1);
      for (const s of d.sockets) s.destroy(); // Discord closed the pipe
      await until(() => d.received.filter((f) => f.op === 1).length === 2);
    } finally {
      rpc.stop();
      d.close();
    }
  });
});
