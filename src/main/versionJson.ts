import * as os from 'node:os';
import { mavenPath } from './paths';

export interface Rule {
  action: 'allow' | 'disallow';
  os?: { name?: string; arch?: string; version?: string };
  features?: Record<string, boolean>;
}
export interface Artifact {
  path?: string;
  url: string;
  sha1?: string;
  size?: number;
}
export interface LibraryEntry {
  name: string;
  downloads?: { artifact?: Artifact; classifiers?: Record<string, Artifact> };
  rules?: Rule[];
  natives?: Record<string, string>;
  extract?: { exclude?: string[] };
  url?: string;
  sha1?: string;
  size?: number;
}
export type ArgItem = string | { rules?: Rule[]; value: string | string[] };
export interface VersionJson {
  id: string;
  inheritsFrom?: string;
  type?: string;
  mainClass: string;
  minecraftArguments?: string;
  arguments?: { game?: ArgItem[]; jvm?: ArgItem[] };
  libraries: LibraryEntry[];
  assetIndex?: { id: string; url: string; sha1: string; size: number; totalSize?: number };
  assets?: string;
  downloads?: { client?: Artifact };
  javaVersion?: { majorVersion: number; component?: string };
}

export interface Platform {
  name: 'windows' | 'osx' | 'linux';
  arch: 'x86' | 'x64' | 'arm64';
  version: string;
}

export function currentPlatform(): Platform {
  const name = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
  const arch = process.arch === 'ia32' ? 'x86' : process.arch === 'arm64' ? 'arm64' : 'x64';
  return { name, arch, version: os.release() };
}

export interface RuleContext {
  platform: Platform;
  features: Record<string, boolean>;
}

function ruleMatches(rule: Rule, ctx: RuleContext): boolean {
  if (rule.os) {
    const { name, arch, version } = rule.os;
    if (name && name !== ctx.platform.name) return false;
    if (arch && arch !== ctx.platform.arch) return false;
    if (version) {
      try {
        if (!new RegExp(version).test(ctx.platform.version)) return false;
      } catch {
        return false;
      }
    }
  }
  if (rule.features) {
    for (const [k, v] of Object.entries(rule.features)) {
      if (!!ctx.features[k] !== v) return false;
    }
  }
  return true;
}

/** No rules = allowed. Otherwise the last matching rule wins; no match = disallowed. */
export function rulesAllow(rules: Rule[] | undefined, ctx: RuleContext): boolean {
  if (!rules || rules.length === 0) return true;
  let allowed = false;
  for (const r of rules) {
    if (ruleMatches(r, ctx)) allowed = r.action === 'allow';
  }
  return allowed;
}

function libKey(name: string): string {
  const [main] = name.split('@');
  const [g, a, , c] = (main ?? '').split(':');
  return `${g}:${a}${c ? ':' + c : ''}`;
}

/** Merge a child profile (e.g. Fabric) over its parent (vanilla). Child entries win. */
export function mergeVersions(parent: VersionJson, child: VersionJson): VersionJson {
  const seen = new Set<string>();
  const libraries: LibraryEntry[] = [];
  for (const lib of [...child.libraries, ...parent.libraries]) {
    const key = libKey(lib.name);
    if (seen.has(key)) continue;
    seen.add(key);
    libraries.push(lib);
  }
  const args =
    parent.arguments || child.arguments
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

export interface ResolvedLibrary {
  name: string;
  artifact: Required<Pick<Artifact, 'path' | 'url'>> & { sha1?: string; size?: number };
  native: boolean;
  extractExclude: string[];
}

function withTrailingSlash(s: string): string {
  return s.endsWith('/') ? s : s + '/';
}

export function resolveLibraries(json: VersionJson, ctx: RuleContext): ResolvedLibrary[] {
  const out: ResolvedLibrary[] = [];
  for (const lib of json.libraries) {
    if (!rulesAllow(lib.rules, ctx)) continue;
    const exclude = lib.extract?.exclude ?? [];

    const plain = lib.downloads?.artifact;
    if (plain) {
      out.push({
        name: lib.name,
        artifact: { path: plain.path ?? mavenPath(lib.name), url: plain.url, sha1: plain.sha1, size: plain.size },
        native: false,
        extractExclude: exclude,
      });
    } else if (!lib.downloads && !lib.natives) {
      // Maven-style entry (Fabric): url is a repository base
      const p = mavenPath(lib.name);
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
        artifact: { path: nativeArt.path ?? mavenPath(`${lib.name}:${nativeKey}`), url: nativeArt.url, sha1: nativeArt.sha1, size: nativeArt.size },
        native: true,
        extractExclude: exclude,
      });
    }
  }
  return out;
}
