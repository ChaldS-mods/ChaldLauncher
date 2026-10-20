import { useState } from 'react';
import type { InstanceView } from '../../shared/types';
import { call, errMsg } from '../api';
import { useStore } from '../store';
import { ExportDialog } from './ChaldPackDialogs';
import { EditInstance } from './EditInstance';
import { Field, ConfirmModal, Modal, type MenuItem } from './ui';

export type InstanceDialog = { kind: 'edit' | 'duplicate' | 'export' | 'delete'; id: string } | null;

/** Menu entries shared by the card and the side panel. Destructive actions only open a dialog. */
export function instanceMenuItems(inst: InstanceView, open: (d: InstanceDialog) => void): MenuItem[] {
  const busy = inst.running || inst.state === 'installing';
  const toast = useStore.getState().toast;
  return [
    { label: 'Открыть папку', icon: 'folder', onClick: () => void call('instances:openFolder', { id: inst.id }).catch((e) => toast('error', errMsg(e))) },
    { label: 'Дублировать', icon: 'copy', onClick: () => open({ kind: 'duplicate', id: inst.id }), disabled: busy },
    { label: 'Экспорт в файл', icon: 'upload', onClick: () => open({ kind: 'export', id: inst.id }), disabled: inst.state === 'installing' },
    { label: 'Изменить', icon: 'edit', onClick: () => open({ kind: 'edit', id: inst.id }), disabled: inst.state === 'installing' },
    { label: 'Восстановить', icon: 'wrench', onClick: () => void useStore.getState().install(inst.id), disabled: busy || (!inst.installed && inst.state !== 'broken') },
    { label: 'Удалить', icon: 'trash', onClick: () => open({ kind: 'delete', id: inst.id }), danger: true, disabled: busy },
  ];
}

function DuplicateDialog({ inst, onClose }: { inst: InstanceView; onClose: () => void }) {
  const [name, setName] = useState(`${inst.name} (копия)`.slice(0, 48));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const copy = await call('instances:duplicate', { id: inst.id, name });
      await useStore.getState().refreshInstances();
      useStore.getState().select(copy.id);
      useStore.getState().toast('ok', `Создана копия «${copy.name}»`);
      onClose();
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Дублировать инстанс"
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Отмена</button><button className="btn btn--primary" disabled={busy || !name.trim()} onClick={() => void submit()}>Дублировать</button></>}
    >
      <Field label="Название копии" error={error} hint="Копируются файлы инстанса: моды, миры и настройки.">
        <input className="input" autoFocus maxLength={48} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && !busy && void submit()} />
      </Field>
    </Modal>
  );
}

function DeleteDialog({ inst, onClose }: { inst: InstanceView; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await call('instances:remove', { id: inst.id, confirm: true });
      await useStore.getState().refreshInstances();
      const st = useStore.getState();
      if (st.selectedId === inst.id) st.select(st.instances[0]?.id ?? null);
      st.toast('ok', `Инстанс «${inst.name}» удалён`);
      onClose();
    } catch (e) {
      useStore.getState().toast('error', errMsg(e));
      setBusy(false);
    }
  };
  return (
    <ConfirmModal title="Удалить инстанс?" confirmLabel="Удалить навсегда" danger busy={busy} onConfirm={() => void run()} onClose={onClose}>
      <p>Инстанс <strong>«{inst.name}»</strong> будет удалён вместе со всеми файлами: модами, ресурспаками, мирами и скриншотами. Это действие нельзя отменить.</p>
    </ConfirmModal>
  );
}

export function InstanceDialogs({ dialog, close }: { dialog: InstanceDialog; close: () => void }) {
  const inst = useStore((s) => s.instances.find((i) => i.id === dialog?.id) ?? null);
  if (!dialog || !inst) return null;
  if (dialog.kind === 'edit') return <EditInstance inst={inst} onClose={close} />;
  if (dialog.kind === 'duplicate') return <DuplicateDialog inst={inst} onClose={close} />;
  if (dialog.kind === 'export') return <ExportDialog inst={inst} onClose={close} />;
  return <DeleteDialog inst={inst} onClose={close} />;
}
