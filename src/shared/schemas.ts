import { z } from 'zod';
import { isValidDohUrl, parseDnsServers } from './dns';
import { MOJANG_GAMES } from './mojang';
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
  uiScale: z.number().int().min(80).max(130),
  cornerStyle: z.enum(['sharp', 'normal', 'round']),
  glow: z.number().int().min(0).max(100),
  fontMode: z.enum(['pixel', 'clean']),
  animations: z.boolean(),
  compactSidebar: z.boolean(),
  hiddenPages: z.array(z.enum(['home', 'instances', 'versions', 'mods', 'resourcepacks', 'wardrobe', 'modrinth', 'console', 'mojang'])).max(9),
  sidebarSide: z.enum(['left', 'right']),
  panelSide: z.enum(['right', 'left', 'bottom', 'hidden']),
  panelWidth: z.number().int().min(260).max(560),
  showStatusBar: z.boolean(),
  customCss: z.string().max(20000),
  customHtml: z.string().max(20000),
  updateRepo: z.string().regex(/^$|^[\w.-]+\/[\w.-]+$/, 'Формат: владелец/репозиторий'),
  dnsMode: z.enum(['system', 'plain', 'doh']),
  dnsServers: z.string().max(200).refine((v) => v.trim() === '' || parseDnsServers(v) !== null, 'DNS: до 4 IP-адресов через запятую, например 1.1.1.1, 8.8.8.8'),
  dnsDohUrl: z.string().max(256).refine((v) => v.trim() === '' || isValidDohUrl(v.trim()), 'DoH: нужна ссылка вида https://cloudflare-dns.com/dns-query'),
  msClientId: z.string().regex(/^$|^[0-9a-fA-F-]{36}$/, 'Client ID — UUID из Azure'),
  accountMode: z.enum(['microsoft', 'offline']),
  offlineName: z.string().regex(/^$|^[A-Za-z0-9_]{3,16}$/, 'Ник: 3–16 символов, только A-Z, a-z, 0-9 и «_»'),
  lastInstanceId: z.string().max(64).nullable(),
  language: z.enum(['en', 'ru', 'kk', 'be']),
});

export const appSettingsSchema = settingsBase.refine((s) => s.memoryMinMb <= s.memoryMaxMb, {
  message: 'Минимум памяти не может быть больше максимума',
  path: ['memoryMinMb'],
});
export const appSettingsPatchSchema = settingsBase.partial().strict();

export const dnsTestSchema = z.object({
  dnsMode: z.enum(['system', 'plain', 'doh']),
  dnsServers: z.string().max(200),
  dnsDohUrl: z.string().max(256),
});

export const mojangLaunchSchema = z.object({
  game: z.enum(MOJANG_GAMES),
  server: z.object({ name: z.string().max(64), host: z.string().max(253), port: z.number().int() }).optional(),
});
export const mojangStoreSchema = z.object({ game: z.enum(MOJANG_GAMES) });

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
