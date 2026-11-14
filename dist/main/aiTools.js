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
exports.AI_TOOL_DEFS = exports.AI_TOOL_LABELS = void 0;
exports.toolLabel = toolLabel;
exports.cleanDescription = cleanDescription;
exports.runAiTool = runAiTool;
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const jvmPresets_1 = require("../shared/jvmPresets");
const content_1 = require("./content");
const errors_1 = require("./errors");
const modUpdates_1 = require("./modUpdates");
const modrinth_1 = require("./modrinth");
const versions_1 = require("./versions");
/** Russian UI labels for tool names */
exports.AI_TOOL_LABELS = {
    ask_user: 'Задаю вопрос',
    get_system_info: 'Смотрю систему',
    list_instances: 'Смотрю инстансы',
    get_instance: 'Читаю данные инстанса',
    get_instance_status: 'Проверяю установку',
    list_minecraft_versions: 'Ищу версии Minecraft',
    get_loader_versions: 'Ищу версии загрузчика',
    create_instance: 'Создаю инстанс',
    install_instance: 'Устанавливаю игру',
    get_logs: 'Читаю логи',
    list_mods: 'Смотрю моды',
    get_installed_mod_info: 'Читаю описание установленного мода',
    search_modrinth: 'Ищу на Modrinth',
    get_mod_info: 'Читаю описание мода',
    get_mod_versions: 'Смотрю версии мода',
    check_mod_compatibility: 'Проверяю совместимость мода',
    install_mod: 'Ставлю мод',
    install_modpack: 'Ставлю сборку',
    remove_mod: 'Удаляю мод',
    set_mod_enabled: 'Включаю/отключаю мод',
    check_mod_updates: 'Ищу обновления модов',
    update_mod: 'Обновляю мод',
    apply_jvm_preset: 'Ставлю пресет JVM',
};
function toolLabel(name) {
    return exports.AI_TOOL_LABELS[name] ?? name;
}
const LOADERS = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'];
const L4 = ['fabric', 'quilt', 'forge', 'neoforge'];
const INSTANCE = { type: 'string', description: 'Instance id or name' };
const PROJECT = { type: 'string', description: 'Modrinth id or slug from search' };
const KIND = { type: 'string', enum: ['mod', 'resourcepack'] };
function tool(name, description, properties = {}, required = []) {
    return { name, description, parameters: { type: 'object', properties, required } };
}
/**
 * Tools the model may call. Every tool that touches an instance takes the SAME argument name: `instance`.
 * Descriptions are kept SHORT on purpose: they are sent with every request and free tiers allow only ~8k tokens per minute.
 */
