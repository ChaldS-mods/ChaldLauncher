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
exports.splitArgs = splitArgs;
exports.buildClasspath = buildClasspath;
exports.buildLaunchCommand = buildLaunchCommand;
exports.redact = redact;
const path = __importStar(require("node:path"));
const errors_1 = require("./errors");
const versionJson_1 = require("./versionJson");
/** Split an argument string honoring simple "double" and 'single' quotes. No shell is ever involved. */
function splitArgs(input) {
    const out = [];
    let cur = '';
    let quote = null;
    let has = false;
    for (const ch of input) {
        if (quote) {
            if (ch === quote)
                quote = null;
            else
                cur += ch;
        }
        else if (ch === '"' || ch === "'") {
            quote = ch;
            has = true;
        }
        else if (/\s/.test(ch)) {
            if (has || cur)
                out.push(cur);
            cur = '';
            has = false;
        }
        else {
            cur += ch;
            has = true;
        }
    }
    if (quote)
        throw new errors_1.AppError('ARGS_INVALID', 'Незакрытая кавычка в аргументах JVM');
    if (has || cur)
        out.push(cur);
    return out;
}
function flatten(items, ctx) {
    const out = [];
    for (const it of items ?? []) {
        if (typeof it === 'string')
            out.push(it);
        else if ((0, versionJson_1.rulesAllow)(it.rules, ctx))
            out.push(...(Array.isArray(it.value) ? it.value : [it.value]));
    }
    return out;
}
function substitute(arg, vars) {
    return arg.replace(/\$\{([^}]+)\}/g, (_m, key) => {
        if (!(key in vars))
            throw new errors_1.AppError('LAUNCH_PLACEHOLDER', `Неизвестный параметр запуска: \${${key}}`);
        return vars[key];
    });
}
function buildClasspath(i) {
    const ctx = { platform: i.platform, features: {} };
    const libs = (0, versionJson_1.resolveLibraries)(i.version, ctx)
        .filter((l) => !l.native)
        .map((l) => path.join(i.librariesDir, ...l.artifact.path.split('/')));
    return [...new Set([...libs, i.clientJar])];
}
function buildLaunchCommand(i) {
    const features = { has_custom_resolution: !!i.resolution };
    const ctx = { platform: i.platform, features };
    const classpath = buildClasspath(i).join(path.delimiter);
    const v = i.version;
    const vars = {
        auth_player_name: i.auth.name,
        auth_uuid: i.auth.uuid,
        auth_access_token: i.auth.accessToken,
        auth_session: `token:${i.auth.accessToken}:${i.auth.uuid}`,
        auth_xuid: '',
        clientid: '',
        user_type: i.auth.userType ?? 'msa',
        user_properties: '{}',
        version_name: i.versionName ?? v.id,
        version_type: v.type ?? 'release',
        game_directory: i.gameDir,
        assets_root: i.assetsDir,
        game_assets: i.assetsDir,
        assets_index_name: v.assets ?? v.assetIndex?.id ?? '',
        natives_directory: i.nativesDir,
        library_directory: i.librariesDir,
        classpath_separator: path.delimiter,
        launcher_name: i.launcherName,
        launcher_version: i.launcherVersion,
        classpath,
        resolution_width: String(i.resolution?.width ?? ''),
        resolution_height: String(i.resolution?.height ?? ''),
    };
    let jvm;
    let game;
    if (v.arguments) {
        jvm = flatten(v.arguments.jvm, ctx);
        game = flatten(v.arguments.game, ctx);
    }
    else if (v.minecraftArguments) {
        jvm = ['-Djava.library.path=${natives_directory}', '-Dminecraft.launcher.brand=${launcher_name}', '-Dminecraft.launcher.version=${launcher_version}', '-cp', '${classpath}'];
        game = splitArgs(v.minecraftArguments);
        if (i.resolution)
            game.push('--width', '${resolution_width}', '--height', '${resolution_height}');
    }
    else {
        throw new errors_1.AppError('LAUNCH_NO_ARGS', 'В описании версии нет аргументов запуска');
    }
    if (!jvm.includes('-cp') && !jvm.includes('-classpath'))
        jvm.push('-cp', '${classpath}');
    if (i.fullscreen)
        game.push('--fullscreen');
    const args = [
        `-Xms${i.memoryMinMb}M`,
        `-Xmx${i.memoryMaxMb}M`,
        ...jvm.map((a) => substitute(a, vars)),
        ...i.extraJvmArgs,
        v.mainClass,
        ...game.map((a) => substitute(a, vars)),
    ];
    // Short placeholder tokens (offline: "0") are not secrets, and redacting them would garble the log.
    const secrets = i.auth.accessToken.length >= 8 ? [i.auth.accessToken] : [];
    return { command: i.javaPath, args, cwd: i.gameDir, secrets };
}
function redact(text, secrets) {
    let out = text;
    for (const s of secrets)
        if (s)
            out = out.split(s).join('***');
    return out;
}
//# sourceMappingURL=launchArgs.js.map