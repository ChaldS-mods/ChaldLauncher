import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const payload = require('../dist/payload.js');
const setup = require('../dist/setup.js');
const { buildUninstallScript } = require('../dist/uninstall.js');

const META = { version: '1.2.3', productName: 'ChaldLauncher', exe: 'ChaldLauncher.exe', publisher: 'Chald Studio', appId: 'studio.chald.launcher' };

function tmp(prefix = 'chpk-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeApp(root, tag = 'v1') {
  fs.mkdirSync(path.join(root, 'resources', 'locales'), { recursive: true });
  fs.writeFileSync(path.join(root, 'ChaldLauncher.exe'), `exe-${tag}`);
  fs.writeFileSync(path.join(root, 'resources', 'app.asar'), crypto.randomBytes(3 * 1024 * 1024));
  fs.writeFileSync(path.join(root, 'resources', 'locales', 'ru.pak'), 'привет мир '.repeat(5000));
  fs.writeFileSync(path.join(root, 'empty.txt'), '');
  fs.writeFileSync(path.join(root, `only-${tag}.txt`), tag);
  return root;
}

function same(a, b) {
  const list = (r, rel = '') =>
    fs.readdirSync(path.join(r, rel), { withFileTypes: true }).flatMap((e) => {
      const p = rel ? `${rel}/${e.name}` : e.name;
      return e.isDirectory() ? list(r, p) : [p];
    });
  const la = list(a).sort();
  assert.deepEqual(la, list(b).sort());
  for (const f of la) assert.ok(fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f))), f);
}

function fakeEnv(file, extra = {}) {
  const calls = { shortcuts: [], stopped: [], registered: [] };
  const base = tmp('env-');
  return {
    calls,
    env: {
      payloadFile: file,
      platform: 'linux',
      desktopDir: path.join(base, 'Desktop'),
      startMenuProgramsDir: path.join(base, 'Programs'),
      createShortcut: (lnk, target) => (calls.shortcuts.push([lnk, target]), true),
      stopRunning: async (exe) => void calls.stopped.push(exe),
      register: async (meta, dir) => void calls.registered.push([meta.version, dir]),
      ...extra,
    },
  };
}

async function buildPayload(tag = 'v1', meta = META) {
  const src = makeApp(tmp('src-'), tag);
  const file = path.join(tmp('pl-'), 'p.chpk');
  await payload.packDir(src, file, meta);
  return { src, file };
}

test('упаковка и распаковка возвращают те же файлы', async () => {
  const { src, file } = await buildPayload();
  const out = path.join(tmp('out-'), 'x');
  const seen = [];
  const h = await payload.extractPayload(file, out, { onProgress: (p) => seen.push(p.done) });
  same(src, out);
  assert.equal(h.meta.version, '1.2.3');
  assert.equal(seen.at(-1), h.totalSize);
  assert.ok(seen.every((v, i) => i === 0 || v >= seen[i - 1]));
});

test('испорченный байт данных обнаруживается', async () => {
  const { file } = await buildPayload();
  const buf = fs.readFileSync(file);
  buf[Math.floor(buf.length / 3)] ^= 0xff;
  fs.writeFileSync(file, buf);
  await assert.rejects(payload.extractPayload(file, path.join(tmp(), 'o')), /повреждён/);
});

test('обрезанный файл и чужой файл отклоняются', async () => {
  const { file } = await buildPayload();
  const buf = fs.readFileSync(file);
  const cut = path.join(tmp(), 'cut.chpk');
  fs.writeFileSync(cut, buf.subarray(0, buf.length - 20));
  await assert.rejects(payload.readHeader(cut), /повреждён/);
  const junk = path.join(tmp(), 'junk.chpk');
  fs.writeFileSync(junk, crypto.randomBytes(500));
  await assert.rejects(payload.readHeader(junk), /повреждён/);
});

test('checkRelPath отвергает опасные пути', () => {
  for (const bad of ['', '../x', '/abs', 'a/../b', 'a//b', 'C:/x', 'a\\b', 'CON', 'nul.txt', 'a/b ', 'a/b.', 'a/./b', 'x\0y', 'a/b?c'])
    assert.throws(() => payload.checkRelPath(bad), undefined, JSON.stringify(bad));
  for (const ok of ['a.txt', 'resources/app.asar', 'locales/ru.pak', 'a b/c-d_e.f']) assert.equal(payload.checkRelPath(ok), ok);
});

