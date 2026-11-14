import * as path from 'node:path';
import { AppError } from './errors';

/**
 * Resolve `parts` under `base` and refuse anything that escapes it.
 * Does not touch the filesystem (symlinks are not resolved).
 */
export function resolveInside(base: string, ...parts: string[]): string {
  for (const p of parts) {
    if (p.includes('\0')) throw new AppError('PATH_INVALID', 'Путь содержит недопустимые символы');
  }
  const root = path.resolve(base);
  const target = path.resolve(root, ...parts);
  const rel = path.relative(root, target);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    throw new AppError('PATH_TRAVERSAL', 'Путь выходит за пределы разрешённой папки');
  }
  return target;
}

/** A single path segment: no separators, no dot-segments, no control characters. */
export function safeFileName(name: string): string {
  if (
    !name ||
    name.length > 255 ||
    name === '.' ||
    name === '..' ||
    /[\\/\0]/.test(name) ||
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1f]/.test(name) ||
    path.basename(name) !== name
  ) {
    throw new AppError('FILENAME_INVALID', 'Некорректное имя файла');
  }
  return name;
}

export const INSTANCE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isValidInstanceId(id: string): boolean {
  return INSTANCE_ID_RE.test(id);
}

export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'instance';
}

/** Library path from a Maven coordinate: group:artifact:version[:classifier][@ext] */
export function mavenPath(coord: string): string {
  const [main, ext = 'jar'] = coord.split('@');
  const [group, artifact, version, classifier] = (main ?? '').split(':');
  if (!group || !artifact || !version) throw new AppError('MAVEN_INVALID', `Некорректная координата: ${coord}`);
  const file = `${artifact}-${version}${classifier ? '-' + classifier : ''}.${ext}`;
  return [...group.split('.'), artifact, version, file].join('/');
}
