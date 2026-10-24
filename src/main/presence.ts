import type { LoaderType } from '../shared/types';
import type { PresencePage } from '../shared/presence';
import { DiscordRpc, type Activity } from './discord';

/** Texts of the Discord status for each launcher page. Change them here. */
export const PAGE_LABELS: Record<PresencePage, string> = {
  home: 'В главном меню',
  instances: 'В главном меню',
  versions: 'Выбирает версию Minecraft',
  mods: 'Настраивает моды',
  resourcepacks: 'Настраивает ресурспаки',
  wardrobe: 'В гардеробе',
  modrinth: 'Ищет моды на Modrinth',
  console: 'Смотрит консоль',
  settings: 'В настройках',
};

const LOADER_NAMES: Record<LoaderType, string> = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };

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
}

export function buildActivity(s: PresenceState): Activity {
  const assets = { large_image: LOGO_ASSET, large_text: `Chald Launcher ${s.appVersion}` };
  const buttons = [{ label: 'Скачать лаунчер', url: s.downloadUrl }];
  const p = s.playing;
  if (p) {
    const loader = p.loader === 'vanilla' ? '' : ` · ${LOADER_NAMES[p.loader]}`;
    return {
      details: s.showInstance ? `Играет в «${p.name}»` : 'Играет в Minecraft',
      state: `Minecraft ${p.mcVersion}${loader}`,
      timestamps: { start: Math.floor(p.since / 1000) },
      assets,
      buttons,
    };
  }
  return {
    details: PAGE_LABELS[s.page],
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
  private page: PresencePage = 'instances';
  private playing: PlayingInfo[] = [];
  private readonly startedAt: number;

  constructor(private o: PresenceOptions) {
    this.startedAt = (o.now ?? Date.now)();
  }

  configure(enabled: boolean, showInstance: boolean): void {
    this.showInstance = showInstance;
    const on = enabled && this.o.clientId.length > 0;
    if (on && !this.rpc) {
      this.rpc = (this.o.makeRpc ?? ((id, pid) => new DiscordRpc({ clientId: id, pid, log: (m) => console.log(`[discord] ${m}`) })))(this.o.clientId, this.o.pid);
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
      }),
    );
  }
}