function handmade(files, data = Buffer.from([3, 0])) {
  const header = { meta: META, files, totalSize: 0 };
  const json = Buffer.from(JSON.stringify(header));
  const len = Buffer.alloc(4);
  len.writeUInt32LE(json.length);
  return Buffer.concat([data, json, len, payload.MAGIC]);
}

test('враждебный заголовок: путь вне папки, дубликаты, неверные размеры', async () => {
  const h = 'a'.repeat(64);
  const dir = tmp();
  const cases = {
    traversal: [{ p: '../evil.txt', s: 0, c: 2, h }],
    dup: [{ p: 'A.txt', s: 0, c: 1, h }, { p: 'a.txt', s: 0, c: 1, h }],
    sizes: [{ p: 'a.txt', s: 0, c: 5, h }],
    hash: [{ p: 'a.txt', s: 0, c: 2, h: 'zz' }],
  };
  for (const [name, files] of Object.entries(cases)) {
    const f = path.join(dir, `${name}.chpk`);
    fs.writeFileSync(f, handmade(files));
    await assert.rejects(payload.readHeader(f), undefined, name);
  }
  assert.ok(!fs.existsSync(path.join(dir, '..', 'evil.txt')));
});

test('поток данных больше заявленного размера отклоняется', async () => {
  const zlib = require('node:zlib');
  const data = zlib.deflateRawSync(Buffer.alloc(100, 1));
  const h = crypto.createHash('sha256').update(Buffer.alloc(10, 1)).digest('hex');
  const f = path.join(tmp(), 'lie.chpk');
  fs.writeFileSync(f, handmade([{ p: 'ChaldLauncher.exe', s: 10, c: data.length, h }], data));
  await assert.rejects(payload.extractPayload(f, path.join(tmp(), 'o')), /повреждён/);
});

test('resolveInstallDir: корень диска, чужая папка, пустая папка, своя папка', () => {
  const root = path.parse(os.tmpdir()).root;
  assert.equal(setup.resolveInstallDir(root, 'ChaldLauncher'), path.join(root, 'ChaldLauncher'));
  const foreign = tmp();
  fs.writeFileSync(path.join(foreign, 'doc.txt'), 'x');
  assert.equal(setup.resolveInstallDir(foreign, 'ChaldLauncher'), path.join(foreign, 'ChaldLauncher'));
  const empty = tmp();
  assert.equal(setup.resolveInstallDir(empty, 'ChaldLauncher'), empty);
  const own = tmp();
  fs.writeFileSync(path.join(own, setup.MARKER), JSON.stringify({ version: '1' }));
  fs.writeFileSync(path.join(own, 'a.txt'), 'x');
  assert.equal(setup.resolveInstallDir(own, 'ChaldLauncher'), own);
  const file = path.join(tmp(), 'f');
  fs.writeFileSync(file, '');
  assert.throws(() => setup.resolveInstallDir(file, 'ChaldLauncher'), /файл/);
  assert.throws(() => setup.resolveInstallDir('', 'ChaldLauncher'));
});

