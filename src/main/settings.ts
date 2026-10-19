import * as path from 'node:path';
import type { AppSettings } from '../shared/types';
import { appSettingsPatchSchema, appSettingsSchema } from '../shared/schemas';
import { AppError } from './errors';
import { readJson, writeJsonAtomic } from './storage';

export const DEFAULT_SETTINGS: AppSettings = {
  instancesDir: '',
  downloadsDir: '',
  javaPath: '',
  memoryMinMb: 1024,
  memoryMaxMb: 4096,
  jvmArgs: '-XX:+UseG1GC',
  width: 1280,
  height: 720,
  fullscreen: false,
  closeBehavior: 'quit',
  checkUpdates: true,
  updateRepo: '',
  msClientId: '',
  accountMode: 'microsoft',
  offlineName: '',
  lastInstanceId: null,
};

export class SettingsStore {
  private cache: AppSettings | null = null;

  constructor(private file: string) {}

  async get(): Promise<AppSettings> {
    if (this.cache) return this.cache;
    let stored: unknown = null;
    try {
      stored = await readJson<unknown>(this.file);
    } catch {
      stored = null; // corrupted file: fall back to defaults, do not crash
    }
    const merged = { ...DEFAULT_SETTINGS, ...(typeof stored === 'object' && stored ? stored : {}) };
    const parsed = appSettingsSchema.safeParse(merged);
    this.cache = parsed.success ? parsed.data : { ...DEFAULT_SETTINGS };
    return this.cache;
  }

  async set(patch: unknown): Promise<AppSettings> {
    const p = appSettingsPatchSchema.safeParse(patch);
    if (!p.success) throw new AppError('SETTINGS_INVALID', p.error.issues[0]?.message ?? 'Некорректные настройки');
    const next = { ...(await this.get()), ...p.data };
    const full = appSettingsSchema.safeParse(next);
    if (!full.success) throw new AppError('SETTINGS_INVALID', full.error.issues[0]?.message ?? 'Некорректные настройки');
    for (const key of ['instancesDir', 'downloadsDir'] as const) {
      const v = full.data[key];
      if (v && !path.isAbsolute(v)) throw new AppError('SETTINGS_INVALID', 'Путь к папке должен быть абсолютным');
    }
    if (full.data.javaPath && !path.isAbsolute(full.data.javaPath)) {
      throw new AppError('SETTINGS_INVALID', 'Путь к Java должен быть абсолютным');
    }
    await writeJsonAtomic(this.file, full.data);
    this.cache = full.data;
    return full.data;
  }
}
