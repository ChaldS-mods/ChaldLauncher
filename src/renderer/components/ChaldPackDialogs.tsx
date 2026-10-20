import { useState } from 'react';
import type { ChaldPackExportResult, ChaldPackSummary, InstanceView } from '../../shared/types';
import { call, errMsg } from '../api';
import { useStore } from '../store';
import { formatSize } from '../util';
import { Icon } from './Icon';
import { Modal, Switch } from './ui';

export function ExportDialog({ inst, onClose }: { inst: InstanceView; onClose: () => void }) {
  const toast = useStore((s) => s.toast);
  const [worlds, setWorlds] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<(ChaldPackExportResult & { file: string }) | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await call('chaldpack:export', { id: inst.id, includeWorlds: worlds });
      if (!r) { setBusy(false); return; } // save dialog cancelled
      setDone(r);
      toast('ok', `Экспортировано: «${inst.name}»`);
    } catch (e) {
      setError(errMsg(e));
    }
    setBusy(false);
  };

  return (
    <Modal
      title="Экспорт инстанса"
      onClose={busy ? () => undefined : onClose}
      footer={done
        ? <button className="btn btn--primary" onClick={onClose}>Готово</button>
        : <><button className="btn" onClick={onClose} disabled={busy}>Отмена</button><button className="btn btn--primary" disabled={busy || inst.running && worlds} onClick={() => void run()}>{busy ? 'Экспортирую…' : 'Экспортировать'}</button></>}
    >
      {done ? (
        <>
          <p>Файл сохранён: <strong>{done.file}</strong></p>
          <p className="muted">Моды и ресурспаки с Modrinth: {done.downloads} (в файле только ссылки с контрольными суммами, при импорте скачаются заново).</p>
          <p className="muted">Лежат прямо в файле: {done.bundledFiles} ({formatSize(done.bundledBytes)}): свои моды, настройки и всё, что нельзя скачать.</p>
          {done.notices.length > 0 && (
            <details className="mr-log"><summary>Файлы, которые пришлось упаковать, хотя они похожи на модрински ({done.notices.length})</summary>
              <ul>{done.notices.slice(0, 50).map((n) => <li key={n} className="muted">{n}</li>)}</ul>
            </details>
          )}
        </>
      ) : (
        <>
          <p>Лаунчер сохранит инстанс <strong>«{inst.name}»</strong> в файл <code>.chaldlauncher</code>: версию игры, загрузчик, список модов и ресурспаков с Modrinth, а всё остальное (свои моды, конфиги, настройки) положит внутрь файла.</p>
          <p className="muted">Не попадают: логи, краш-репорты, скриншоты, кэши, настройки памяти и Java, твой аккаунт.</p>
          <div className="row" style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
            <Switch checked={worlds} onChange={setWorlds} label="Включить миры" disabled={busy} />
            <span>Включить миры (папка saves). Файл может стать очень большим.</span>
          </div>
          {inst.running && worlds && <p className="form-error">Останови игру, чтобы экспортировать миры.</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
        </>
      )}
    </Modal>
  );
}

export function ImportPackButton() {
  const toast = useStore((s) => s.toast);
  const [picked, setPicked] = useState<{ token: string; summary: ChaldPackSummary } | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    setBusy(true);
    try {
      const r = await call('chaldpack:inspect');
      if (r) setPicked(r);
    } catch (e) {
      toast('error', errMsg(e));
    }
    setBusy(false);
  };
  const confirm = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      await call('chaldpack:import', { token: picked.token });
      toast('info', `Импортирую «${picked.summary.name}»… Ход установки внизу окна.`);
      setPicked(null);
    } catch (e) {
      toast('error', errMsg(e));
    }
    setBusy(false);
  };

  const s = picked?.summary;
  return (
    <>
      <button className="btn btn--outline" disabled={busy} onClick={() => void pick()}><Icon name="download" size={18} /> Импорт</button>
      {picked && s && (
        <Modal
          title="Импорт инстанса"
          onClose={() => setPicked(null)}
          footer={<><button className="btn" onClick={() => setPicked(null)}>Отмена</button><button className="btn btn--primary" disabled={busy} onClick={() => void confirm()}>Импортировать</button></>}
        >
          <p><strong>«{s.name}»</strong>{s.description ? <span className="muted"> · {s.description}</span> : null}</p>
          <p className="muted">Minecraft {s.mcVersion} · {s.loader.type === 'vanilla' ? 'Vanilla' : `${s.loader.type} ${s.loader.version}`}</p>
          <p className="muted">Скачается с Modrinth: {s.downloads} файлов (проверяется контрольная сумма каждого).</p>
          <p className="muted">Из самого файла: {s.overrideFiles} файлов, {formatSize(s.overrideBytes)}.</p>
          <p className="notice"><Icon name="alert" size={16} /> В файле могут быть программы (моды .jar), которые запустятся вместе с игрой. Импортируй только файлы от тех, кому доверяешь.</p>
        </Modal>
      )}
    </>
  );
}
