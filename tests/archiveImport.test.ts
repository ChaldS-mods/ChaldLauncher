import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import AdmZip from 'adm-zip';
import { applyPlan, cleanEntryName, importJars, planArchive } from '../src/main/archiveImport';

let tmp: string;
beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'chald-ar-')); });
afterEach(async () => fs.rm(tmp, { recursive: true, force: true }));

const exists = (p: string) => fs.access(p).then(() => true, () => false);

/** Builds a .zip from {name: content}; names are used exactly as written (so unsafe ones can be tested). */
async function makeZip(files: Record<string, string>, name = 'sborka.zip'): Promise<string> {
  const zip = new AdmZip();
  for (const [n, c] of Object.entries(files)) zip.addFile(n, Buffer.from(c));
  const f = path.join(tmp, name);
  zip.writeZip(f);
  return f;
}


/** A hand-made zip (stored, no compression): AdmZip itself cleans `../` when writing, so a hostile archive has to be built by hand. */
function rawZip(files: Record<string, string>): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameB = Buffer.from(name);
    const data = Buffer.from(content);
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameB.length, 26);
    locals.push(lh, nameB, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameB.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const game = () => path.join(tmp, 'game');

describe('what is inside', () => {
  it('only .jar files at the root -> plain mods', async () => {
    const { plan } = await planArchive(await makeZip({ 'a.jar': '1', 'b.jar': '2', 'c.jar.disabled': '3' }));
    expect(plan).toMatchObject({ kind: 'mods', mods: 3, groups: [], ignored: 0 });
  });

  it('jars inside one wrapper folder, or in a mods/ folder -> plain mods', async () => {
    expect((await planArchive(await makeZip({ 'sborka/a.jar': '1', 'sborka/b.jar': '2' }, 'w.zip'))).plan).toMatchObject({ kind: 'mods', mods: 2 });
    expect((await planArchive(await makeZip({ 'mods/a.jar': '1', 'mods/b.jar': '2' }, 'm.zip'))).plan).toMatchObject({ kind: 'mods', mods: 2 });
    expect((await planArchive(await makeZip({ 'sborka/mods/a.jar': '1' }, 'wm.zip'))).plan).toMatchObject({ kind: 'mods', mods: 1 });
    expect((await planArchive(await makeZip({ 'Mods/a.jar': '1' }, 'cap.zip'))).plan).toMatchObject({ kind: 'mods', mods: 1 });
  });

  it('mods + resourcepack -> asks (mixed), and tells what it found', async () => {
    const { plan } = await planArchive(await makeZip({ 'mods/a.jar': 'aaaa', 'resourcepack/pack.zip': 'zz', 'config/x.toml': 'c', 'README.txt': 'hi' }));
    expect(plan.kind).toBe('mixed');
    expect(plan.mods).toBe(1);
    expect(plan.groups).toEqual([{ dir: 'config', files: 1, bytes: 1 }, { dir: 'resourcepacks', files: 1, bytes: 2 }]);
    expect(plan.ignored).toBe(1); // README at the root is not copied
  });

  it('a wrapper around mixed content is looked through', async () => {
    const { plan } = await planArchive(await makeZip({ 'pack/.minecraft/mods/a.jar': '1', 'pack/.minecraft/shaderpacks/s.zip': '2' }));
    expect(plan.kind).toBe('mixed');
    expect(plan.groups.map((g) => g.dir)).toEqual(['shaderpacks']);
  });

  it('a lone content folder is not mistaken for a wrapper', async () => {
    const { plan } = await planArchive(await makeZip({ 'kubejs/server_scripts/a.js': '1' }));
    expect(plan.groups.map((g) => g.dir)).toEqual(['kubejs']);
  });

  it('modpacks are refused (they have their own installer); junk and empty archives are recognised', async () => {
    expect((await planArchive(await makeZip({ 'modrinth.index.json': '{}', 'overrides/mods/a.jar': '1' }, 'mr.zip'))).plan.kind).toBe('modpack');
    expect((await planArchive(await makeZip({ 'manifest.json': '{"manifestType":"minecraftModpack"}', 'overrides/mods/a.jar': '1' }, 'cf.zip'))).plan.kind).toBe('modpack');
    expect((await planArchive(await makeZip({ 'readme.txt': 'x', '__MACOSX/._a.jar': 'x', '.DS_Store': 'x' }, 'e.zip'))).plan.kind).toBe('empty');
    expect((await planArchive(await makeZip({ 'logs/latest.log': 'x', 'libraries/big.jar': 'x', 'a.jar': '1' }, 'j.zip'))).plan).toMatchObject({ kind: 'mods', mods: 1, ignored: 2 });
  });

  it('not a zip / not a file -> a clear error', async () => {
    const bad = path.join(tmp, 'bad.zip');
    await fs.writeFile(bad, 'this is not a zip');
    await expect(planArchive(bad)).rejects.toMatchObject({ code: 'ARCHIVE_INVALID' });
    await expect(planArchive(tmp)).rejects.toMatchObject({ code: 'CONTENT_TYPE' });
  });
});

describe('safety', () => {
  it('cleanEntryName rejects everything that could leave the folder', () => {
    for (const bad of ['../x.jar', 'a/../../x.jar', '/etc/passwd', 'C:\\x.jar', 'C:/x.jar', 'a\\..\\..\\x', 'a\0b']) expect(cleanEntryName(bad)).toBeNull();
    expect(cleanEntryName('./a//b/./c.jar')).toBe('a/b/c.jar');
    expect(cleanEntryName('a\\b.jar')).toBe('a/b.jar');
  });

  it('zip-slip entries are dropped and nothing is written outside the game folder', async () => {
    const f = path.join(tmp, 'evil.zip');
    await fs.writeFile(f, rawZip({ '../evil.jar': 'x', 'mods/../../evil2.jar': 'x', '/abs/evil3.jar': 'x', 'C:\\evil4.jar': 'x', 'mods/ok.jar': 'fine' }));
    const { zip, plan } = await planArchive(f);
    expect(plan).toMatchObject({ kind: 'mods', mods: 1 });
    await applyPlan(zip, plan, game(), 'all');
    for (const n of ['evil.jar', 'evil2.jar', 'evil3.jar', 'evil4.jar']) {
      expect(await exists(path.join(tmp, n))).toBe(false);
      expect(await exists(path.join(game(), n))).toBe(false);
      expect(await exists(path.join(game(), 'mods', n))).toBe(false);
    }
    expect(await fs.readFile(path.join(game(), 'mods', 'ok.jar'), 'utf8')).toBe('fine');
  });
});

describe('writing', () => {
  it('only mods: mods go to mods/, the rest is left alone', async () => {
    const { zip, plan } = await planArchive(await makeZip({ 'a.jar': '1', 'resourcepacks/p.zip': '2', 'config/c.toml': '3' }));
    expect(await applyPlan(zip, plan, game(), 'mods')).toEqual({ mods: 1, other: 0, skipped: 0 });
    expect(await exists(path.join(game(), 'mods', 'a.jar'))).toBe(true);
    expect(await exists(path.join(game(), 'resourcepacks'))).toBe(false);
    expect(await exists(path.join(game(), 'config'))).toBe(false);
  });

  it('all: every folder goes to its own place (aliases and capitals are normalised)', async () => {
    const { zip, plan } = await planArchive(await makeZip({ 'Mods/a.jar': '1', 'resourcepack/p.zip': '2', 'shaders/s.zip': '3', 'config/sub/c.toml': '4', 'options.txt': 'fov:70', 'notes.txt': 'x' }));
    expect(await applyPlan(zip, plan, game(), 'all')).toEqual({ mods: 1, other: 4, skipped: 0 });
    expect(await exists(path.join(game(), 'mods', 'a.jar'))).toBe(true);
    expect(await exists(path.join(game(), 'resourcepacks', 'p.zip'))).toBe(true);
    expect(await exists(path.join(game(), 'shaderpacks', 's.zip'))).toBe(true);
    expect(await fs.readFile(path.join(game(), 'config', 'sub', 'c.toml'), 'utf8')).toBe('4');
    expect(await exists(path.join(game(), 'options.txt'))).toBe(true);
    expect(await exists(path.join(game(), 'notes.txt'))).toBe(false);
  });

  it('never overwrites what is already there', async () => {
    await fs.mkdir(path.join(game(), 'mods'), { recursive: true });
    await fs.mkdir(path.join(game(), 'config'), { recursive: true });
    await fs.writeFile(path.join(game(), 'mods', 'a.jar'), 'mine');
    await fs.writeFile(path.join(game(), 'config', 'c.toml'), 'my settings');
    const { zip, plan } = await planArchive(await makeZip({ 'mods/a.jar': 'new', 'mods/b.jar': 'new', 'config/c.toml': 'new' }));
    expect(await applyPlan(zip, plan, game(), 'all')).toEqual({ mods: 1, other: 0, skipped: 2 });
    expect(await fs.readFile(path.join(game(), 'mods', 'a.jar'), 'utf8')).toBe('mine');
    expect(await fs.readFile(path.join(game(), 'config', 'c.toml'), 'utf8')).toBe('my settings');
  });

  it('a failure rolls back the files already written', async () => {
    const { zip, plan } = await planArchive(await makeZip({ 'a.jar': '1', 'b.jar': '2', 'c.jar': '3' }));
    const ac = new AbortController();
    const second = plan.items[1]!.entry;
    const orig = second.getData.bind(second);
    second.getData = () => { ac.abort(); return orig(); }; // the user cancels while the second file is being written
    await expect(applyPlan(zip, plan, game(), 'mods', ac.signal)).rejects.toBeTruthy();
    for (const n of ['a.jar', 'b.jar', 'c.jar']) expect(await exists(path.join(game(), 'mods', n))).toBe(false);
  });
});

describe('loose jars', () => {
  it('copies them and skips duplicates instead of failing the whole drop', async () => {
    const a = path.join(tmp, 'a.jar');
    const b = path.join(tmp, 'b.jar');
    await fs.writeFile(a, 'A');
    await fs.writeFile(b, 'B');
    expect(await importJars(game(), [a])).toEqual({ imported: 1, skipped: 0 });
    expect(await importJars(game(), [a, b])).toEqual({ imported: 1, skipped: 1 });
    await expect(importJars(game(), [tmp])).rejects.toMatchObject({ code: 'CONTENT_TYPE' });
  });
});