exports.AI_TOOL_DEFS = [
    tool('ask_user', 'Poll: show the user a question with clickable options and END your turn. Use it whenever the user must choose (version, loader, which mod, confirm a deletion/update). Call it alone, max once per turn.', {
        question: { type: 'string' },
        options: { type: 'array', items: { type: 'string' }, description: '2-8 short options' },
        multiple: { type: 'boolean', description: 'Allow several answers' },
    }, ['question', 'options']),
    tool('get_system_info', 'Launcher version, OS, RAM, memory settings, newest Minecraft release.'),
    tool('list_instances', 'All instances: id, name, Minecraft/loader versions, state.'),
    tool('get_instance', 'Details and settings of one instance.', { instance: INSTANCE }, ['instance']),
    tool('get_instance_status', 'Install state/progress. waitSeconds (0-45) waits for the install to finish.', { instance: INSTANCE, waitSeconds: { type: 'integer' } }, ['instance']),
    tool('list_minecraft_versions', 'Real Minecraft versions, newest first. Never guess versions.', {
        type: { type: 'string', enum: ['release', 'snapshot', 'all'] }, query: { type: 'string', description: 'Prefix, e.g. 1.20' }, limit: { type: 'integer' },
    }),
    tool('get_loader_versions', 'Loader versions for a Minecraft version. Without loader: which loaders support it.', {
        mcVersion: { type: 'string' }, loader: { type: 'string', enum: L4 }, limit: { type: 'integer' },
    }, ['mcVersion']),
    tool('create_instance', 'Create an instance; loader version is chosen automatically. install=true starts the download.', {
        name: { type: 'string' }, mcVersion: { type: 'string', description: 'e.g. 1.21.1 or latest' }, loader: { type: 'string', enum: LOADERS },
        loaderVersion: { type: 'string', description: 'Leave empty unless the user named one' }, description: { type: 'string' }, install: { type: 'boolean' },
    }, ['name', 'mcVersion', 'loader']),
    tool('install_instance', 'Download Minecraft + loader (background; also repairs).', { instance: INSTANCE, repair: { type: 'boolean' } }, ['instance']),
    tool('get_logs', 'Game logs + automatic findings about the crash cause.', {
        instance: INSTANCE, source: { type: 'string', enum: ['auto', 'session', 'latest', 'crash'] }, errorsOnly: { type: 'boolean' },
        grep: { type: 'string', description: 'a|b filter' }, maxLines: { type: 'integer' },
    }, ['instance']),
    tool('list_mods', 'Installed mods/resource packs with names, versions, projectId.', { instance: INSTANCE, kind: { type: 'string', enum: ['mods', 'resourcepacks'] } }, ['instance']),
    tool('get_installed_mod_info', 'Description, authors, dependencies of an installed mod (from its jar).', { instance: INSTANCE, file: { type: 'string', description: 'File or mod name' } }, ['instance', 'file']),
    tool('search_modrinth', 'Search Modrinth. Pass instance to filter by its version and loader.', {
        query: { type: 'string' }, type: { type: 'string', enum: ['mod', 'modpack', 'resourcepack'] }, instance: { type: 'string' },
        mcVersion: { type: 'string' }, loader: { type: 'string', enum: L4 },
        sort: { type: 'string', enum: ['relevance', 'downloads', 'follows', 'newest', 'updated'] }, limit: { type: 'integer' }, offset: { type: 'integer' },
    }, ['query']),
    tool('get_mod_info', 'Full description of a Modrinth project (paged: use offset=nextOffset to continue). Read before installing.', {
        projectId: PROJECT, offset: { type: 'integer' }, maxChars: { type: 'integer' },
    }, ['projectId']),
    tool('get_mod_versions', 'Versions of a project with loaders, dependencies, changelog.', {
        projectId: PROJECT, instance: { type: 'string' }, mcVersion: { type: 'string' }, loader: { type: 'string', enum: L4 },
        limit: { type: 'integer' }, changelog: { type: 'boolean' },
    }, ['projectId']),
    tool('check_mod_compatibility', 'Dry run: will it install into the instance, and with which dependencies. Call before install_mod.', {
        instance: INSTANCE, projectId: PROJECT, kind: KIND, versionId: { type: 'string' },
    }, ['instance', 'projectId']),
    tool('install_mod', 'Install a mod/resource pack with required dependencies.', {
        instance: INSTANCE, projectId: PROJECT, kind: KIND, versionId: { type: 'string' },
    }, ['instance', 'projectId']),
    tool('install_modpack', 'Install a Modrinth modpack as a NEW instance (background).', { projectId: PROJECT, versionId: { type: 'string' } }, ['projectId']),
    tool('remove_mod', 'Delete a mod/resource pack file.', { instance: INSTANCE, file: { type: 'string' }, kind: { type: 'string', enum: ['mods', 'resourcepacks'] } }, ['instance', 'file']),
    tool('set_mod_enabled', 'Enable or disable a mod.', { instance: INSTANCE, file: { type: 'string' }, enabled: { type: 'boolean' } }, ['instance', 'file', 'enabled']),
    tool('check_mod_updates', 'Which installed mods have updates.', { instance: INSTANCE }, ['instance']),
    tool('update_mod', 'Update one mod; without file updates ALL.', { instance: INSTANCE, file: { type: 'string' } }, ['instance']),
    tool('apply_jvm_preset', 'Apply a JVM preset to an instance (empty instance = global).', {
        preset: { type: 'string', enum: ['none', 'balanced', 'performance', 'lowLatency', 'compatibility'] }, instance: { type: 'string' },
    }, ['preset']),
];
function parseArgs(raw) {
    const text = (raw ?? '').trim();
    if (!text)
        return {};
    let j;
    try {
        j = JSON.parse(text);
    }
    catch {
        throw new errors_1.AppError('AI_ARGS', 'Arguments are not valid JSON. Send a JSON object that follows the tool schema.');
    }
    if (!j || typeof j !== 'object' || Array.isArray(j))
        throw new errors_1.AppError('AI_ARGS', 'Arguments must be a JSON object.');
    return j;
}
const str = (v, fallback = '') => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : fallback);
const bool = (v, fallback = false) => (typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : fallback);
function int(v, fallback, min, max) {
    const n = typeof v === 'string' ? Number(v) : v;
    return typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}
