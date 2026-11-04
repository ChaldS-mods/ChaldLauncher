import * as path from 'node:path';

/** Shared, read-mostly caches reused by all instances. Never contains user data of an instance. */
export interface SharedDirs {
  root: string;
  versions: string;
  libraries: string;
  assets: string;
  runtime: string;
}

export function sharedDirs(dataDir: string): SharedDirs {
  const root = path.join(dataDir, 'shared');
  return {
    root,
    versions: path.join(root, 'versions'),
    libraries: path.join(root, 'libraries'),
    assets: path.join(root, 'assets'),
    runtime: path.join(root, 'runtime'),
  };
}
