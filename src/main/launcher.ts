import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import type { AppSettings, GameLogEvent, GameStatusEvent, OpProgress } from '../shared/types';
import type { AuthService } from './auth';
import type { SharedDirs } from './dirs';
import { AppError } from './errors';
import { extractNatives, loadResolvedVersion, verifyInstall } from './installer';
import { detectJava, downloadJava, javaMajor, pickJava } from './java';
import { buildLaunchCommand, redact, splitArgs } from './launchArgs';
import { countModJars, systemMemory } from './memory';
import { memoryWarning, recommendMemory } from '../shared/memory';
import type { InstanceStore } from './instances';
import { currentPlatform, resolveLibraries } from './versionJson';
import { versionPaths } from './versions';

const MAX_LOG_LINES = 5000;

export interface GameDeps {
  dirs: SharedDirs;
  instances: InstanceStore;
  auth: AuthService;
  getSettings: () => Promise<AppSettings>;
  launcherVersion: string;
  onProgress: (p: OpProgress) => void;
  onStatus: (e: GameStatusEvent) => void;
  onLog: (e: GameLogEvent) => void;
}

export class GameManager {
  private procs = new Map<string, ChildProcess>();
  private preparing = new Set<string>();
  private logs = new Map<string, string[]>();
  private aborts = new Map<string, AbortController>();

  constructor(private d: GameDeps) {}

  activeIds(): Set<string> {
    return new Set([...this.procs.keys(), ...this.preparing]);
  }
  runningCount(): number {
    return this.procs.size;
  }
  getLogs(id: string): string[] {
    return (this.logs.get(id) ?? []).slice();
  }

  private pushLog(id: string, line: string): void {
    const buf = this.logs.get(id) ?? [];
    buf.push(line);
    if (buf.length > MAX_LOG_LINES) buf.splice(0, buf.length - MAX_LOG_LINES);
    this.logs.set(id, buf);
    this.d.onLog({ instanceId: id, line });
  }

  private progress(id: string, label: string, fraction: number | null, status: OpProgress['status'] = 'running', message: string | null = null): void {
    this.d.onProgress({ opId: `launch:${id}`, kind: 'launch', instanceId: id, label, fraction, status, message });
  }

  stop(id: string): void {
    this.aborts.get(id)?.abort();
    this.procs.get(id)?.kill();
  }

  async launch(id: string): Promise<void> {
    if (this.procs.has(id) || this.preparing.has(id)) {
      throw new AppError('ALREADY_RUNNING', 'Этот инстанс уже запускается или запущен');
    }
    this.preparing.add(id);
    const ac = new AbortController();
    this.aborts.set(id, ac);
    try {
      await this.prepareAndSpawn(id, ac.signal);
    } catch (e) {
      const cancelled = ac.signal.aborted;
      this.progress(id, cancelled ? 'Запуск отменён' : 'Не удалось запустить', null, cancelled ? 'cancelled' : 'error', cancelled ? null : (e instanceof Error ? e.message : String(e)));
      if (cancelled) return;
      throw e;
    } finally {
      this.preparing.delete(id);
      this.aborts.delete(id);
    }
  }

