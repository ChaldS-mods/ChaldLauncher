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
exports.sameTarget = sameTarget;
exports.kindAfterChange = kindAfterChange;
exports.backupSaves = backupSaves;
exports.disableMods = disableMods;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const storage_1 = require("./storage");
function sameTarget(a, b) {
    return a.mcVersion === b.mcVersion && a.loader.type === b.loader.type && (a.loader.version ?? null) === (b.loader.version ?? null);
}
/** «Official» and «modded» follow the loader; a kind the user set to «custom» stays as it is. */
function kindAfterChange(kind, loader) {
    if (kind === 'custom')
        return kind;
    return loader === 'vanilla' ? 'official' : 'modded';
}
const MOD_SUFFIX = '.disabled';
/**
 * Copies saves/ to <instance>/backups/saves-<label>-<time> and returns that folder (null: there was nothing to copy).
 * The backup lives outside .minecraft so the game never sees it. A half-copied backup is removed, not left behind.
 */
async function backupSaves(gameDir, label, now = new Date()) {
    const src = path.join(gameDir, 'saves');
    let names;
    try {
        names = await fs.readdir(src);
    }
    catch {
        return null;
    }
    if (names.length === 0)
        return null;
    const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const dest = path.join(path.dirname(gameDir), 'backups', `saves-${label.replace(/[^0-9A-Za-z._+-]/g, '_')}-${stamp}`);
    try {
        await fs.cp(src, dest, { recursive: true, errorOnExist: true });
    }
    catch (e) {
        await fs.rm(dest, { recursive: true, force: true }).catch(() => undefined);
        throw e;
    }
    return dest;
}
/**
 * Renames mods/*.jar to *.jar.disabled (the same marker the «Моды» page uses), so mods built for the old version or
 * loader do not stop the new one from starting. Nothing is deleted: a name that is already taken gets a number.
 * Returns how many mods were switched off.
 */
async function disableMods(gameDir) {
    const dir = path.join(gameDir, 'mods');
    let entries;
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    }
    catch {
        return 0;
    }
    let n = 0;
    for (const e of entries) {
        if (e.isDirectory() || !e.name.endsWith('.jar'))
            continue;
        const from = path.join(dir, e.name);
        let to = from + MOD_SUFFIX;
        for (let i = 1; await (0, storage_1.exists)(to); i++)
            to = path.join(dir, `${e.name.slice(0, -4)}-${i}.jar${MOD_SUFFIX}`);
        await fs.rename(from, to);
        n++;
    }
    return n;
}
//# sourceMappingURL=versionChange.js.map