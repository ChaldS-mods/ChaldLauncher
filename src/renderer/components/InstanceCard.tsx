import type { InstanceView } from '../../shared/types';
import { loaderText, KIND_LABEL, STATE_TEXT } from '../util';
import { Icon } from './Icon';
import { Cover, Menu } from './ui';
import { instanceMenuItems, type InstanceDialog } from './InstanceMenu';

export function InstanceCard({ inst, selected, onSelect, openDialog }: { inst: InstanceView; selected: boolean; onSelect: () => void; openDialog: (d: InstanceDialog) => void }) {
  return (
    <div
      className={`icard${selected ? ' is-selected' : ''}`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect(); } }}
    >
      <Cover inst={inst} className="cover--card" />
      <div className="icard__body">
        <div className="icard__top">
          <div className="grow">
            <h3 className="icard__name">{inst.name}</h3>
            <p className="icard__desc">{inst.description || '\u00a0'}</p>
          </div>
          <span className={`badge${inst.kind === 'modded' ? '' : ' badge--plain'}`}>{KIND_LABEL[inst.kind]}</span>
          <Menu items={instanceMenuItems(inst, openDialog)} />
        </div>
        <div className="icard__meta">
          <span><Icon name="cube" size={16} /> {inst.mcVersion}</span>
          <span><Icon name="layers" size={16} /> {loaderText(inst)}</span>
          {inst.loader.type !== 'vanilla' && <span><Icon name="puzzle" size={16} /> {inst.modCount} мод.</span>}
          <span className={`icard__state is-${inst.running ? 'running' : inst.state}`}>{inst.running ? 'Запущен' : STATE_TEXT[inst.state]}</span>
        </div>
      </div>
    </div>
  );
}
