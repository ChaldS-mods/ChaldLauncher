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
exports.replaceAppImage = replaceAppImage;
exports.relaunchEnv = relaunchEnv;
const fsp = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const errors_1 = require("./errors");
/**
 * Replaces the AppImage the launcher is running from with the downloaded (already verified) one.
 *
 * The new file is copied next to the target first and then renamed over it: rename is atomic, so a crash or a full disk
 * never leaves a half-written launcher. A running AppImage keeps its old inode mounted, so replacing the file under it
 * is safe on Linux; the new version starts on the next launch.
 */
async function replaceAppImage(source, target) {
    if (!path.isAbsolute(target) || !/\.appimage$/i.test(target)) {
        throw new errors_1.AppError('UPDATE_BAD_TARGET', 'Не удалось определить файл AppImage, который нужно заменить.');
    }
    const tmp = `${target}.new-${process.pid}`;
    try {
        await fsp.copyFile(source, tmp);
        await fsp.chmod(tmp, 0o755);
        await fsp.rename(tmp, target);
    }
    catch (e) {
        await fsp.rm(tmp, { force: true }).catch(() => undefined);
        const code = e.code;
        if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
            throw new errors_1.AppError('UPDATE_NO_WRITE', `Нет прав на запись в ${path.dirname(target)}: обнови лаунчер вручную.`);
        }
        throw e;
    }
}
/**
 * Environment for starting the new AppImage from the old one. AppRun of the running image exports APPDIR/APPIMAGE/…,
 * and a child that inherits them would try to run out of the old (soon unmounted) image.
 */
function relaunchEnv(env) {
    const out = { ...env };
    for (const k of ['APPIMAGE', 'APPDIR', 'ARGV0', 'OWD', 'CHROME_DESKTOP'])
        delete out[k];
    return out;
}
//# sourceMappingURL=selfUpdate.js.map