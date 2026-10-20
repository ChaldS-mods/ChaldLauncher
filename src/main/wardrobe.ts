import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { AccountSkin, SkinEntry, SkinImportResult } from '../shared/types';
import { isSlimSkin, isValidSkinSize, type SkinVariant } from '../shared/skin';
import { AppError } from './errors';
import { netRequest } from './net';
import { decodePngRgba, readPngHeader } from './png';
import { exists, readJson, writeJsonAtomic } from './storage';

export const MAX_SKINS = 100;
export const MAX_SKIN_BYTES = 64 * 1024;
const API = 'https://api.minecraftservices.com';
const TEXTURES_HOST = 'textures.minecraft.net';
const ID_RE = /^[a-f0-9]{12}$/;

interface Stored { id: string; name: string; variant: SkinVariant; addedAt: string; sha256: string }
interface Index { version: 1; skins: Stored[] }

const dataUrl = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;

export function cleanSkinName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32);
}

/** Throws a user-readable error unless this is a PNG skin of an accepted size. Returns the detected model. */
export function inspectSkin(png: Buffer): { variant: SkinVariant } {
  if (png.length > MAX_SKIN_BYTES) throw new AppError('SKIN_INVALID', `Файл слишком большой (больше ${MAX_SKIN_BYTES / 1024} КБ): это не похоже на скин.`);
  const h = readPngHeader(png);
  if (!h) throw new AppError('SKIN_INVALID', 'Это не PNG-файл.');
  if (!isValidSkinSize(h.width, h.height)) throw new AppError('SKIN_INVALID', `Размер скина должен быть 64×64 или 64×32, а у файла ${h.width}×${h.height}.`);
  const px = decodePngRgba(png);
  return { variant: px && isSlimSkin(px.rgba, px.width, px.height) ? 'slim' : 'classic' };
}

/** The active skin from GET /minecraft/profile, or null (nothing useful there). */
export function pickActiveSkin(profile: unknown): { url: string; variant: SkinVariant } | null {
  const skins = (profile as { skins?: { state?: string; url?: string; variant?: string }[] } | null)?.skins;
  const s = skins?.find((k) => k.state === 'ACTIVE' && typeof k.url === 'string');
  if (!s?.url) return null;
  return { url: s.url, variant: s.variant === 'SLIM' ? 'slim' : 'classic' };
}

/** Skin textures live on textures.minecraft.net (the profile returns an http:// link); we only ever fetch that host over https. */
export function texturesUrl(raw: string): string {
  let u: URL;
  try { u = new URL(raw); } catch { throw new AppError('SKIN_URL', 'Mojang вернул некорректную ссылку на скин'); }
  if (u.hostname !== TEXTURES_HOST) throw new AppError('SKIN_URL', 'Ссылка на скин ведёт не на сервер Minecraft: не загружаю');
  u.protocol = 'https:';
  u.port = '';
  return u.toString();
}

function apiError(status: number, text: string): AppError {
  let detail = '';
  try {
    const j = JSON.parse(text) as { errorMessage?: string; error?: string };
    detail = j.errorMessage ?? j.error ?? '';
  } catch { /* not json */ }
  if (status === 401 || status === 403) return new AppError('SKIN_AUTH', 'Mojang не принял сессию. Выйди и снова войди в аккаунт Microsoft.');
  if (status === 429) return new AppError('SKIN_RATE', 'Mojang ограничивает частоту смены скина. Подожди минуту и попробуй снова.');
  if (status === 400) return new AppError('SKIN_REJECTED', `Mojang не принял файл скина${detail ? `: ${detail}` : ''}.`);
  return new AppError('SKIN_HTTP', `Не удалось сменить скин (HTTP ${status}${detail ? `: ${detail}` : ''}).`);
}

export interface WardrobeOptions {
  /** Minecraft access token of the signed-in Microsoft account; throws when there is none. Never leaves the main process. */
  getToken: () => Promise<string>;
  apiBase?: string;
}

export class WardrobeService {
  private lock: Promise<unknown> = Promise.resolve();
  private api: string;

