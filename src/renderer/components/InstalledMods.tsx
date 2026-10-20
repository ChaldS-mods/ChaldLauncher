import { useCallback, useEffect, useRef, useState } from 'react';
import type { InstalledMod, InstalledModsReport, InstanceView } from '../../shared/types';
import { call, errMsg } from '../api';
import { useStore } from '../store';
import { formatDate, formatSize } from '../util';
import { Icon } from './Icon';
import { Markdown } from './Markdown';
import { Empty, Skeleton } from './ui';

export interface InstalledState {
  report: InstalledModsReport | null;
  loading: boolean;
  failure: string | null;
  reload(): Promise<void>;
}

/**
 * Loads the list of installed mods of an instance (recognised on Modrinth, with the available updates).
 * Nothing is requested until `active` is true; the result is kept while the person switches between tabs.
 */
export function useInstalledMods(instId: string | null, active: boolean): InstalledState {
  const [report, setReport] = useState<InstalledModsReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!instId) return;
    const my = ++seq.current;
    setLoading(true);
    try {
      const r = await call('modrinth:installed', { id: instId });
      if (my !== seq.current) return;
      setReport(r);
      setFailure(null);
    } catch (e) {
      if (my !== seq.current) return;
      setFailure(errMsg(e));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [instId]);

  // another instance: forget the old list and drop an answer that is still on its way
  useEffect(() => {
    seq.current++;
    setReport(null);
    setFailure(null);
    setLoading(false);
  }, [instId]);

  useEffect(() => {
    if (active && instId && !report && !loading && !failure) void reload();
  }, [active, instId, report, loading, failure, reload]);

  return { report, loading, failure, reload };
}

export function plural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}
export const modsWord = (n: number) => plural(n, ['мод', 'мода', 'модов']);

const TYPE_TEXT = { release: 'релиз', beta: 'бета', alpha: 'альфа' } as const;

export function updateCount(r: InstalledModsReport | null): number {
  return r && !r.error ? r.mods.filter((m) => m.update).length : 0;
}

interface Props {
  inst: InstanceView | null;
  state: InstalledState;
  locked: boolean;
  onOpen(m: InstalledMod): void;
  onBrowse(): void;
}

