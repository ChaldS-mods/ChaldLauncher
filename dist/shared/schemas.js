"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.modrinthSearchSchema = exports.modrinthVersionsSchema = exports.modrinthIdSchema = exports.fileNameSchema = exports.mojangStoreSchema = exports.mojangLaunchSchema = exports.dnsTestSchema = exports.appSettingsPatchSchema = exports.appSettingsSchema = exports.updateInstanceSchema = exports.createInstanceSchema = exports.instanceSettingsSchema = exports.instanceIdSchema = exports.offlineNameSchema = exports.presencePageSchema = void 0;
const zod_1 = require("zod");
const dns_1 = require("./dns");
const mojang_1 = require("./mojang");
const presence_1 = require("./presence");
exports.presencePageSchema = zod_1.z.enum(presence_1.PRESENCE_PAGES);
exports.offlineNameSchema = zod_1.z.string().regex(/^[A-Za-z0-9_]{3,16}$/, 'Ник: 3–16 символов, только A-Z, a-z, 0-9 и «_»');
const memory = zod_1.z.number().int().min(256).max(65536);
const dim = (min, max) => zod_1.z.number().int().min(min).max(max);
exports.instanceIdSchema = zod_1.z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'ID: a-z, 0-9, "-" и "_", до 64 символов');
exports.instanceSettingsSchema = zod_1.z
    .object({
    javaPath: zod_1.z.string().max(1024),
    memoryMinMb: memory.nullable(),
    memoryMaxMb: memory.nullable(),
    jvmArgs: zod_1.z.string().max(2000),
    width: dim(320, 7680).nullable(),
    height: dim(240, 4320).nullable(),
    fullscreen: zod_1.z.boolean().nullable(),
})
    .refine((s) => s.memoryMinMb == null || s.memoryMaxMb == null || s.memoryMinMb <= s.memoryMaxMb, {
    message: 'Минимум памяти не может быть больше максимума',
    path: ['memoryMinMb'],
});
exports.createInstanceSchema = zod_1.z.object({
    id: exports.instanceIdSchema.optional(),
    name: zod_1.z.string().trim().min(1, 'Введи название').max(48, 'Не длиннее 48 символов'),
    description: zod_1.z.string().trim().max(120).default(''),
    mcVersion: zod_1.z.string().regex(/^[0-9A-Za-z._+-]{1,40}$/, 'Некорректная версия'),
    loader: zod_1.z.object({
        type: zod_1.z.enum(['vanilla', 'fabric', 'quilt', 'forge', 'neoforge']),
        version: zod_1.z.string().max(64).nullable(),
    }),
    kind: zod_1.z.enum(['official', 'modded', 'custom']),
    coverColor: zod_1.z.number().int().min(0).max(7).default(0),
    settings: exports.instanceSettingsSchema,
});
exports.updateInstanceSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(48).optional(),
    description: zod_1.z.string().trim().max(120).optional(),
    kind: zod_1.z.enum(['official', 'modded', 'custom']).optional(),
    coverColor: zod_1.z.number().int().min(0).max(7).optional(),
    settings: exports.instanceSettingsSchema.optional(),
});
const hexColor = zod_1.z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Цвет: формат #rrggbb');
const settingsBase = zod_1.z.object({
    instancesDir: zod_1.z.string().max(1024),
    downloadsDir: zod_1.z.string().max(1024),
    javaPath: zod_1.z.string().max(1024),
    memoryMinMb: memory,
    memoryMaxMb: memory,
    memoryAuto: zod_1.z.boolean(),
    jvmArgs: zod_1.z.string().max(2000),
    width: dim(320, 7680),
    height: dim(240, 4320),
    fullscreen: zod_1.z.boolean(),
    closeBehavior: zod_1.z.enum(['quit', 'minimize-while-playing']),
    checkUpdates: zod_1.z.boolean(),
    autoDownloadUpdates: zod_1.z.boolean(),
    uiSounds: zod_1.z.boolean(),
    soundVolume: zod_1.z.number().int().min(0).max(100),
    discordRpc: zod_1.z.boolean(),
    discordShowInstance: zod_1.z.boolean(),
    themeBg: hexColor,
    themeAccent: hexColor,
    themeSecondary: hexColor,
    themeHighlight: hexColor,
    uiScale: zod_1.z.number().int().min(80).max(130),
    cornerStyle: zod_1.z.enum(['sharp', 'normal', 'round']),
    glow: zod_1.z.number().int().min(0).max(100),
    fontMode: zod_1.z.enum(['pixel', 'clean']),
    animations: zod_1.z.boolean(),
    compactSidebar: zod_1.z.boolean(),
    hiddenPages: zod_1.z.array(zod_1.z.enum(['home', 'instances', 'versions', 'mods', 'resourcepacks', 'wardrobe', 'modrinth', 'console', 'mojang'])).max(9),
    sidebarSide: zod_1.z.enum(['left', 'right']),
    panelSide: zod_1.z.enum(['right', 'left', 'bottom', 'hidden']),
    panelWidth: zod_1.z.number().int().min(260).max(560),
    showStatusBar: zod_1.z.boolean(),
    customCss: zod_1.z.string().max(20000),
    customHtml: zod_1.z.string().max(20000),
    updateRepo: zod_1.z.string().regex(/^$|^[\w.-]+\/[\w.-]+$/, 'Формат: владелец/репозиторий'),
    dnsMode: zod_1.z.enum(['system', 'plain', 'doh']),
    dnsServers: zod_1.z.string().max(200).refine((v) => v.trim() === '' || (0, dns_1.parseDnsServers)(v) !== null, 'DNS: до 4 IP-адресов через запятую, например 1.1.1.1, 8.8.8.8'),
    dnsDohUrl: zod_1.z.string().max(256).refine((v) => v.trim() === '' || (0, dns_1.isValidDohUrl)(v.trim()), 'DoH: нужна ссылка вида https://cloudflare-dns.com/dns-query'),
    msClientId: zod_1.z.string().regex(/^$|^[0-9a-fA-F-]{36}$/, 'Client ID — UUID из Azure'),
    accountMode: zod_1.z.enum(['microsoft', 'offline']),
    offlineName: zod_1.z.string().regex(/^$|^[A-Za-z0-9_]{3,16}$/, 'Ник: 3–16 символов, только A-Z, a-z, 0-9 и «_»'),
    lastInstanceId: zod_1.z.string().max(64).nullable(),
    language: zod_1.z.enum(['en', 'ru', 'kk', 'be']),
});
exports.appSettingsSchema = settingsBase.refine((s) => s.memoryMinMb <= s.memoryMaxMb, {
    message: 'Минимум памяти не может быть больше максимума',
    path: ['memoryMinMb'],
});
exports.appSettingsPatchSchema = settingsBase.partial().strict();
exports.dnsTestSchema = zod_1.z.object({
    dnsMode: zod_1.z.enum(['system', 'plain', 'doh']),
    dnsServers: zod_1.z.string().max(200),
    dnsDohUrl: zod_1.z.string().max(256),
});
exports.mojangLaunchSchema = zod_1.z.object({
    game: zod_1.z.enum(mojang_1.MOJANG_GAMES),
    server: zod_1.z.object({ name: zod_1.z.string().max(64), host: zod_1.z.string().max(253), port: zod_1.z.number().int() }).optional(),
});
exports.mojangStoreSchema = zod_1.z.object({ game: zod_1.z.enum(mojang_1.MOJANG_GAMES) });
exports.fileNameSchema = zod_1.z
    .string()
    .min(1)
    .max(255)
    .refine((s) => !/[\\/\0]/.test(s) && s !== '.' && s !== '..', 'Некорректное имя файла');
exports.modrinthIdSchema = zod_1.z.string().regex(/^[A-Za-z0-9]{8}$/, 'Некорректный ID проекта Modrinth');
exports.modrinthVersionsSchema = zod_1.z.object({
    projectId: exports.modrinthIdSchema,
    mcVersion: zod_1.z.string().regex(/^[0-9A-Za-z._+-]{1,40}$/).nullable(),
    loader: zod_1.z.enum(['fabric', 'quilt', 'forge', 'neoforge']).nullable(),
});
exports.modrinthSearchSchema = zod_1.z.object({
    query: zod_1.z.string().trim().max(100),
    type: zod_1.z.enum(['mod', 'modpack', 'resourcepack']),
    mcVersion: zod_1.z.string().regex(/^[0-9A-Za-z._+-]{1,40}$/).nullable(),
    loader: zod_1.z.enum(['fabric', 'quilt', 'forge', 'neoforge']).nullable(),
    sort: zod_1.z.enum(['relevance', 'downloads', 'follows', 'newest', 'updated']),
    offset: zod_1.z.number().int().min(0).max(10000),
});
//# sourceMappingURL=schemas.js.map