import type { LoaderType } from '../shared/types';
import type { PresencePage } from '../shared/presence';
import { DiscordRpc, type Activity } from './discord';

export type PresenceLang = 'en' | 'ru' | 'kk' | 'be';

/** Discord status texts per launcher page, by UI language. */
export const PAGE_LABELS: Record<PresenceLang, Record<PresencePage, string>> = {
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

const PLAYING: Record<PresenceLang, { withName: (name: string) => string; generic: string; download: string }> = {
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

const LOADER_NAMES: Record<LoaderType, string> = {
  vanilla: 'Vanilla',
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
};

/** Name of the image uploaded in the Discord application (Rich Presence → Art Assets). */
export const LOGO_ASSET = 'logo';

export interface PlayingInfo {
  id: string;
  name: string;
  mcVersion: string;
  loader: LoaderType;
  /** ms since epoch */
  since: number;
}

export interface PresenceState {
  page: PresencePage;
  playing: PlayingInfo | null;
  showInstance: boolean;
  appVersion: string;
  /** ms since epoch: when the launcher started */
  startedAt: number;
  downloadUrl: string;
  language: PresenceLang;
}

function langOf(s: PresenceState): PresenceLang {
  return PAGE_LABELS[s.language] ? s.language : 'ru';
}

export function buildActivity(s: PresenceState): Activity {
  const lang = langOf(s);
  const assets = { large_image: LOGO_ASSET, large_text: `Chald Launcher ${s.appVersion}` };
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
    details: PAGE_LABELS[lang][s.page],
    state: `Chald Launcher ${s.appVersion}`,
    timestamps: { start: Math.floor(s.startedAt / 1000) },
    assets,
    buttons,
  };
}

export interface RpcLike {
  start(): void;
  stop(): void;
  setActivity(a: Activity | null): void;
}

export interface PresenceOptions {
  appVersion: string;
  /** Discord application ID; empty = the feature is off */
  clientId: string;
  downloadUrl: string;
  pid: number;
  now?: () => number;
  /** for tests */
  makeRpc?: (clientId: string, pid: number) => RpcLike;
}

/** Keeps track of what the user does in the launcher and mirrors it to Discord while the setting is on. */
export class PresenceService {
  private rpc: RpcLike | null = null;
  private enabled = false;
  private showInstance = true;
  private language: PresenceLang = 'ru';
  private page: PresencePage = 'instances';
  private playing: PlayingInfo[] = [];
  private startedAt: number;

  constructor(private o: PresenceOptions) {
    this.startedAt = (o.now ?? Date.now)();
  }

  configure(enabled: boolean, showInstance: boolean, language?: PresenceLang): void {
    this.showInstance = showInstance;
    if (language && PAGE_LABELS[language]) this.language = language;
    const on = enabled && this.o.clientId.length > 0;
    if (on && !this.rpc) {
      this.rpc = (this.o.makeRpc ?? ((id, pid) => new DiscordRpc({ clientId: id, pid, log: (m) => console.log(`[discord] ${m}`) })))(
        this.o.clientId,
        this.o.pid,
      );
      this.rpc.start();
    } else if (!on && this.rpc) {
      this.rpc.stop();
      this.rpc = null;
    }
    this.enabled = on;
    this.push();
  }

  setPage(page: PresencePage): void {
    this.page = page;
    this.push();
  }

  setLanguage(language: PresenceLang): void {
    if (!PAGE_LABELS[language] || this.language === language) return;
    this.language = language;
    this.push();
  }

  gameStarted(info: PlayingInfo): void {
    this.playing = [...this.playing.filter((p) => p.id !== info.id), info];
    this.push();
  }

  gameStopped(id: string): void {
    if (!this.playing.some((p) => p.id === id)) return;
    this.playing = this.playing.filter((p) => p.id !== id);
    this.push();
  }

  dispose(): void {
    this.rpc?.stop();
    this.rpc = null;
    this.enabled = false;
  }

  private push(): void {
    if (!this.enabled || !this.rpc) return;
    this.rpc.setActivity(
      buildActivity({
        page: this.page,
        playing: this.playing[this.playing.length - 1] ?? null,
        showInstance: this.showInstance,
        appVersion: this.o.appVersion,
        startedAt: this.startedAt,
        downloadUrl: this.o.downloadUrl,
        language: this.language,
      }),
    );
  }
}
