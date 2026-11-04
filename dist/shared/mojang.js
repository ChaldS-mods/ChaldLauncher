"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STORE_PRODUCT = exports.MOJANG_GAMES = void 0;
exports.parseBedrockServer = parseBedrockServer;
exports.bedrockUri = bedrockUri;
exports.storeUri = storeUri;
/** Other Mojang games the launcher can start (Windows only: they are installed through Microsoft Store). */
exports.MOJANG_GAMES = ['bedrock', 'dungeons', 'legends'];
/**
 * Microsoft Store product IDs (checked against the xbox.com store pages):
 * «Minecraft for Windows» (Bedrock) and the official «Minecraft Launcher», which starts Dungeons and Legends.
 */
exports.STORE_PRODUCT = { bedrock: '9NBLGGH2JHXJ', launcher: '9PGW18NPBZV5' };
const HOST = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const NAME = /^[A-Za-z0-9 _.-]{1,32}$/;
/** A server for the game's server list: a plain host name or IPv4 address, a port, a short name. Anything else is refused. */
function parseBedrockServer(input) {
    const name = input.name.trim();
    const host = input.host.trim().toLowerCase();
    const { port } = input;
    if (!NAME.test(name) || !HOST.test(host))
        return null;
    if (!Number.isInteger(port) || port < 1 || port > 65535)
        return null;
    return { name, host, port };
}
/** `minecraft:` starts the game; `minecraft://?addExternalServer=Name|host:port` also puts a server into its list. */
function bedrockUri(server) {
    return server ? `minecraft://?addExternalServer=${encodeURIComponent(server.name)}|${server.host}:${server.port}` : 'minecraft:';
}
function storeUri(product) {
    return `ms-windows-store://pdp/?ProductId=${exports.STORE_PRODUCT[product]}`;
}
//# sourceMappingURL=mojang.js.map