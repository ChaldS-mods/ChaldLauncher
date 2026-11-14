import { useEffect, useState } from 'react';
import { call, errMsg } from '../api';
import { useI18n } from '../i18n';
import { Icon } from './Icon';
import { Modal, Skeleton } from './ui';

interface Props {
  /** название датапака, показывается в окне */
  title: string;
  instanceId: string;
  onConfirm: (world: string) => void;
  onClose: () => void;
}

/** Окно «Куда установить датапак»: список миров инстанса (saves/*) с выбором. */
export function WorldPickerModal({ title, instanceId, onConfirm, onClose }: Props) {
  const { t } = useI18n();
  const [worlds, setWorlds] = useState<string[] | null>(null);
  const [world, setWorld] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setWorlds(null);
    setWorld('');
    setError(null);
    call('instances:worlds', { id: instanceId })
      .then((list) => {
        if (!alive) return;
        setWorlds(list);
        if (list[0]) setWorld(list[0]);
      })
      .catch((e) => {
        if (!alive) return;
        setWorlds([]);
        setError(errMsg(e));
      });
    return () => {
      alive = false;
    };
  }, [instanceId]);

  const confirm = () => {
    if (!world) {
      setError('Выбери мир');
      return;
    }
    onConfirm(world);
  };

  return (
    <Modal
      title="Куда установить датапак"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('action.cancel')}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!world || worlds === null || worlds.length === 0}
            onClick={confirm}
          >
            {t('modrinth.install') || 'Установить'}
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginBottom: 12 }}>
        <strong>{title}</strong>
        <br />
        Датапак ставится в папку конкретного мира: saves/&lt;мир&gt;/datapacks
      </p>
      {worlds === null && <Skeleton rows={3} />}
      {worlds && worlds.length === 0 && (
        <p className="notice">
          <Icon name="alert" size={16} /> В этом инстансе нет миров. Зайди в игру и создай мир.
        </p>
      )}
      {worlds && worlds.length > 0 && (
        <ul className="clist">
          {worlds.map((w) => (
            <li key={w} className="crow">
              <label className="grow" style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <input type="radio" name="datapack-world" checked={world === w} onChange={() => setWorld(w)} />
                <span>{w}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
