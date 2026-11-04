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
exports.currentPlatform = currentPlatform;
exports.rulesAllow = rulesAllow;
exports.mergeVersions = mergeVersions;
exports.resolveLibraries = resolveLibraries;
const os = __importStar(require("node:os"));
const paths_1 = require("./paths");
function currentPlatform() {
    const name = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
    const arch = process.arch === 'ia32' ? 'x86' : process.arch === 'arm64' ? 'arm64' : 'x64';
    return { name, arch, version: os.release() };
}
function ruleMatches(rule, ctx) {
    if (rule.os) {
        const { name, arch, version } = rule.os;
        if (name && name !== ctx.platform.name)
            return false;
        if (arch && arch !== ctx.platform.arch)
            return false;
        if (version) {
            try {
                if (!new RegExp(version).test(ctx.platform.version))
                    return false;
            }
            catch {
                return false;
            }
        }
    }
    if (rule.features) {
        for (const [k, v] of Object.entries(rule.features)) {
            if (!!ctx.features[k] !== v)
                return false;
        }
    }
    return true;
}
/** No rules = allowed. Otherwise the last matching rule wins; no match = disallowed. */
function rulesAllow(rules, ctx) {
    if (!rules || rules.length === 0)
        return true;
    let allowed = false;
    for (const r of rules) {
        if (ruleMatches(r, ctx))
            allowed = r.action === 'allow';
    }
    return allowed;
}
function libKey(name) {
    const [main] = name.split('@');
    const [g, a, , c] = (main ?? '').split(':');
    return `${g}:${a}${c ? ':' + c : ''}`;
}
/** Merge a child profile (e.g. Fabric) over its parent (vanilla). Child entries win. */
function mergeVersions(parent, child) {
    const seen = new Set();
    const libraries = [];
    for (const lib of [...child.libraries, ...parent.libraries]) {
        const key = libKey(lib.name);
        if (seen.has(key))
            continue;
        seen.add(key);
        libraries.push(lib);
    }
    const args = parent.arguments || child.arguments
        ? {
            game: [...(parent.arguments?.game ?? []), ...(child.arguments?.game ?? [])],
            jvm: [...(parent.arguments?.jvm ?? []), ...(child.arguments?.jvm ?? [])],
        }
        : undefined;
    return {
        ...parent,
        ...child,
        id: child.id,
        mainClass: child.mainClass || parent.mainClass,
        libraries,
        arguments: args,
        minecraftArguments: child.minecraftArguments ?? parent.minecraftArguments,
        assetIndex: child.assetIndex ?? parent.assetIndex,
        assets: child.assets ?? parent.assets,
        downloads: child.downloads ?? parent.downloads,
        javaVersion: child.javaVersion ?? parent.javaVersion,
        type: child.type ?? parent.type,
    };
}
function withTrailingSlash(s) {
    return s.endsWith('/') ? s : s + '/';
}
function resolveLibraries(json, ctx) {
    const out = [];
    for (const lib of json.libraries) {
        if (!rulesAllow(lib.rules, ctx))
            continue;
        const exclude = lib.extract?.exclude ?? [];
        const plain = lib.downloads?.artifact;
        if (plain) {
            out.push({
                name: lib.name,
                artifact: { path: plain.path ?? (0, paths_1.mavenPath)(lib.name), url: plain.url, sha1: plain.sha1, size: plain.size },
                native: false,
                extractExclude: exclude,
            });
        }
        else if (!lib.downloads && !lib.natives) {
            // Maven-style entry (Fabric): url is a repository base
            const p = (0, paths_1.mavenPath)(lib.name);
            out.push({
                name: lib.name,
                artifact: {
                    path: p,
                    url: withTrailingSlash(lib.url ?? 'https://libraries.minecraft.net/') + p,
                    sha1: lib.sha1,
                    size: lib.size,
                },
                native: false,
                extractExclude: exclude,
            });
        }
        // legacy natives (pre-1.19): classifier jars that get unpacked
        const nativeKey = lib.natives?.[ctx.platform.name]?.replace('${arch}', ctx.platform.arch === 'x86' ? '32' : '64');
        const nativeArt = nativeKey ? lib.downloads?.classifiers?.[nativeKey] : undefined;
        if (nativeArt) {
            out.push({
                name: `${lib.name}:${nativeKey}`,
                artifact: { path: nativeArt.path ?? (0, paths_1.mavenPath)(`${lib.name}:${nativeKey}`), url: nativeArt.url, sha1: nativeArt.sha1, size: nativeArt.size },
                native: true,
                extractExclude: exclude,
            });
        }
    }
    return out;
}
//# sourceMappingURL=versionJson.js.map