export function InstalledMods({ inst, state, locked, onOpen, onBrowse }: Props) {
  const toast = useStore((s) => s.toast);
  const refreshInstances = useStore((s) => s.refreshInstances);
  const op = useStore((s) => (inst ? s.ops[`modrinth:update:${inst.id}`] : undefined));
  const { report, loading, failure, reload } = state;
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);

  if (!inst) {
    return <Empty icon="puzzle" title="Инстанс не выбран" text="Сначала создай или выбери инстанс: здесь показываются его моды." />;
  }
  if (inst.loader.type === 'vanilla') {
    return <p className="notice"><Icon name="alert" size={16} /> Это инстанс Vanilla: моды в нём не загружаются. Выбери инстанс с Fabric, Quilt, Forge или NeoForge.</p>;
  }
  if (failure && !report) {
    return (
      <>
        <p className="form-error" role="alert">{failure}</p>
        <div><button className="btn" onClick={() => void reload()}><Icon name="refresh" size={16} /> Повторить</button></div>
      </>
    );
  }
  if (!report) return <Skeleton rows={5} />;

  const mods = report.mods;
  const withUpdate = mods.filter((m) => m.update);
  const others = mods.filter((m) => !m.update);
  const onModrinth = mods.filter((m) => m.source === 'modrinth').length;
  const working = busy.size > 0 || bulk !== null;

  const finish = async () => {
    await reload();
    void refreshInstances();
  };

  const updateOne = async (m: InstalledMod) => {
    setBusy((b) => new Set(b).add(m.file));
    try {
      await call('modrinth:updateMod', { id: inst.id, file: m.file });
      toast('ok', `Обновлено: ${m.name} → ${m.update?.versionNumber ?? 'новая версия'}`);
    } catch (e) {
      toast('error', `${m.name}: ${errMsg(e)}`);
    } finally {
      setBusy((b) => { const n = new Set(b); n.delete(m.file); return n; });
      await finish();
    }
  };

  const updateAll = async () => {
    const list = withUpdate;
    let ok = 0;
    let processed = 0;
    let failed = 0;
    let firstError: string | null = null;
    setBulk({ done: 0, total: list.length });
    for (const m of list) {
      setBusy(new Set([m.file]));
      try {
        await call('modrinth:updateMod', { id: inst.id, file: m.file });
        ok++;
      } catch (e) {
        failed++;
        firstError ??= `${m.name}: ${errMsg(e)}`;
      }
      setBulk({ done: ++processed, total: list.length });
    }
    setBusy(new Set());
    setBulk(null);
    if (failed > 0) toast('error', `Обновлено ${ok} из ${list.length}. Не удалось: ${firstError}`);
    else toast('ok', `Обновлено: ${ok} ${modsWord(ok)}`);
    await finish();
  };

  const row = (m: InstalledMod) => {
    const u = m.update;
    const mine = busy.has(m.file);
    return (
      <li key={m.file} className={`crow mr-row mr-ver${m.enabled ? '' : ' is-off'}`}>
        {m.iconDataUrl ? <img className="crow__icon" src={m.iconDataUrl} alt="" /> : <span className="crow__icon crow__icon--ph"><Icon name="puzzle" size={22} /></span>}
        <div className="grow">
          {m.projectId ? <button className="mr-title" onClick={() => onOpen(m)}>{m.name}</button> : <strong>{m.name}</strong>}
          <p className="muted">{[m.version ? `версия ${m.version}` : null, formatSize(m.size), m.file].filter(Boolean).join(' • ')}</p>
          {u && (
            <>
              <p className="mr-upd">
                <Icon name="download" size={14} /> Доступно: <strong>{u.versionNumber}</strong>
                {u.type !== 'release' && <span className={`badge badge--plain mr-type--${u.type}`}>{TYPE_TEXT[u.type]}</span>}
                <span className="muted"> • {formatDate(u.published)}{u.requiredDeps > 0 ? ' • зависимости доустановятся сами' : ''}</span>
              </p>
              {u.changelog.trim() && (
                <details className="mr-log">
                  <summary>Что нового</summary>
                  <Markdown text={u.changelog} />
                </details>
              )}
            </>
          )}
        </div>
        {!m.enabled && <span className="badge badge--plain">Выключен</span>}
        {m.source === 'unknown' && !report.error && <span className="badge badge--plain" title="Файл не найден на Modrinth: обновления для него не проверяются">Нет на Modrinth</span>}
        {m.source === 'modrinth' && !u && <span className="badge badge--ok">Актуален</span>}
        {u && (
          <button className="btn btn--primary" disabled={locked || working} onClick={() => void updateOne(m)}>
            {mine ? 'Обновляю…' : 'Обновить'}
          </button>
        )}
      </li>
    );
  };

  return (
    <>
      <div className="mr-sum">
        <div className="grow">
          <strong>Установлено: {mods.length} {modsWord(mods.length)}</strong>
          <p className="muted">
            {report.error
              ? 'Обновления не проверены'
              : `Найдено на Modrinth: ${onModrinth} • ${withUpdate.length > 0 ? `есть обновления: ${withUpdate.length}` : 'все моды актуальны'} • проверено ${formatDate(report.checkedAt)}`}
          </p>
          {working && op?.status === 'running' && <p className="mr-op">{op.label}{bulk ? ` (готово ${bulk.done} из ${bulk.total})` : ''}</p>}
        </div>
        <button className="btn" disabled={loading || working} onClick={() => void reload()}>
          <Icon name="refresh" size={16} /> {loading ? 'Проверяю…' : 'Проверить снова'}
        </button>
        <button className="btn btn--primary" disabled={locked || working || withUpdate.length === 0} onClick={() => void updateAll()}>
          Обновить все{withUpdate.length > 0 ? ` (${withUpdate.length})` : ''}
        </button>
      </div>

      {report.error && <p className="notice"><Icon name="alert" size={16} /> Не удалось связаться с Modrinth: {report.error}. Показан только список файлов.</p>}
      {failure && <p className="form-error" role="alert">{failure}</p>}

      {mods.length === 0 ? (
        <Empty icon="puzzle" title="В этом инстансе нет модов" text="Найди моды на Modrinth или добавь свои файлы .jar на вкладке «Моды»." action={<button className="btn" onClick={onBrowse}>Искать моды</button>} />
      ) : (
        <>
          {withUpdate.length > 0 && (
            <section className="mr-sec">
              <h2>Можно обновить ({withUpdate.length})</h2>
              <ul className="clist">{withUpdate.map(row)}</ul>
            </section>
          )}
          {others.length > 0 && (
            <section className="mr-sec">
              <h2>{withUpdate.length > 0 ? `Остальные моды (${others.length})` : 'Установленные моды'}</h2>
              <ul className="clist">{others.map(row)}</ul>
            </section>
          )}
        </>
      )}
    </>
  );
}