  constructor(private dir: string, private o: WardrobeOptions) {
    this.api = o.apiBase ?? API;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  private get indexFile(): string { return path.join(this.dir, 'index.json'); }
  private pngFile(id: string): string {
    if (!ID_RE.test(id)) throw new AppError('SKIN_ID', 'Некорректный идентификатор скина');
    return path.join(this.dir, `${id}.png`);
  }

  private async readIndex(): Promise<Index> {
    try {
      const j = await readJson<Index>(this.indexFile);
      const skins = Array.isArray(j?.skins) ? j.skins.filter((s) => ID_RE.test(s.id) && (s.variant === 'classic' || s.variant === 'slim') && typeof s.name === 'string') : [];
      return { version: 1, skins };
    } catch {
      return { version: 1, skins: [] }; // damaged index: start with an empty wardrobe, the PNG files stay on disk
    }
  }

  private async view(s: Stored): Promise<SkinEntry | null> {
    try {
      return { id: s.id, name: s.name, variant: s.variant, addedAt: s.addedAt, dataUrl: dataUrl(await fs.readFile(this.pngFile(s.id))) };
    } catch {
      return null; // the file was deleted by hand
    }
  }

  async list(): Promise<SkinEntry[]> {
    const idx = await this.readIndex();
    const views = await Promise.all(idx.skins.map((s) => this.view(s)));
    return views.filter((v): v is SkinEntry => v !== null).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }

  /** Adds a PNG to the wardrobe; an identical skin that is already there is returned instead of adding a copy. */
  private async addPng(png: Buffer, name: string, variant?: SkinVariant): Promise<{ entry: SkinEntry; duplicate: boolean }> {
    const detected = inspectSkin(png);
    const sha256 = createHash('sha256').update(png).digest('hex');
    return this.serial(async () => {
      const idx = await this.readIndex();
      const same = idx.skins.find((s) => s.sha256 === sha256);
      if (same) { const v = await this.view(same); if (v) return { entry: v, duplicate: true }; }
      if (idx.skins.length >= MAX_SKINS) throw new AppError('SKIN_LIMIT', `В гардеробе уже ${MAX_SKINS} скинов. Удали ненужные.`);
      let id = randomBytes(6).toString('hex');
      while (await exists(this.pngFile(id))) id = randomBytes(6).toString('hex');
      await fs.mkdir(this.dir, { recursive: true });
      await fs.writeFile(this.pngFile(id), png);
      const stored: Stored = { id, name: cleanSkinName(name) || 'Скин', variant: variant ?? detected.variant, addedAt: new Date().toISOString(), sha256 };
      idx.skins.push(stored);
      await writeJsonAtomic(this.indexFile, idx);
      return { entry: { id, name: stored.name, variant: stored.variant, addedAt: stored.addedAt, dataUrl: dataUrl(png) }, duplicate: false };
    });
  }

  /** Imports PNG files chosen by the user; bad files are reported, not fatal. */
  async importFiles(files: string[]): Promise<SkinImportResult> {
    const added: SkinEntry[] = [];
    const problems: string[] = [];
    for (const f of files) {
      const base = path.basename(f);
      try {
        const st = await fs.stat(f);
        if (st.size > MAX_SKIN_BYTES) throw new AppError('SKIN_INVALID', `Файл слишком большой (больше ${MAX_SKIN_BYTES / 1024} КБ): это не похоже на скин.`);
        const { entry, duplicate } = await this.addPng(await fs.readFile(f), base.replace(/\.png$/i, ''));
        if (duplicate) problems.push(`«${base}»: такой скин уже есть в гардеробе («${entry.name}»)`);
        else added.push(entry);
      } catch (e) {
        problems.push(`«${base}»: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return { added, problems };
  }

  async update(id: string, patch: { name?: string; variant?: SkinVariant }): Promise<SkinEntry> {
    this.pngFile(id);
    return this.serial(async () => {
      const idx = await this.readIndex();
      const s = idx.skins.find((k) => k.id === id);
      if (!s) throw new AppError('SKIN_NOT_FOUND', 'Скин не найден');
      if (patch.name !== undefined) {
        const n = cleanSkinName(patch.name);
        if (!n) throw new AppError('SKIN_NAME', 'Введи название скина');
        s.name = n;
      }
      if (patch.variant) s.variant = patch.variant;
      await writeJsonAtomic(this.indexFile, idx);
      const v = await this.view(s);
      if (!v) throw new AppError('SKIN_NOT_FOUND', 'Файл скина пропал с диска');
      return v;
    });
  }

  async remove(id: string): Promise<void> {
    const file = this.pngFile(id);
    await this.serial(async () => {
      const idx = await this.readIndex();
      idx.skins = idx.skins.filter((k) => k.id !== id);
      await writeJsonAtomic(this.indexFile, idx);
      await fs.rm(file, { force: true });
    });
  }

  // ---- account (Minecraft services) ----

  private async fetchProfile(token: string): Promise<unknown> {
    const { res, entry } = await netRequest(`${this.api}/minecraft/profile`, { purpose: 'Гардероб: профиль Minecraft', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    const text = await res.text();
    entry.bytes = Buffer.byteLength(text);
    if (!res.ok) throw apiError(res.status, text);
    return JSON.parse(text) as unknown;
  }

  private async downloadCurrent(): Promise<{ png: Buffer; variant: SkinVariant } | null> {
    const token = await this.o.getToken();
    const active = pickActiveSkin(await this.fetchProfile(token));
    if (!active) return null;
    const { res, entry } = await netRequest(texturesUrl(active.url), { purpose: 'Гардероб: текущий скин аккаунта' });
    if (!res.ok) throw new AppError('SKIN_HTTP', `Не удалось загрузить текущий скин (HTTP ${res.status})`);
    const png = Buffer.from(await res.arrayBuffer());
    entry.bytes = png.length;
    inspectSkin(png);
    return { png, variant: active.variant };
  }

  /** The skin that is on the account right now (null = the account has no custom skin). */
  async current(): Promise<AccountSkin | null> {
    const c = await this.downloadCurrent();
    return c ? { variant: c.variant, dataUrl: dataUrl(c.png) } : null;
  }

  async saveCurrent(name: string): Promise<{ entry: SkinEntry; duplicate: boolean }> {
    const c = await this.downloadCurrent();
    if (!c) throw new AppError('SKIN_NONE', 'На аккаунте нет собственного скина: нечего сохранять.');
    return this.addPng(c.png, name, c.variant);
  }

  /** Uploads a skin from the wardrobe to the Microsoft account. */
  async apply(id: string): Promise<AccountSkin> {
    const stored = (await this.readIndex()).skins.find((k) => k.id === id);
    if (!stored) throw new AppError('SKIN_NOT_FOUND', 'Скин не найден');
    let png: Buffer;
    try { png = await fs.readFile(this.pngFile(id)); } catch { throw new AppError('SKIN_NOT_FOUND', 'Файл скина пропал с диска'); }
    const token = await this.o.getToken();
    const form = new FormData();
    form.append('variant', stored.variant);
    form.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'skin.png');
    const { res, entry } = await netRequest(`${this.api}/minecraft/profile/skins`, {
      method: 'POST', purpose: 'Гардероб: смена скина', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, body: form,
    });
    const text = await res.text();
    entry.bytes = Buffer.byteLength(text);
    if (!res.ok) throw apiError(res.status, text);
    return { variant: stored.variant, dataUrl: dataUrl(png) };
  }

  /** Back to the default skin (Steve/Alex, chosen by Mojang from the account's UUID). */
  async reset(): Promise<void> {
    const token = await this.o.getToken();
    const { res, entry } = await netRequest(`${this.api}/minecraft/profile/skins/active`, {
      method: 'DELETE', purpose: 'Гардероб: сброс скина', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    const text = await res.text();
    entry.bytes = Buffer.byteLength(text);
    if (!res.ok) throw apiError(res.status, text);
  }
}