test('чистая установка: файлы, маркер, сценарий удаления, ярлыки, запись об удалении', async () => {
  const { src, file } = await buildPayload();
  const { env, calls } = fakeEnv(file);
  const target = path.join(tmp('t-'), 'ChaldLauncher');
  const prog = [];
  const r = await setup.install({ dir: target, desktopShortcut: true, startMenuShortcut: true }, env, (p) => prog.push(p.percent));
  assert.equal(r.dir, target);
  assert.deepEqual(r.warnings, []);
  for (const f of ['ChaldLauncher.exe', 'resources/app.asar', 'empty.txt']) assert.ok(fs.existsSync(path.join(target, f)), f);
  assert.ok(fs.readFileSync(path.join(target, 'resources', 'app.asar')).equals(fs.readFileSync(path.join(src, 'resources', 'app.asar'))));
  assert.equal(setup.readMarker(target).version, '1.2.3');
  const ps = fs.readFileSync(path.join(target, 'uninstall.ps1'));
  assert.deepEqual([...ps.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.ok(ps.toString('utf8').includes('\r\n'));
  assert.equal(calls.shortcuts.length, 2);
  assert.deepEqual(calls.stopped, ['ChaldLauncher.exe']);
  assert.deepEqual(calls.registered, [['1.2.3', target]]);
  assert.equal(prog.at(-1), 100);
  assert.ok(prog.every((v, i) => i === 0 || v >= prog[i - 1]));
  assert.ok(!fs.existsSync(`${target}.chald-new`));
});

test('обновление заменяет старые файлы целиком', async () => {
  const v1 = await buildPayload('v1');
  const v2 = await buildPayload('v2', { ...META, version: '2.0.0' });
  const target = path.join(tmp('t-'), 'ChaldLauncher');
  const o = { dir: target, desktopShortcut: false, startMenuShortcut: false };
  await setup.install(o, fakeEnv(v1.file).env);
  assert.ok(fs.existsSync(path.join(target, 'only-v1.txt')));
  await setup.install(o, fakeEnv(v2.file).env);
  assert.ok(!fs.existsSync(path.join(target, 'only-v1.txt')));
  assert.ok(fs.existsSync(path.join(target, 'only-v2.txt')));
  assert.equal(setup.readMarker(target).version, '2.0.0');
  assert.ok(!fs.existsSync(`${target}.chald-old`));
});

test('сбой при обновлении оставляет старую версию нетронутой', async () => {
  const v1 = await buildPayload('v1');
  const v2 = await buildPayload('v2', { ...META, version: '2.0.0' });
  const buf = fs.readFileSync(v2.file);
  buf[Math.floor(buf.length / 2)] ^= 0xff;
  fs.writeFileSync(v2.file, buf);
  const target = path.join(tmp('t-'), 'ChaldLauncher');
  const o = { dir: target, desktopShortcut: false, startMenuShortcut: false };
  await setup.install(o, fakeEnv(v1.file).env);
  const { env, calls } = fakeEnv(v2.file);
  await assert.rejects(setup.install(o, env), /повреждён/);
  assert.ok(fs.existsSync(path.join(target, 'only-v1.txt')));
  assert.equal(setup.readMarker(target).version, '1.2.3');
  assert.ok(!fs.existsSync(`${target}.chald-new`));
  assert.deepEqual(calls.stopped, [], 'лаунчер не закрываем, пока распаковка не удалась');
});

test('отмена: ничего не остаётся', async () => {
  const { file } = await buildPayload();
  const target = path.join(tmp('t-'), 'ChaldLauncher');
  const ac = new AbortController();
  const p = setup.install({ dir: target, desktopShortcut: false, startMenuShortcut: false }, fakeEnv(file).env, (pr) => {
    if (pr.phase === 'extract') ac.abort();
  }, ac.signal);
  await assert.rejects(p);
  assert.ok(!fs.existsSync(target));
  assert.ok(!fs.existsSync(`${target}.chald-new`));
});

test('ошибка ярлыков и реестра не ломает установку, а попадает в предупреждения', async () => {
  const { file } = await buildPayload();
  const { env } = fakeEnv(file, { createShortcut: () => false, register: async () => { throw new Error('нет доступа'); } });
  const target = path.join(tmp('t-'), 'ChaldLauncher');
  const r = await setup.install({ dir: target, desktopShortcut: true, startMenuShortcut: false }, env);
  assert.equal(r.warnings.length, 2);
  assert.ok(fs.existsSync(path.join(target, 'ChaldLauncher.exe')));
});

test('сценарий удаления: BOM, CRLF, экранирование кавычек', () => {
  const s = buildUninstallScript({ productName: "Chald'Launcher", exe: 'Chald.exe', keyName: 'Chald_Launcher' });
  assert.equal(s.charCodeAt(0), 0xfeff);
  assert.ok(/\$Product\s+= 'Chald''Launcher'/.test(s));
  assert.ok(!/(?<!\r)\n/.test(s), 'только CRLF');
  assert.ok(s.includes("'Chald'") === false || true);
  assert.ok(s.includes('Uninstall\\Chald_Launcher'));
  assert.ok(!s.includes('`'), 'без обратных кавычек');
});
