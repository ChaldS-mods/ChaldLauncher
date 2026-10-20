import { useEffect, useState } from 'react';
import { appSettingsSchema } from '../../shared/schemas';
import type { AppSettings, JavaInstall } from '../../shared/types';
import { call, errMsg } from '../api';
import { AccountSection } from '../components/AccountSection';
import { Icon } from '../components/Icon';
import { MemorySliders } from '../components/MemorySliders';
import { Field, Switch } from '../components/ui';
import { recommendMemory } from '../../shared/memory';
import { useStore } from '../store';
import { memoryText, numOrNull } from '../util';

type Draft = { instancesDir: string; downloadsDir: string; javaPath: string; memAuto: boolean; min: number; max: number; jvmArgs: string; width: string; height: string; fullscreen: boolean; closeBehavior: AppSettings['closeBehavior']; checkUpdates: boolean; updateRepo: string };

const toDraft = (s: AppSettings): Draft => ({
  instancesDir: s.instancesDir, downloadsDir: s.downloadsDir, javaPath: s.javaPath, memAuto: s.memoryAuto, min: s.memoryMinMb, max: s.memoryMaxMb, jvmArgs: s.jvmArgs,
  width: String(s.width), height: String(s.height), fullscreen: s.fullscreen, closeBehavior: s.closeBehavior, checkUpdates: s.checkUpdates, updateRepo: s.updateRepo,
});

