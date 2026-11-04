"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PresenceService = exports.LOGO_ASSET = exports.PAGE_LABELS = void 0;
exports.buildActivity = buildActivity;
const discord_1 = require("./discord");
/** Discord status texts per launcher page, by UI language. */
exports.PAGE_LABELS = {
    en: {
        home: 'In the main menu',
        instances: 'In the main menu',
        versions: 'Browsing Minecraft versions',
        mods: 'Managing mods',
        resourcepacks: 'Managing resource packs',
        wardrobe: 'In the wardrobe',
        modrinth: 'Browsing Modrinth',
        console: 'Viewing the console',
        mojang: 'Browsing other Mojang games',
        settings: 'In settings',
    },
    ru: {
        home: 'В главном меню',
        instances: 'В главном меню',
        versions: 'Выбирает версию Minecraft',
        mods: 'Настраивает моды',
        resourcepacks: 'Настраивает ресурспаки',
        wardrobe: 'В гардеробе',
        modrinth: 'Ищет моды на Modrinth',
        console: 'Смотрит консоль',
        mojang: 'Смотрит другие игры Mojang',
        settings: 'В настройках',
    },
    kk: {
        home: 'Негізгі мәзірде',
        instances: 'Негізгі мәзірде',
        versions: 'Minecraft нұсқасын таңдауда',
        mods: 'Модтарды баптауда',
        resourcepacks: 'Ресурс пакеттерін баптауда',
        wardrobe: 'Гардеробта',
        modrinth: 'Modrinth-те мод іздеуде',
        console: 'Консольді қарауда',
        mojang: 'Mojang-тың басқа ойындарын қарауда',
        settings: 'Баптауларда',
    },
    be: {
        home: 'У галоўным меню',
        instances: 'У галоўным меню',
        versions: 'Выбірае версію Minecraft',
        mods: 'Наладжвае моды',
        resourcepacks: 'Наладжвае рэсурспакі',
        wardrobe: 'У гардэробе',
        modrinth: 'Шукае моды на Modrinth',
        console: 'Глядзіць кансоль',
        mojang: 'Праглядае іншыя гульні Mojang',
        settings: 'У наладах',
    },
};
const PLAYING = {
    en: {
        withName: (name) => `Playing “${name}”`,
        generic: 'Playing Minecraft',
        download: 'Download launcher',
    },
    ru: {
        withName: (name) => `Играет в «${name}»`,
        generic: 'Играет в Minecraft',
        download: 'Скачать лаунчер',
    },
    kk: {
        withName: (name) => `«${name}» ойнауда`,
        generic: 'Minecraft ойнауда',
        download: 'Лаунчерді жүктеу',
    },
    be: {
        withName: (name) => `Гуляе ў «${name}»`,
        generic: 'Гуляе ў Minecraft',
        download: 'Спампаваць лаўнчар',
    },
};
const LOADER_NAMES = {
    vanilla: 'Vanilla',
    fabric: 'Fabric',
    quilt: 'Quilt',
    forge: 'Forge',
    neoforge: 'NeoForge',
};
/** Name of the image uploaded in the Discord application (Rich Presence → Art Assets). */
exports.LOGO_ASSET = 'logo';
function langOf(s) {
    return exports.PAGE_LABELS[s.language] ? s.language : 'ru';
}
function buildActivity(s) {
    const lang = langOf(s);
    const assets = { large_image: exports.LOGO_ASSET, large_text: `Chald Launcher ${s.appVersion}` };
    const buttons = [{ label: PLAYING[lang].download, url: s.downloadUrl }];
    const p = s.playing;
    if (p) {
        const loader = p.loader === 'vanilla' ? '' : ` · ${LOADER_NAMES[p.loader]}`;
        return {
            details: s.showInstance ? PLAYING[lang].withName(p.name) : PLAYING[lang].generic,
            state: `Minecraft ${p.mcVersion}${loader}`,
            timestamps: { start: Math.floor(p.since / 1000) },
            assets,
            buttons,
        };
    }
    return {
        details: exports.PAGE_LABELS[lang][s.page],
        state: `Chald Launcher ${s.appVersion}`,
        timestamps: { start: Math.floor(s.startedAt / 1000) },
        assets,
        buttons,
    };
}
/** Keeps track of what the user does in the launcher and mirrors it to Discord while the setting is on. */
class PresenceService {
    o;
    rpc = null;
    enabled = false;
    showInstance = true;
    language = 'ru';
    page = 'instances';
    playing = [];
    startedAt;
    constructor(o) {
        this.o = o;
        this.startedAt = (o.now ?? Date.now)();
    }
    configure(enabled, showInstance, language) {
        this.showInstance = showInstance;
        if (language && exports.PAGE_LABELS[language])
            this.language = language;
        const on = enabled && this.o.clientId.length > 0;
        if (on && !this.rpc) {
            this.rpc = (this.o.makeRpc ?? ((id, pid) => new discord_1.DiscordRpc({ clientId: id, pid, log: (m) => console.log(`[discord] ${m}`) })))(this.o.clientId, this.o.pid);
            this.rpc.start();
        }
        else if (!on && this.rpc) {
            this.rpc.stop();
            this.rpc = null;
        }
        this.enabled = on;
        this.push();
    }
    setPage(page) {
        this.page = page;
        this.push();
    }
    setLanguage(language) {
        if (!exports.PAGE_LABELS[language] || this.language === language)
            return;
        this.language = language;
        this.push();
    }
    gameStarted(info) {
        this.playing = [...this.playing.filter((p) => p.id !== info.id), info];
        this.push();
    }
    gameStopped(id) {
        if (!this.playing.some((p) => p.id === id))
            return;
        this.playing = this.playing.filter((p) => p.id !== id);
        this.push();
    }
    dispose() {
        this.rpc?.stop();
        this.rpc = null;
        this.enabled = false;
    }
    push() {
        if (!this.enabled || !this.rpc)
            return;
        this.rpc.setActivity(buildActivity({
            page: this.page,
            playing: this.playing[this.playing.length - 1] ?? null,
            showInstance: this.showInstance,
            appVersion: this.o.appVersion,
            startedAt: this.startedAt,
            downloadUrl: this.o.downloadUrl,
            language: this.language,
        }));
    }
}
exports.PresenceService = PresenceService;
//# sourceMappingURL=presence.js.map