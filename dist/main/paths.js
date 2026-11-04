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
exports.INSTANCE_ID_RE = void 0;
exports.resolveInside = resolveInside;
exports.safeFileName = safeFileName;
exports.isValidInstanceId = isValidInstanceId;
exports.slugify = slugify;
exports.mavenPath = mavenPath;
const path = __importStar(require("node:path"));
const errors_1 = require("./errors");
/**
 * Resolve `parts` under `base` and refuse anything that escapes it.
 * Does not touch the filesystem (symlinks are not resolved).
 */
function resolveInside(base, ...parts) {
    for (const p of parts) {
        if (p.includes('\0'))
            throw new errors_1.AppError('PATH_INVALID', 'Путь содержит недопустимые символы');
    }
    const root = path.resolve(base);
    const target = path.resolve(root, ...parts);
    const rel = path.relative(root, target);
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
        throw new errors_1.AppError('PATH_TRAVERSAL', 'Путь выходит за пределы разрешённой папки');
    }
    return target;
}
/** A single path segment: no separators, no dot-segments, no control characters. */
function safeFileName(name) {
    if (!name ||
        name.length > 255 ||
        name === '.' ||
        name === '..' ||
        /[\\/\0]/.test(name) ||
        // eslint-disable-next-line no-control-regex
        /[\x00-\x1f]/.test(name) ||
        path.basename(name) !== name) {
        throw new errors_1.AppError('FILENAME_INVALID', 'Некорректное имя файла');
    }
    return name;
}
exports.INSTANCE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
function isValidInstanceId(id) {
    return exports.INSTANCE_ID_RE.test(id);
}
function slugify(name) {
    const slug = name
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
    return slug || 'instance';
}
/** Library path from a Maven coordinate: group:artifact:version[:classifier][@ext] */
function mavenPath(coord) {
    const [main, ext = 'jar'] = coord.split('@');
    const [group, artifact, version, classifier] = (main ?? '').split(':');
    if (!group || !artifact || !version)
        throw new errors_1.AppError('MAVEN_INVALID', `Некорректная координата: ${coord}`);
    const file = `${artifact}-${version}${classifier ? '-' + classifier : ''}.${ext}`;
    return [...group.split('.'), artifact, version, file].join('/');
}
//# sourceMappingURL=paths.js.map