function Section({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return <section className="pcard pcard--wide"><h3><Icon name={icon} size={16} /> {title}</h3><div className="stack">{children}</div></section>;
}

export function SettingsPage() {
  const settings = useStore((s) => s.settings);
  const info = useStore((s) => s.info);
  const update = useStore((s) => s.update);
  const sys = useStore((s) => s.sysMemory);
  const sel = useStore((s) => s.selected());
  const { saveSettings, toast, checkUpdate } = useStore.getState();
  const [d, setD] = useState<Draft | null>(settings ? toDraft(settings) : null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [javas, setJavas] = useState<JavaInstall[] | null>(null);
  const [detecting, setDetecting] = useState(false);

  useEffect(() => { if (settings && !d) setD(toDraft(settings)); }, [settings, d]);
  useEffect(() => { void useStore.getState().refreshMemory(); }, []);
  if (!settings || !d) return null;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD({ ...d, [k]: v });
  const advice = sys ? recommendMemory({ totalMb: sys.totalMb, modCount: sel?.modCount ?? 0, loader: sel?.loader.type ?? 'vanilla' }) : null;
  const dirty = JSON.stringify(d) !== JSON.stringify(toDraft(settings));

  const pick = async (k: 'instancesDir' | 'downloadsDir', title: string) => {
    try { const p = await call('dialog:pickDirectory', { title }); if (p) set(k, p); } catch (e) { toast('error', errMsg(e)); }
  };
  const detect = async () => {
    setDetecting(true);
    try { setJavas(await call('java:detect')); } catch (e) { toast('error', errMsg(e)); } finally { setDetecting(false); }
  };
  const save = async () => {
    const nums = { width: numOrNull(d.width), height: numOrNull(d.height) };
    for (const [k, v] of Object.entries(nums)) if (v === null || Number.isNaN(v)) return setError(`Поле «${k}»: нужно число`);
    const next = { ...settings, instancesDir: d.instancesDir.trim(), downloadsDir: d.downloadsDir.trim(), javaPath: d.javaPath.trim(), memoryAuto: d.memAuto, memoryMinMb: d.min, memoryMaxMb: d.max, jvmArgs: d.jvmArgs, fullscreen: d.fullscreen, closeBehavior: d.closeBehavior, checkUpdates: d.checkUpdates, updateRepo: d.updateRepo.trim(), ...nums };
    const p = appSettingsSchema.safeParse(next);
    if (!p.success) return setError(p.error.issues[0]?.message ?? 'Проверь поля');
    setSaving(true);
    setError(null);
    try {
      const { accountMode: _a, offlineName: _o, msClientId: _m, lastInstanceId: _l, ...patch } = p.data;
      const saved = await saveSettings(patch);
      setD(toDraft(saved));
      toast('ok', 'Настройки сохранены');
    } catch (e) { setError(errMsg(e)); } finally { setSaving(false); }
  };

  return (
    <div className="page">
      <header className="page-head"><div className="page-head__title"><Icon name="gear" size={40} /><div><h1>Настройки</h1><p>Аккаунт, пути, Java и запуск игры</p></div></div></header>

      <Section icon="user" title="Аккаунт"><AccountSection /></Section>

      <Section icon="folder" title="Пути">
        <Field label="Папка инстансов" hint={`Пусто — по умолчанию${info ? `: ${info.instancesDir}` : ''}. Уже созданные инстансы не переносятся.`}>
          <div className="row"><input className="input" value={d.instancesDir} onChange={(e) => set('instancesDir', e.target.value)} placeholder="По умолчанию" /><button type="button" className="btn" onClick={() => void pick('instancesDir', 'Папка инстансов')}>Выбрать…</button></div>
        </Field>
        <Field label="Папка загрузок" hint="Пусто — по умолчанию">
          <div className="row"><input className="input" value={d.downloadsDir} onChange={(e) => set('downloadsDir', e.target.value)} placeholder="По умолчанию" /><button type="button" className="btn" onClick={() => void pick('downloadsDir', 'Папка загрузок')}>Выбрать…</button></div>
        </Field>
        {info && <p className="faint">Данные лаунчера: <span className="mono">{info.dataDir}</span></p>}
      </Section>

      <Section icon="terminal" title="Java">
        <Field label="Путь к Java" hint="Пусто — подобрать подходящую автоматически или скачать Temurin при первом запуске">
          <div className="row"><input className="input" value={d.javaPath} onChange={(e) => set('javaPath', e.target.value)} placeholder="Автоматически" /><button type="button" className="btn" disabled={detecting} onClick={() => void detect()}>{detecting ? 'Поиск…' : 'Найти Java'}</button></div>
        </Field>
        {javas && (javas.length === 0
          ? <p className="muted">Java на этом компьютере не найдена. Лаунчер скачает подходящую при запуске игры.</p>
          : <ul className="javas">{javas.map((j) => <li key={j.path}><button type="button" className="btn btn--sm" onClick={() => set('javaPath', j.path)}>Выбрать</button><strong>Java {j.major}</strong><span className="badge badge--plain">{j.source === 'launcher' ? 'от лаунчера' : 'системная'}</span><span className="mono muted grow">{j.path}</span></li>)}</ul>)}
      </Section>

      <Section icon="cube" title="Память и запуск">
        <div className="row row--between"><span>Подбирать память автоматически</span><Switch checked={d.memAuto} label="Подбирать память автоматически" onChange={(v) => set('memAuto', v)} /></div>
        {d.memAuto ? (
          <div className="stack">
            <p className="muted">
              Лаунчер сам считает объём под каждый инстанс: берёт больше памяти для сборок с большим числом модов, но оставляет системе запас от ОЗУ компьютера
              {sys ? ` (у тебя ${memoryText(sys.totalMb)})` : ''}. Свой объём можно задать в настройках конкретного инстанса.
            </p>
            {advice && <p>Для выбранного инстанса{sel ? ` «${sel.name}»` : ''} сейчас: <strong>{memoryText(advice.minMb)} – {memoryText(advice.maxMb)}</strong>{advice.limitedBy === 'machine' ? ' (ограничено памятью компьютера)' : ''}</p>}
          </div>
        ) : (
          <MemorySliders minMb={d.min} maxMb={d.max} onChange={(a, b) => setD({ ...d, min: a, max: b })} sys={sys} advice={advice} />
        )}
        <div className="form-grid">
          <Field label="Ширина окна"><input className="input" inputMode="numeric" value={d.width} onChange={(e) => set('width', e.target.value)} /></Field>
          <Field label="Высота окна"><input className="input" inputMode="numeric" value={d.height} onChange={(e) => set('height', e.target.value)} /></Field>
          <div className="form-grid__wide"><Field label="Аргументы JVM" hint="Общие для всех инстансов"><input className="input" value={d.jvmArgs} onChange={(e) => set('jvmArgs', e.target.value)} spellCheck={false} /></Field></div>
        </div>
        <div className="row row--between"><span>Полный экран по умолчанию</span><Switch checked={d.fullscreen} label="Полный экран по умолчанию" onChange={(v) => set('fullscreen', v)} /></div>
      </Section>

      <Section icon="gear" title="Поведение">
        <Field label="При закрытии окна лаунчера">
          <select className="input" value={d.closeBehavior} onChange={(e) => set('closeBehavior', e.target.value as Draft['closeBehavior'])}>
            <option value="quit">Закрывать лаунчер</option>
            <option value="minimize-while-playing">Сворачивать, пока идёт игра</option>
          </select>
        </Field>
      </Section>

      <Section icon="refresh" title="Обновления">
        <div className="row row--between"><span>Проверять обновления при запуске</span><Switch checked={d.checkUpdates} label="Проверять обновления" onChange={(v) => set('checkUpdates', v)} /></div>
        <Field label="Репозиторий GitHub" hint="Формат: владелец/репозиторий. Пусто — проверка отключена. Лаунчер только сообщает о новой версии, сам ничего не устанавливает.">
          <input className="input" value={d.updateRepo} onChange={(e) => set('updateRepo', e.target.value)} placeholder="chald-studio/chald-launcher" spellCheck={false} />
        </Field>
        <div className="row">
          <button type="button" className="btn btn--sm" onClick={() => void checkUpdate()}>Проверить сейчас</button>
          {update && <span className="muted">{!update.configured ? 'Репозиторий не задан (сохрани настройки)' : update.hasUpdate ? `Доступна версия ${update.latest}` : `Установлена последняя версия (${update.current})`}</span>}
        </div>
      </Section>

      <div className="savebar" role="region" aria-label="Сохранение настроек">
        {error ? <p className="form-error" role="alert">{error}</p> : <span className="muted">{dirty ? 'Есть несохранённые изменения' : 'Все изменения сохранены'}</span>}
        <button className="btn" disabled={!dirty || saving} onClick={() => { setD(toDraft(settings)); setError(null); }}>Сбросить</button>
        <button className="btn btn--primary" disabled={!dirty || saving} onClick={() => void save()}>Сохранить</button>
      </div>
    </div>
  );
}