  private async prepareAndSpawn(id: string, signal: AbortSignal): Promise<void> {
    const { dirs, instances } = this.d;
    const meta = await instances.readMeta(id);
    if (!meta.installed || !meta.versionId) throw new AppError('NOT_INSTALLED', 'Инстанс не установлен. Запусти установку.');
    const settings = await this.d.getSettings();

    this.progress(id, 'Проверка аккаунта…', null);
    const auth = await this.d.auth.getLaunchAuth();

    this.progress(id, 'Проверка файлов игры…', null);
    const problems = await verifyInstall(dirs, meta.versionId);
    if (problems.length) throw new AppError('FILES_MISSING', `${problems.join('; ')}. Запусти восстановление инстанса.`);
    const version = await loadResolvedVersion(dirs, meta.versionId);
    const requiredJava = version.javaVersion?.majorVersion ?? 8;

    const javaPath = await this.resolveJava(meta.settings.javaPath || settings.javaPath, requiredJava, id, signal);

    const platform = currentPlatform();
    const instDir = path.dirname(await instances.gameDir(id));
    const gameDir = await instances.gameDir(id);
    const nativesDir = path.join(instDir, '.natives');
    this.progress(id, 'Подготовка библиотек…', null);
    await extractNatives(resolveLibraries(version, { platform, features: {} }), dirs.libraries, nativesDir);

    const s = meta.settings;
    const width = s.width ?? settings.width;
    const height = s.height ?? settings.height;
    const fullscreen = s.fullscreen ?? settings.fullscreen;
    // Memory: the instance's own value wins; otherwise the automatic pick (computer's RAM + the instance's mods) or the global sliders.
    const { totalMb } = systemMemory();
    const auto = settings.memoryAuto && (s.memoryMinMb == null || s.memoryMaxMb == null)
      ? recommendMemory({ totalMb, modCount: await countModJars(gameDir), loader: meta.loader.type })
      : null;
    const baseMin = auto ? auto.minMb : settings.memoryMinMb;
    const baseMax = auto ? auto.maxMb : settings.memoryMaxMb;
    const maxMb = s.memoryMaxMb ?? baseMax;
    let minMb = s.memoryMinMb ?? baseMin;
    if (minMb > maxMb) {
      if (s.memoryMinMb != null) throw new AppError('SETTINGS_INVALID', 'Минимум памяти больше максимума');
      minMb = maxMb; // the minimum came from the global/auto value and the instance lowered the maximum under it
    }

    const cmd = buildLaunchCommand({
      version, platform, javaPath, gameDir, assetsDir: dirs.assets, librariesDir: dirs.libraries, nativesDir,
      clientJar: versionPaths(dirs.versions, version.inheritsFrom ?? version.id).jar,
      auth, memoryMinMb: minMb, memoryMaxMb: maxMb,
      extraJvmArgs: [...splitArgs(settings.jvmArgs), ...splitArgs(s.jvmArgs)],
      resolution: { width, height }, fullscreen,
      launcherName: 'ChaldLauncher', launcherVersion: this.d.launcherVersion,
      // Forge/NeoForge put `${version_name}.jar` into -DignoreList: it must be the vanilla jar name, or the client is loaded twice.
      versionName: (meta.loader.type === 'forge' || meta.loader.type === 'neoforge') ? version.inheritsFrom : undefined,
    });

    this.logs.set(id, []);
    this.pushLog(id, `[launcher] ${redact([cmd.command, ...cmd.args].join(' '), cmd.secrets)}`);
    this.pushLog(id, `[launcher] память: ${minMb}–${maxMb} МБ (${auto ? 'подобрана автоматически' : s.memoryMinMb != null && s.memoryMaxMb != null ? 'свои настройки инстанса' : 'из настроек'}), ОЗУ компьютера: ${totalMb} МБ`);
    const warn = memoryWarning(maxMb, totalMb);
    if (warn === 'exceeds-ram') this.pushLog(id, '[launcher] Предупреждение: максимум памяти больше, чем ОЗУ компьютера: игра будет сильно тормозить. Уменьши его в настройках.');
    else if (warn === 'tight') this.pushLog(id, '[launcher] Предупреждение: системе остаётся меньше 1,5 ГБ ОЗУ, возможны подвисания компьютера.');

    const child = spawn(cmd.command, cmd.args, { cwd: cmd.cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    this.procs.set(id, child);

    // Every listener is attached synchronously right after spawn(): an `await` in between lets the
    // 'spawn' / 'exit' events fire before anyone listens, which left the UI stuck on "Подготовка библиотек…".
    const pipeLines = (stream: NodeJS.ReadableStream) => {
      let rest = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        const parts = (rest + chunk).split(/\r?\n/);
        rest = parts.pop() ?? '';
        for (const p of parts) this.pushLog(id, redact(p, cmd.secrets));
      });
      stream.on('end', () => rest && this.pushLog(id, redact(rest, cmd.secrets)));
    };
    pipeLines(child.stdout!);
    pipeLines(child.stderr!);

    child.once('exit', (code, sig) => {
      this.procs.delete(id);
      const crashed = (code !== null && code !== 0) || sig !== null;
      this.pushLog(id, `[launcher] процесс завершён, код: ${code ?? sig}`);
      this.d.onStatus({ instanceId: id, status: crashed ? 'crashed' : 'exited', exitCode: code });
    });

    await new Promise<void>((resolve, reject) => {
      child.once('error', (err) => {
        this.procs.delete(id);
        reject(new AppError('SPAWN_FAILED', `Не удалось запустить Java: ${err.message}`));
      });
      child.once('spawn', () => {
        this.progress(id, 'Игра запущена', 1, 'done');
        this.d.onStatus({ instanceId: id, status: 'running', exitCode: null });
        resolve();
      });
    });

    await instances.patchInternal(id, { lastPlayedAt: new Date().toISOString() }).catch(() => undefined);
  }

  /** Finds a suitable Java (configured path, installed one, or downloads Temurin). Used by launch and by loader installers. */
  async ensureJava(configured: string, required: number, report: (label: string, fraction: number | null) => void, signal: AbortSignal): Promise<string> {
    if (configured) {
      const major = await javaMajor(configured);
      if (major == null) throw new AppError('JAVA_INVALID', `Не удалось запустить Java по пути: ${configured}`);
      if (major < required) throw new AppError('JAVA_OLD', `Нужна Java ${required}+, указана Java ${major}`);
      return configured;
    }
    report('Поиск Java…', null);
    const found = pickJava(required, await detectJava(this.d.dirs));
    if (found) return found.path;
    return downloadJava(required, this.d.dirs, report, signal);
  }

  private resolveJava(configured: string, required: number, id: string, signal: AbortSignal): Promise<string> {
    return this.ensureJava(configured, required, (label, fraction) => this.progress(id, label, fraction), signal);
  }
}
