/** Other Mojang games the launcher can start (Windows only: they are installed through Microsoft Store). */
export const MOJANG_GAMES = ['bedrock', 'dungeons', 'legends'] as const;
export type MojangGameId = (typeof MOJANG_GAMES)[number];

/**
 * Microsoft Store product IDs (checked against the xbox.com store pages):
 * «Minecraft for Windows» (Bedrock) and the official «Minecraft Launcher», which starts Dungeons and Legends.
 */
export const STORE_PRODUCT = { bedrock: '9NBLGGH2JHXJ', launcher: '9PGW18NPBZV5' } as const;

/** direct: the launcher starts the game itself; launcher: the official Minecraft Launcher is opened and the game is picked there */
export type MojangVia = 'direct' | 'launcher';

export interface MojangGameStatus {
  id: MojangGameId;
  via: MojangVia;
  /** ready: found on this PC; missing: not found (offer the Store) */
  state: 'ready' | 'missing';
}

export interface MojangStatus {
  /** false: not Windows, the page only explains why */
  supported: boolean;
  launcherFound: boolean;
  games: MojangGameStatus[];
}

export interface BedrockServer {
  name: string;
  host: string;
  port: number;
}

const HOST = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const NAME = /^[A-Za-z0-9 _.-]{1,32}$/;

/** A server for the game's server list: a plain host name or IPv4 address, a port, a short name. Anything else is refused. */
export function parseBedrockServer(input: { name: string; host: string; port: number }): BedrockServer | null {
  const name = input.name.trim();
  const host = input.host.trim().toLowerCase();
  const { port } = input;
  if (!NAME.test(name) || !HOST.test(host)) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { name, host, port };
}

/** `minecraft:` starts the game; `minecraft://?addExternalServer=Name|host:port` also puts a server into its list. */
export function bedrockUri(server?: BedrockServer): string {
  return server ? `minecraft://?addExternalServer=${encodeURIComponent(server.name)}|${server.host}:${server.port}` : 'minecraft:';
}

export function storeUri(product: keyof typeof STORE_PRODUCT): string {
  return `ms-windows-store://pdp/?ProductId=${STORE_PRODUCT[product]}`;
}
