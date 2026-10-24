import { z } from 'zod';
import { PRESENCE_PAGES } from './presence';

export const presencePageSchema = z.enum(PRESENCE_PAGES);

export const offlineNameSchema = z.string().regex(/^[A-Za-z0-9_]{3,16}$/, 'Ник: 3–16 символов, только A-Z, a-z, 0-9 и «_»');

const memory = z.number().int().min(256).max(65536);
const dim = (min: number, max: number) => z.number().int().min(min).max(max);

export const instanceIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'ID: a-z, 0-9, "-" и "_", до 64 символов');

export const instanceSettingsSchema = z
  .object({
    javaPath: z.string().max(1024),
    memoryMinMb: memory.nullable(),
    memoryMaxMb: memory.nullable(),
    jvmArgs: z.string().max(2000),
    width: dim(320, 7680).nullable(),
    height: dim(240, 4320).nullable(),
    fullscreen: z.boolean().nullable(),
  })
  .refine((s) => s.memoryMinMb == null || s.memoryMaxMb == null || s.memoryMinMb <= s.memoryMaxMb, {
    message: 'Минимум памяти не может быть больше максимума',
    path: ['memoryMinMb'],
  });

export const createInstanceSchema = z.object({
  id: instanceIdSchema.optional(),
  name: z.string().trim().min(1, 'Введи название').max(48, 'Не длиннее 48 символов'),
  description: z.string().trim().max(120).default(''),
  mcVersion: z.string().regex(/^[0-9A-Za-z._+-]{1,40}$/, 'Некорректная версия'),
  loader: z.object({
    type: z.enum(['vanilla', 'fabric', 'quilt', 'forge', 'neoforge']),
    version: z.string().max(64).nullable(),
  }),
  kind: z.enum(['official', 'modded', 'custom']),
  coverColor: z.number().int().min(0).max(7).default(0),
  settings: instanceSettingsSchema,
});
export type CreateInstanceInput = z.infer<typeof createInstanceSchema>;

export const updateInstanceSchema = z.object({
  name: z.string().trim().min(1).max(48).optional(),
  description: z.string().trim().max(120).optional(),
  kind: z.enum(['official', 'modded', 'custom']).optional(),
  coverColor: z.number().int().min(0).max(7).optional(),
  settings: instanceSettingsSchema.optional(),
});
export type UpdateInstanceInput = z.infer<typeof updateInstanceSchema>;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Цвет: формат #rrggbb');

const settingsBase = z.object({
  instancesDir: z.string().max(1024),
  downloadsDir: z.string().max(1024),
  javaPath: z.string().max(1024),
  memoryMinMb: memory,
  memoryMaxMb: memory,
  memoryAuto: z.boolean(),
  jvmArgs: z.string().max(2000),
  width: dim(320, 7680),
  height: dim(240, 4320),
  fullscreen: z.boolean(),
  closeBehavior: z.enum(['quit', 'minimize-while-playing']),
  checkUpdates: z.boolean(),
  autoDownloadUpdates: z.boolean(),
  uiSounds: z.boolean(),
  soundVolume: z.number().int().min(0).max(100),
  discordRpc: z.boolean(),
  discordShowInstance: z.boolean(),
  themeBg: hexColor,
  themeAccent: hexColor,
  themeSecondary: hexColor,
  themeHighlight: hexColor,
  updateRepo: z.string().regex(/^$|^[\w.-]+\/[\w.-]+$/, 'Формат: владелец/репозиторий'),
  msClientId: z.string().regex(/^$|^[0-9a-fA-F-]{36}$/, 'Client ID — UUID из Azure'),
  accountMode: z.enum(['microsoft', 'offline']),
  offlineName: z.string().regex(/^$|^[A-Za-z0-9_]{3,16}$/, 'Ник: 3–16 символов, только A-Z, a-z, 0-9 и «_»'),
  lastInstanceId: z.string().max(64).nullable(),
});

export const appSettingsSchema = settingsBase.refine((s) => s.memoryMinMb <= s.memoryMaxMb, {
  message: 'Минимум памяти не может быть больше максимума',
  path: ['memoryMinMb'],
});
export const appSettingsPatchSchema = settingsBase.partial().strict();

export const fileNameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((s) => !/[\\/\0]/.test(s) && s !== '.' && s !== '..', 'Некорректное имя файла');

export const modrinthIdSchema = z.string().regex(/^[A-Za-z0-9]{8}$/, 'Некорректный ID проекта Modrinth');
export const modrinthVersionsSchema = z.object({
  projectId: modrinthIdSchema,
  mcVersion: z.string().regex(/^[0-9A-Za-z._+-]{1,40}$/).nullable(),
  loader: z.enum(['fabric', 'quilt', 'forge', 'neoforge']).nullable(),
});
export const modrinthSearchSchema = z.object({
  query: z.string().trim().max(100),
  type: z.enum(['mod', 'modpack', 'resourcepack']),
  mcVersion: z.string().regex(/^[0-9A-Za-z._+-]{1,40}$/).nullable(),
  loader: z.enum(['fabric', 'quilt', 'forge', 'neoforge']).nullable(),
  sort: z.enum(['relevance', 'downloads', 'follows', 'newest', 'updated']),
  offset: z.number().int().min(0).max(10000),
});