function first(a, ...keys) {
    for (const k of keys) {
        const v = str(a[k]);
        if (v)
            return v;
    }
    return '';
}
function need(value, label) {
    if (!value)
        throw new errors_1.AppError('AI_ARGS', `Missing required argument "${label}".`);
    return value;
}
/** The models mix up `id` / `instanceId` / `instance_id` / `name`: accept all of them. */
const instanceRef = (a) => first(a, 'instance', 'instanceId', 'instance_id', 'id', 'name');
const projectRef = (a) => first(a, 'projectId', 'project_id', 'slug', 'id', 'project');
function normalizeLoader(raw, label = 'loader') {
    const t = str(raw).toLowerCase().replace(/[\s_-]+/g, '');
    if (['vanilla', 'none', 'ванилла', 'чистый', 'без', ''].includes(t))
        return 'vanilla';
    if (t === 'fabric' || t === 'фабрик')
        return 'fabric';
    if (t === 'quilt')
        return 'quilt';
    if (t === 'forge' || t === 'форж')
        return 'forge';
    if (t === 'neoforge' || t === 'neo')
        return 'neoforge';
    throw new errors_1.AppError('AI_ARGS', `Unknown ${label} "${str(raw)}". Allowed: ${LOADERS.join(', ')}.`);
}
const loaderTitle = (l) => (l === 'neoforge' ? 'NeoForge' : l[0].toUpperCase() + l.slice(1));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function bestLoader(list) {
    return list.find((l) => l.recommended) ?? list.find((l) => l.stable) ?? list[0];
}
async function findInstance(s, ref) {
    const q = need(ref, 'instance');
    const all = await s.instances.list(s.ctx());
    const low = q.toLowerCase();
    const exact = all.find((i) => i.id === q) ?? all.find((i) => i.id.toLowerCase() === low) ?? all.find((i) => i.name.toLowerCase() === low);
    if (exact)
        return exact;
    const part = all.filter((i) => i.name.toLowerCase().includes(low) || (i.name.length > 2 && low.includes(i.name.toLowerCase())));
    if (part.length === 1)
        return part[0];
    const fmt = (i) => `${i.id} («${i.name}»)`;
    if (part.length > 1)
        throw new errors_1.AppError('INSTANCE_AMBIGUOUS', `Several instances match «${q}»: ${part.map(fmt).join(', ')}. Use the exact id.`);
    throw new errors_1.AppError('INSTANCE_NOT_FOUND', `Instance «${q}» not found. Existing: ${all.map(fmt).join(', ') || 'none'}.`);
}
async function resolveMc(s, raw) {
    const manifest = await s.catalog.getManifest();
    const latest = manifest.versions.find((v) => v.type === 'release')?.id ?? '';
    const v = raw.trim().replace(/^v/i, '');
    if (!v || v.toLowerCase() === 'latest')
        return latest;
    if (manifest.versions.some((x) => x.id === v))
        return v;
    const similar = manifest.versions.filter((x) => x.type === 'release' && x.id.startsWith(v)).slice(0, 8).map((x) => x.id);
    throw new errors_1.AppError('VERSION_UNKNOWN', `Minecraft version "${v}" does not exist.${similar.length ? ` Similar releases: ${similar.join(', ')}.` : ''} Newest release: ${latest}. Use list_minecraft_versions.`);
}
async function resolveLoaderVersion(loader, mc, wanted) {
    const list = await (0, versions_1.loaderVersions)(loader, mc);
    if (!list.length) {
        const others = await supportedLoaders(mc);
        throw new errors_1.AppError('LOADER_INCOMPATIBLE', `${loaderTitle(loader)} does not support Minecraft ${mc}. Loaders that do: ${others.join(', ') || 'none (vanilla only)'}.`);
    }
    if (!wanted || ['latest', 'auto', 'recommended'].includes(wanted.toLowerCase()))
        return bestLoader(list).version;
    if (list.some((l) => l.version === wanted))
        return wanted;
    throw new errors_1.AppError('LOADER_INCOMPATIBLE', `${loaderTitle(loader)} ${wanted} does not exist for Minecraft ${mc}. Available: ${list.slice(0, 8).map((l) => l.version).join(', ')}.`);
}
async function supportedLoaders(mc) {
    const kinds = ['fabric', 'quilt', 'forge', 'neoforge'];
    const res = await Promise.allSettled(kinds.map((k) => (0, versions_1.loaderVersions)(k, mc)));
    return kinds.filter((_, i) => res[i].status === 'fulfilled' && res[i].value.length > 0);
}
/** Markdown/HTML of a Modrinth description -> plain readable text. */
function cleanDescription(md) {
    return md
        .replace(/\r/g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/<img[^>]*>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, '$1')
        .replace(/^\s{0,3}#{1,6}\s*/gm, '')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
const MAX_RESULT_CHARS = 5_500;
function pack(data) {
    const text = JSON.stringify(data);
    if (text.length <= MAX_RESULT_CHARS)
        return text;
    return JSON.stringify({ truncated: true, note: 'Result was too long and is cut. Ask for less (limit/filters).', preview: text.slice(0, MAX_RESULT_CHARS - 300) });
}
const HINTS = {
    AI_ARGS: 'Fix the arguments according to the tool schema and call again.',
    INSTANCE_NOT_FOUND: 'Call list_instances and use an exact id or name.',
    INSTANCE_AMBIGUOUS: 'Use the exact id from list_instances.',
    VERSION_UNKNOWN: 'Call list_minecraft_versions to see real versions.',
    LOADER_INCOMPATIBLE: 'Call get_loader_versions(mcVersion) to see which loaders and versions exist.',
    NO_COMPATIBLE_VERSION: 'This project has no build for the instance version/loader. Run check_mod_compatibility or get_mod_versions without filters, then tell the user or pick another mod.',
    LOADER_REQUIRED: 'The instance is vanilla and cannot load mods. Create a new instance with a loader (create_instance).',
    ALREADY_INSTALLED: 'Already installed; nothing to do.',
    BUSY: 'The game is running or an installation is in progress. Use get_instance_status or ask the user to close the game.',
    HTTP_ERROR: 'Modrinth or the network refused the request. If the id may be wrong, use search_modrinth to get the real projectId.',
    NET_FAILED: 'No network connection. Tell the user to check the internet or DNS.',
    NOT_ON_MODRINTH: 'This file is not known to Modrinth, so it cannot be updated automatically.',
};
const LOG_FINDINGS = [
    [/UnsupportedClassVersionError|class file version \d+/i, 'Wrong Java version for this Minecraft/mod (class file is newer than the Java). Check the instance Java setting; the launcher normally downloads the right one.'],
    [/OutOfMemoryError|GC overhead limit|Could not reserve enough space/i, 'Out of memory: raise the maximum RAM of the instance (or lower it if the machine has too little).'],
    [/Mixin apply failed|MixinApplyError|InvalidMixinException|MixinTransformerError/i, 'Mixin conflict: a mod is incompatible with the game or another mod. Find its name in the error, update or disable it.'],
    [/Missing or unsupported mandatory dependencies|Unmet dependency|Could not find required mod|ModResolutionException|requires (?:any )?version|depends on/i, 'A required dependency is missing or has the wrong version (often Fabric API, Cloth Config, Architectury, Kotlin libs). Install it (search_modrinth) or update the mod.'],
    [/Duplicate mod|duplicate mods? found|Incompatible mod set/i, 'Duplicate or conflicting mods: look for two files of the same mod in list_mods.'],
    [/NoSuchMethodError|NoSuchFieldError|NoClassDefFoundError|ClassNotFoundException|AbstractMethodError/i, 'A mod does not match the game/loader/other mod version. Run check_mod_updates; the mod named near the error is the suspect.'],
    [/GLFW error|OpenGL|pixel format|Failed to create window/i, 'Graphics driver / OpenGL problem: update the GPU driver. Not caused by mods unless a rendering mod is named.'],
    [/UnknownHostException|Connection reset|Failed to download|SSLHandshake/i, 'Network problem while downloading/connecting.'],
];
const ERROR_LINE = /(ERROR|FATAL|Exception|Caused by|Crash|Mixin apply failed|Failed to|Could not|Missing or unsupported)/;
async function readTail(file, maxBytes) {
    try {
        const fh = await fs.open(file, 'r');
        try {
            const st = await fh.stat();
            const len = Math.min(st.size, maxBytes);
            const buf = Buffer.alloc(len);
            await fh.read(buf, 0, len, st.size - len);
            return buf.toString('utf8');
        }
        finally {
            await fh.close();
        }
    }
    catch {
        return null;
    }
}
async function newestCrashReport(gameDir) {
    const dir = path.join(gameDir, 'crash-reports');
    try {
        const names = (await fs.readdir(dir)).filter((n) => n.endsWith('.txt'));
        const stats = await Promise.all(names.map(async (n) => ({ n, t: (await fs.stat(path.join(dir, n))).mtimeMs })));
        const top = stats.sort((x, y) => y.t - x.t)[0];
        if (!top)
            return null;
        return { name: top.n, text: (await fs.readFile(path.join(dir, top.n), 'utf8')).slice(0, 200_000) };
    }
    catch {
        return null;
    }
}
function applyErrorFilter(lines) {
    const out = [];
    const seen = new Set();
    lines.forEach((l, i) => {
        if (!ERROR_LINE.test(l))
            return;
        for (let k = i; k <= Math.min(lines.length - 1, i + 2); k++) {
            if (!seen.has(k)) {
                seen.add(k);
                out.push(lines[k]);
            }
        }
    });
    return out;
}
const handlers = {
    /** The agent loop intercepts ask_user before it gets here; this only guards a direct call. */
    async ask_user() {
        return { status: 'poll_shown', note: 'The poll is shown to the user; their answer arrives as the next message.' };
    },
    async get_system_info(s) {
        const settings = await s.settings.get();
        let latest = null;
        try {
            latest = (await s.catalog.getManifest()).versions.find((v) => v.type === 'release')?.id ?? null;
        }
        catch { /* offline */ }
        return {
            launcherVersion: s.appVersion,
            platform: `${process.platform}/${process.arch}`,
            totalRamMb: Math.round(os.totalmem() / 1048576),
            freeRamMb: Math.round(os.freemem() / 1048576),
            cpuCores: os.cpus().length,
            memoryAuto: settings.memoryAuto,
            memoryMinMb: settings.memoryMinMb,
            memoryMaxMb: settings.memoryMaxMb,
            jvmArgs: settings.jvmArgs,
            language: settings.language,
            latestMinecraftRelease: latest,
        };
    },
    async list_instances(s) {
        const list = await s.instances.list(s.ctx());
        return list.map((i) => ({
            id: i.id, name: i.name, mcVersion: i.mcVersion, loader: i.loader.type, loaderVersion: i.loader.version,
            state: i.state, stateReason: i.stateReason, running: i.running, modCount: i.modCount, lastPlayedAt: i.lastPlayedAt,
        }));
    },
    async get_instance(s, a) {
        const i = await findInstance(s, instanceRef(a));
        const op = s.lastOp(i.id);
        return {
            id: i.id, name: i.name, description: i.description, mcVersion: i.mcVersion, loader: i.loader, state: i.state, stateReason: i.stateReason,
            installed: i.installed, running: i.running, modCount: i.modCount, resourcePackCount: i.packCount,
            settings: i.settings, createdAt: i.createdAt, lastPlayedAt: i.lastPlayedAt,
            lastOperation: op ? { label: op.label, status: op.status, percent: op.fraction === null ? null : Math.round(op.fraction * 100), message: op.message } : null,
        };
    },
    async get_instance_status(s, a) {
        const ref = instanceRef(a);
        const deadline = Date.now() + int(a.waitSeconds, 0, 0, 45) * 1000;
        let inst = await findInstance(s, ref);
        while (s.installs.has(inst.id) && Date.now() < deadline) {
            await sleep(1500);
            inst = await findInstance(s, inst.id);
        }
        const op = s.lastOp(inst.id);
        const installing = s.installs.has(inst.id);
        return {
            id: inst.id, name: inst.name, state: inst.state, stateReason: inst.stateReason, installing, running: inst.running,
            progress: op ? { label: op.label, status: op.status, percent: op.fraction === null ? null : Math.round(op.fraction * 100), error: op.message } : null,
            next: installing
                ? 'Still installing. Call get_instance_status again with waitSeconds=30, or tell the user it is in progress.'
                : inst.state === 'ready' ? 'Ready to play.' : op?.status === 'error' ? 'Installation failed: explain the error to the user.' : undefined,
        };
    },
    async list_minecraft_versions(s, a) {
        const type = str(a.type, 'release');
        const query = str(a.query);
        const limit = int(a.limit, 15, 1, 50);
        const all = await s.catalog.minecraft();
        const newest = (t) => all.find((v) => v.type === t)?.id ?? null;
        const list = all.filter((v) => (type === 'all' ? v.type === 'release' || v.type === 'snapshot' : v.type === type) && (!query || v.id.startsWith(query)));
        return {
            latestRelease: newest('release'), latestSnapshot: newest('snapshot'), matched: list.length,
            versions: list.slice(0, limit).map((v) => ({ id: v.id, type: v.type, released: v.releaseTime.slice(0, 10) })),
        };
    },
    async get_loader_versions(s, a) {
        const mc = await resolveMc(s, need(first(a, 'mcVersion', 'minecraft', 'version'), 'mcVersion'));
        const limit = int(a.limit, 8, 1, 30);
        if (str(a.loader)) {
            const loader = normalizeLoader(a.loader);
            if (loader === 'vanilla')
                return { mcVersion: mc, note: 'Vanilla has no loader versions.' };
            const list = await (0, versions_1.loaderVersions)(loader, mc);
            const best = bestLoader(list);
            return {
                mcVersion: mc, loader, supported: list.length > 0, best: best?.version ?? null,
                versions: list.slice(0, limit).map((l) => ({ version: l.version, stable: l.stable, recommended: l.recommended ?? false })),
                note: list.length ? undefined : `${loaderTitle(loader)} does not support Minecraft ${mc}.`,
            };
        }
        const kinds = ['fabric', 'quilt', 'forge', 'neoforge'];
        const res = await Promise.allSettled(kinds.map((k) => (0, versions_1.loaderVersions)(k, mc)));
        return {
            mcVersion: mc,
            loaders: kinds.map((k, i) => {
                const r = res[i];
                if (r.status === 'rejected')
                    return { loader: k, supported: null, error: r.reason instanceof Error ? r.reason.message : String(r.reason) };
                return { loader: k, supported: r.value.length > 0, best: bestLoader(r.value)?.version ?? null, versionsCount: r.value.length };
            }),
        };
    },
    async create_instance(s, a) {
        const name = need(str(a.name), 'name').slice(0, 48);
        const loader = normalizeLoader(a.loader);
        const mc = await resolveMc(s, str(a.mcVersion, 'latest'));
        const loaderVersion = loader === 'vanilla' ? null : await resolveLoaderVersion(loader, mc, str(a.loaderVersion));
        const existing = (await s.instances.list(s.ctx())).find((i) => i.name.toLowerCase() === name.toLowerCase() && i.mcVersion === mc && i.loader.type === loader);
        let inst = existing;
        if (!inst) {
            const settings = await s.settings.get();
            inst = await s.instances.create({
                name,
                description: str(a.description).slice(0, 120),
                mcVersion: mc,
                loader: { type: loader, version: loaderVersion },
                kind: loader === 'vanilla' ? 'official' : 'modded',
                coverColor: 0,
                settings: { javaPath: '', memoryMinMb: null, memoryMaxMb: null, jvmArgs: settings.jvmArgs, width: null, height: null, fullscreen: null },
            }, s.ctx());
        }
        let installStarted = false;
        if (bool(a.install) && inst.state !== 'ready' && !s.installs.has(inst.id)) {
            s.startInstall(inst.id);
            installStarted = true;
        }
        const ready = inst.state === 'ready';
        return {
            ok: true, id: inst.id, name: inst.name, mcVersion: mc, loader: { type: loader, version: loaderVersion ?? inst.loader.version },
            reusedExisting: !!existing, installStarted, gameInstalled: ready,
            next: installStarted
                ? 'The instance profile is created but the game is NOT installed yet (download runs in background). Do NOT say it is installed: call get_instance_status with waitSeconds=30 until state is ready.'
                : ready ? 'Instance is ready.' : 'The game is NOT installed. Call install_instance to download it.',
        };
    },
    async install_instance(s, a) {
        const inst = await findInstance(s, instanceRef(a));
        if (s.installs.has(inst.id))
            return { ok: true, alreadyRunning: true, next: 'Installation is already running: use get_instance_status.' };
        if (inst.state === 'ready' && !bool(a.repair))
            return { ok: true, alreadyInstalled: true, id: inst.id, note: 'Already installed. Pass repair=true only to reinstall.' };
        s.startInstall(inst.id);
        return { ok: true, id: inst.id, installStarted: true, gameInstalled: false, next: 'Download just STARTED, the game is NOT installed yet. Do NOT say it is installed: call get_instance_status with waitSeconds=30 until state is ready.' };
    },
    async get_logs(s, a) {
        const inst = await findInstance(s, instanceRef(a));
        const gameDir = await s.instances.gameDir(inst.id);
        const maxLines = int(a.maxLines, 120, 20, 300);
        const wanted = str(a.source, 'auto');
        const session = s.games.getLogs(inst.id);
        let source;
        let lines;
        let crashName = null;
        if (wanted === 'crash') {
            const crash = await newestCrashReport(gameDir);
            if (!crash)
                return { id: inst.id, source: 'crash', lines: [], note: 'No crash reports found for this instance.' };
            crashName = crash.name;
            source = 'crash';
            lines = crash.text.split(/\r?\n/);
        }
        else if (wanted === 'session' || (wanted === 'auto' && session.length)) {
            source = 'session';
            lines = session;
        }
        else {
            const text = await readTail(path.join(gameDir, 'logs', 'latest.log'), 600 * 1024);
            if (text === null) {
                if (session.length) {
                    source = 'session';
                    lines = session;
                }
                else
                    return { id: inst.id, source: 'latest', lines: [], note: 'No logs yet: the game has not been started.' };
            }
            else {
                source = 'latest';
                lines = text.split(/\r?\n/);
            }
        }
        lines = lines.filter((l) => l.trim());
        const findings = [];
        const scan = lines.join('\n');
        for (const [re, cause] of LOG_FINDINGS) {
            const m = re.exec(scan);
            if (m)
                findings.push({ cause, evidence: (lines.find((l) => re.test(l)) ?? m[0]).slice(0, 300) });
        }
        const suspects = /Suspected Mods?:\s*([\s\S]{0,300}?)\n\s*\n/.exec(scan)?.[1]?.replace(/\s+/g, ' ').trim();
        let shown = lines;
        if (bool(a.errorsOnly))
            shown = applyErrorFilter(shown);
        const g = str(a.grep);
        if (g) {
            const parts = g.toLowerCase().split('|').map((x) => x.trim()).filter(Boolean);
            shown = shown.filter((l) => parts.some((p) => l.toLowerCase().includes(p)));
        }
        // crash reports carry the cause at the top, running logs at the end
        const picked = source === 'crash' ? shown.slice(0, maxLines) : shown.slice(-maxLines);
        return {
            id: inst.id, source, crashReport: crashName, totalLines: lines.length, shown: picked.length,
            suspectedMods: suspects || undefined, findings,
            lines: picked.map((l) => (l.length > 400 ? `${l.slice(0, 400)}…` : l)),
        };
    },
    async list_mods(s, a) {
        const inst = await findInstance(s, instanceRef(a));
        const kind = str(a.kind, 'mods') === 'resourcepacks' ? 'resourcepacks' : 'mods';
        const gameDir = await s.instances.gameDir(inst.id);
        const [list, index] = await Promise.all([(0, content_1.listContent)(gameDir, kind, inst.loader.type), (0, modrinth_1.readInstalled)(gameDir)]);
        const byFile = new Map();
        for (const [pid, info] of Object.entries(index.projects))
            byFile.set(info.file, pid);
        return {
            instance: inst.id, kind, total: list.length,
            items: list.slice(0, 150).map((e) => ({
                file: e.file, name: e.name, version: e.version, enabled: e.enabled, sizeKb: Math.round(e.size / 1024),
                projectId: byFile.get(e.file.replace(/\.disabled$/, '')) ?? undefined, warning: e.warning ?? undefined,
            })),
        };
    },
    async get_installed_mod_info(s, a) {
        const inst = await findInstance(s, instanceRef(a));
        const gameDir = await s.instances.gameDir(inst.id);
        const file = await resolveContentFile(s, inst, 'mods', need(first(a, 'file', 'mod', 'name'), 'file'));
        const [info, index] = await Promise.all([(0, content_1.readLocalModDetails)(gameDir, file), (0, modrinth_1.readInstalled)(gameDir)]);
        const projectId = Object.entries(index.projects).find(([, v]) => v.file === file.replace(/\.disabled$/, ''))?.[0];
        return {
            ...info, projectId,
            note: info.description ? undefined : 'The jar has no description. If projectId is set, use get_mod_info; otherwise search_modrinth by the mod name.',
        };
    },
    async search_modrinth(s, a) {
        const query = need(first(a, 'query', 'q'), 'query');
        const type = (['mod', 'modpack', 'resourcepack'].includes(str(a.type)) ? str(a.type) : 'mod');
        const sort = (['relevance', 'downloads', 'follows', 'newest', 'updated'].includes(str(a.sort)) ? str(a.sort) : 'relevance');
        const limit = int(a.limit, 8, 1, 20);
        let mcVersion = null;
        let loader = null;
        const ref = instanceRef(a);
        if (ref) {
            const inst = await findInstance(s, ref);
            mcVersion = inst.mcVersion;
            if (inst.loader.type !== 'vanilla')
                loader = inst.loader.type;
        }
        if (str(a.mcVersion))
            mcVersion = str(a.mcVersion);
        if (str(a.loader)) {
            const l = normalizeLoader(a.loader);
            loader = l === 'vanilla' ? null : l;
        }
        const run = (v, l) => s.modrinth.search({ query, type, mcVersion: v, loader: l, sort, offset: int(a.offset, 0, 0, 1000) }, undefined, { icons: false });
        let r = await run(mcVersion, loader);
        let filtersDropped = false;
        if (r.hits.length === 0 && (mcVersion || loader)) {
            r = await run(null, null);
            filtersDropped = r.hits.length > 0;
        }
        return {
            total: r.total, filters: filtersDropped ? { mcVersion: null, loader: null } : { mcVersion, loader },
            warning: filtersDropped ? `Nothing matched Minecraft ${mcVersion ?? '*'} / ${loader ?? '*'}; these results are UNFILTERED and may not be installable. Verify with check_mod_compatibility.` : undefined,
            hits: r.hits.slice(0, limit).map((h) => ({
                projectId: h.id, slug: h.slug, title: h.title, summary: (h.description ?? '').slice(0, 200),
                author: h.author, downloads: h.downloads, categories: h.categories,
            })),
        };
    },
    async get_mod_info(s, a) {
        const id = need(projectRef(a), 'projectId');
        const p = await s.modrinth.projectDetails(id);
        const text = cleanDescription(p.body || '');
        const offset = int(a.offset, 0, 0, 1_000_000);
        const maxChars = int(a.maxChars, 3500, 500, 8000);
        const slice = text.slice(offset, offset + maxChars);
        const end = offset + slice.length;
        return {
            projectId: p.id, slug: p.slug, title: p.title, type: p.type, summary: p.description,
            downloads: p.downloads, follows: p.follows, categories: p.categories, loaders: p.loaders,
            minecraftVersions: p.gameVersions.slice(-20), clientSide: p.clientSide, serverSide: p.serverSide, license: p.license,
            updated: p.updated?.slice(0, 10) ?? null, links: { source: p.sourceUrl, issues: p.issuesUrl, wiki: p.wikiUrl },
            description: slice || (offset >= text.length ? '' : p.description), descriptionLength: text.length, offset,
            nextOffset: end < text.length ? end : null,
        };
    },
    async get_mod_versions(s, a) {
        const id = need(projectRef(a), 'projectId');
        let mcVersion = str(a.mcVersion) || null;
        let loaders = str(a.loader) ? (0, modrinth_1.loaderFilter)(normalizeLoader(a.loader)) : null;
        const ref = instanceRef(a);
        if (ref) {
            const inst = await findInstance(s, ref);
            mcVersion = mcVersion ?? inst.mcVersion;
            loaders = loaders ?? (0, modrinth_1.loaderFilter)(inst.loader.type);
        }
        const limit = int(a.limit, 6, 1, 15);
        const list = (await s.modrinth.versionDetails(id, { mcVersion, loaders })).slice(0, limit);
        const depIds = [...new Set(list.flatMap((v) => v.dependencies.filter((d) => d.dependency_type === 'required' && d.project_id).map((d) => d.project_id)))].slice(0, 100);
        const titles = new Map((await s.modrinth.projectsLite(depIds).catch(() => [])).map((p) => [p.id, p.title]));
        return {
            projectId: id, filters: { mcVersion, loaders }, count: list.length,
            versions: list.map((v) => ({
                versionId: v.id, versionNumber: v.version_number, name: v.name, type: v.version_type, published: v.date_published.slice(0, 10),
                minecraftVersions: v.game_versions.slice(-8), loaders: v.loaders,
                requiredDependencies: v.dependencies.filter((d) => d.dependency_type === 'required' && d.project_id).map((d) => ({ projectId: d.project_id, title: titles.get(d.project_id) ?? null })),
                file: v.files.find((f) => f.primary)?.filename ?? v.files[0]?.filename,
                changelog: bool(a.changelog) ? (v.changelog ?? '').slice(0, 500) : undefined,
            })),
            note: list.length ? undefined : 'No versions for these filters. Call again without instance/mcVersion/loader to see everything the project offers.',
        };
    },
    async check_mod_compatibility(s, a) {
        const inst = await findInstance(s, instanceRef(a));
        const projectId = need(projectRef(a), 'projectId');
        const kind = str(a.kind, 'mod') === 'resourcepack' ? 'resourcepack' : 'mod';
        const gameDir = await s.instances.gameDir(inst.id);
        try {
            const plan = await (0, modrinth_1.planInstall)(s.modrinth, { gameDir, mcVersion: inst.mcVersion, loader: inst.loader.type, kind }, projectId, undefined, str(a.versionId) || null);
            return {
                compatible: true, instance: inst.id, minecraft: inst.mcVersion, loader: inst.loader.type,
                willInstall: plan.map((p) => ({
                    projectId: p.projectId, title: p.title, versionNumber: p.version.version_number, type: p.version.version_type,
                    file: p.file.filename, requested: p.requested,
                })),
            };
        }
        catch (e) {
            if (e instanceof errors_1.AppError && e.code === 'ALREADY_INSTALLED')
                return { compatible: true, alreadyInstalled: true, note: e.message };
            if (e instanceof errors_1.AppError && (e.code === 'NO_COMPATIBLE_VERSION' || e.code === 'LOADER_REQUIRED')) {
                let supports;
                try {
                    const p = await s.modrinth.projectDetails(projectId);
                    supports = { loaders: p.loaders, minecraftVersions: p.gameVersions.slice(-15) };
                }
                catch { /* optional */ }
                return { compatible: false, reason: e.message, instance: inst.id, minecraft: inst.mcVersion, loader: inst.loader.type, projectSupports: supports };
            }
            throw e;
        }
    },
    async install_mod(s, a) {
        const inst = await findInstance(s, instanceRef(a));
        const projectId = need(projectRef(a), 'projectId');
        const kind = str(a.kind, 'mod') === 'resourcepack' ? 'resourcepack' : 'mod';
        const files = await s.installFromModrinth(inst.id, projectId, kind, str(a.versionId) || null);
        return { ok: true, instance: inst.id, files, note: files.length > 1 ? 'The first file is the requested mod, the others are its required dependencies.' : undefined };
    },
    async install_modpack(s, a) {
        const projectId = need(projectRef(a), 'projectId');
        s.startModpack(projectId, str(a.versionId) || null);
        return { ok: true, started: true, completed: false, message: 'Modpack download STARTED in the background; it is NOT installed yet. The new instance appears in list_instances; follow it with get_instance_status. Do not say it is installed before state is ready.' };
    },
    async remove_mod(s, a) {
        const inst = await findInstance(s, instanceRef(a));
        const kind = str(a.kind, 'mods') === 'resourcepacks' ? 'resourcepacks' : 'mods';
        if (s.games.activeIds().has(inst.id))
            throw new errors_1.AppError('BUSY', 'Останови игру, чтобы менять файлы');
        const file = await resolveContentFile(s, inst, kind, need(first(a, 'file', 'mod', 'name'), 'file'));
        await (0, content_1.removeContent)(await s.instances.gameDir(inst.id), kind, file, true);
        return { ok: true, removed: file };
    },
    async set_mod_enabled(s, a) {
        const inst = await findInstance(s, instanceRef(a));
        if (s.games.activeIds().has(inst.id))
            throw new errors_1.AppError('BUSY', 'Останови игру, чтобы менять файлы');
        const file = await resolveContentFile(s, inst, 'mods', need(first(a, 'file', 'mod', 'name'), 'file'));
        const wantEnabled = bool(a.enabled, true);
        const isEnabled = !file.endsWith('.disabled');
        if (isEnabled !== wantEnabled)
            await (0, content_1.toggleContent)(await s.instances.gameDir(inst.id), 'mods', file);
        return { ok: true, file: wantEnabled ? file.replace(/\.disabled$/, '') : file.endsWith('.disabled') ? file : `${file}.disabled`, enabled: wantEnabled, changed: isEnabled !== wantEnabled };
    },
    async check_mod_updates(s, a) {
        const inst = await findInstance(s, instanceRef(a));
        if (inst.loader.type === 'vanilla')
            throw new errors_1.AppError('LOADER_REQUIRED', 'Instance is vanilla: it has no mods.');
        const gameDir = await s.instances.gameDir(inst.id);
        const report = await (0, modUpdates_1.checkInstalledMods)(s.modrinth, { gameDir, mcVersion: inst.mcVersion, loader: inst.loader.type });
        const withUpdate = report.mods.filter((m) => m.update);
        return {
            instance: inst.id, totalMods: report.mods.length, updatesAvailable: withUpdate.length,
            notOnModrinth: report.mods.filter((m) => m.source === 'unknown').length, error: report.error ?? undefined,
            updates: withUpdate.slice(0, 40).map((m) => ({
                file: m.file, name: m.name, current: m.version, newVersion: m.update.versionNumber, type: m.update.type,
                requiredDeps: m.update.requiredDeps, changelog: m.update.changelog.slice(0, 300),
            })),
        };
    },
    async update_mod(s, a) {
        const inst = await findInstance(s, instanceRef(a));
        if (s.games.activeIds().has(inst.id))
            throw new errors_1.AppError('BUSY', 'Останови игру, чтобы менять файлы');
        if (s.installs.has(inst.id))
            throw new errors_1.AppError('BUSY', 'Идёт установка инстанса: изменение файлов недоступно');
        if (inst.loader.type === 'vanilla')
            throw new errors_1.AppError('LOADER_REQUIRED', 'Instance is vanilla: it has no mods.');
        const gameDir = await s.instances.gameDir(inst.id);
        const target = { gameDir, mcVersion: inst.mcVersion, loader: inst.loader.type };
        const ref = first(a, 'file', 'mod');
        if (ref) {
            const file = await resolveContentFile(s, inst, 'mods', ref);
            const files = await (0, modUpdates_1.updateInstalledMod)(s.modrinth, target, file, () => undefined);
            return { ok: true, updated: [{ file, newFiles: files }] };
        }
        const report = await (0, modUpdates_1.checkInstalledMods)(s.modrinth, target);
        const todo = report.mods.filter((m) => m.update).slice(0, 30);
        const updated = [];
        for (const m of todo) {
            try {
                updated.push({ file: m.file, newFiles: await (0, modUpdates_1.updateInstalledMod)(s.modrinth, target, m.file, () => undefined) });
            }
            catch (e) {
                updated.push({ file: m.file, error: e instanceof Error ? e.message : String(e) });
            }
        }
        return { ok: true, updatedCount: updated.filter((u) => !u.error).length, failed: updated.filter((u) => u.error).length, updated };
    },
    async apply_jvm_preset(s, a) {
        const presetId = str(a.preset, 'balanced');
        const preset = jvmPresets_1.JVM_PRESETS.find((p) => p.id === presetId);
        if (!preset)
            throw new errors_1.AppError('AI_ARGS', `Unknown preset "${presetId}". Allowed: ${jvmPresets_1.JVM_PRESETS.map((p) => p.id).join(', ')}.`);
        const ref = instanceRef(a);
        if (ref) {
            const inst = await findInstance(s, ref);
            await s.instances.update(inst.id, { settings: { ...inst.settings, jvmArgs: preset.args } }, s.ctx());
            return { ok: true, scope: 'instance', id: inst.id, preset: preset.id };
        }
        await s.settings.set({ jvmArgs: preset.args });
        return { ok: true, scope: 'global', preset: preset.id };
    },
};
/** Accepts the exact file name, the name without `.disabled`, or a unique part of the mod's display name. */
async function resolveContentFile(s, inst, kind, ref) {
    const list = await (0, content_1.listContent)(await s.instances.gameDir(inst.id), kind, inst.loader.type);
    const low = ref.toLowerCase();
    const exact = list.find((e) => e.file === ref) ?? list.find((e) => e.file.replace(/\.disabled$/, '') === ref)
        ?? list.find((e) => e.file.toLowerCase() === low) ?? list.find((e) => e.name.toLowerCase() === low);
    if (exact)
        return exact.file;
    const part = list.filter((e) => e.file.toLowerCase().includes(low) || e.name.toLowerCase().includes(low));
    if (part.length === 1)
        return part[0].file;
    if (part.length > 1)
        throw new errors_1.AppError('AI_ARGS', `Several files match «${ref}»: ${part.slice(0, 8).map((e) => e.file).join(', ')}. Use the exact file name.`);
    throw new errors_1.AppError('FILE_MISSING', `No file matches «${ref}» in ${kind}. Call list_mods to see the real names.`);
}
async function runAiTool(s, name, argsJson) {
    const handler = handlers[name];
    if (!handler) {
        const near = Object.keys(handlers).filter((n) => n.includes(name) || name.includes(n)).slice(0, 4);
        return JSON.stringify({ error: `Unknown tool: ${name}`, hint: `Available tools: ${Object.keys(handlers).join(', ')}.${near.length ? ` Did you mean ${near.join(', ')}?` : ''}` });
    }
    try {
        return pack(await handler(s, parseArgs(argsJson)));
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const code = e instanceof errors_1.AppError ? e.code : 'ERROR';
        return JSON.stringify({ error: msg, code, hint: HINTS[code] });
    }
}
//# sourceMappingURL=aiTools.js.map