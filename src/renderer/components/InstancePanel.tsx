import type { InstanceView } from '../../shared/types';
import { recommendMemory } from '../../shared/memory';
import { useI18n } from '../i18n';
import { activeOp, useStore } from '../store';
import { formatDate, kindLabel, loaderText, memoryText } from '../util';
import { Icon } from './Icon';
import { Cover, Menu, ProgressBar } from './ui';
import { instanceMenuItems, type InstanceDialog } from './InstanceMenu';

function Row({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="kv">
      <span className="kv__k">
        <Icon name={icon} size={16} /> {label}
      </span>
      <span className="kv__v" title={value}>
        {value}
      </span>
    </div>
  );
}

/** The main action follows the real instance state: no placeholders, no fake progress. */
function MainAction({ inst }: { inst: InstanceView }) {
  const { play, stop, install, cancelInstall } = useStore.getState();
  const ops = useStore((s) => s.ops);
  const { t } = useI18n();
  const op = activeOp(ops, inst.id);

  if (inst.state === 'installing' || op?.kind === 'install') {
    return (
      <div className="panel__op">
        <div className="row row--between">
          <span>{op?.label ?? t('state.installing')}</span>
          {op?.fraction != null && <strong>{Math.round(op.fraction * 100)}%</strong>}
        </div>
        <ProgressBar fraction={op?.fraction ?? null} />
        <button className="btn btn--block" onClick={() => void cancelInstall(inst.id)}>
          {t('action.cancelInstall')}
        </button>
      </div>
    );
  }
  if (inst.running || op?.kind === 'launch') {
    return (
      <div className="panel__op">
        {!inst.running && op && (
          <>
            <div className="row row--between">
              <span>{op.label}</span>
              {op.fraction != null && <strong>{Math.round(op.fraction * 100)}%</strong>}
            </div>
            <ProgressBar fraction={op.fraction} />
          </>
        )}
        <button className="btn btn--danger btn--block btn--lg-static" onClick={() => void stop(inst.id)}>
          <Icon name="stop" size={18} /> {t('action.stop')}
        </button>
      </div>
    );
  }
  if (inst.state === 'not-installed') {
    return (
      <button className="btn btn--primary btn--lg" onClick={() => void install(inst.id)}>
        <Icon name="download" size={20} /> {t('action.install')}
      </button>
    );
  }
  if (inst.state === 'broken') {
    return (
      <div className="panel__op">
        <p className="form-error" role="alert">
          <Icon name="alert" size={16} /> {inst.stateReason ?? t('state.broken')}
        </p>
        <button className="btn btn--primary btn--lg" onClick={() => void install(inst.id)}>
          <Icon name="wrench" size={20} /> {t('action.install')}
        </button>
      </div>
    );
  }
  return (
    <button className="btn btn--primary btn--lg" onClick={() => void play(inst.id)}>
      <Icon name="play" size={18} /> {t('action.play')}
    </button>
  );
}

export function InstancePanel({ inst, openDialog }: { inst: InstanceView; openDialog: (d: InstanceDialog) => void }) {
  const settings = useStore((s) => s.settings);
  const go = useStore((s) => s.go);
  const { t } = useI18n();
  const s = inst.settings;
  const sys = useStore((st) => st.sysMemory);
  const ownBoth = s.memoryMinMb != null && s.memoryMaxMb != null;
  const auto =
    settings?.memoryAuto && !ownBoth && sys
      ? recommendMemory({ totalMb: sys.totalMb, modCount: inst.modCount, loader: inst.loader.type })
      : null;
  const min = s.memoryMinMb ?? auto?.minMb ?? settings?.memoryMinMb;
  const max = s.memoryMaxMb ?? auto?.maxMb ?? settings?.memoryMaxMb;
  const w = s.width ?? settings?.width;
  const h = s.height ?? settings?.height;
  const full = s.fullscreen ?? settings?.fullscreen;
  const jvm = [settings?.jvmArgs, s.jvmArgs].filter(Boolean).join(' ');

  return (
    <aside className="panel" aria-label={inst.name}>
      <div className="panel__hero">
        <Cover inst={inst} className="cover--hero" />
        <div className="panel__heroText">
          <h2>{inst.name}</h2>
          <p>{inst.description || `${loaderText(inst)} • Minecraft ${inst.mcVersion}`}</p>
          <span className={`badge${inst.kind === 'modded' ? '' : ' badge--plain'}`}>{kindLabel(inst.kind, t)}</span>
        </div>
      </div>

      <div className="panel__actions">
        <MainAction inst={inst} />
        <Menu items={instanceMenuItems(inst, openDialog)} />
      </div>

      <section className="pcard">
        <h3>
          <Icon name="cube" size={16} /> {t('instances.details')}
        </h3>
        <Row icon="cube" label={t('instances.mcVersion')} value={inst.mcVersion} />
        <Row icon="layers" label={t('instances.loader')} value={loaderText(inst)} />
        <Row icon="folder" label={t('settings.instancesDir')} value={inst.path} />
        <Row icon="refresh" label={t('instances.created')} value={formatDate(inst.createdAt)} />
        <Row icon="play" label={t('instances.lastPlayed')} value={formatDate(inst.lastPlayedAt)} />
      </section>

      <section className="pcard">
        <h3>
          <Icon name="puzzle" size={16} /> {t('mods.title')} / {t('packs.title')}
        </h3>
        <button className="kv kv--link" onClick={() => go('mods')}>
          <span className="kv__k">
            <Icon name="puzzle" size={16} /> {t('mods.title')}
          </span>
          <span className="kv__v">
            {inst.modCount} <Icon name="chevron" size={14} />
          </span>
        </button>
        <button className="kv kv--link" onClick={() => go('resourcepacks')}>
          <span className="kv__k">
            <Icon name="image" size={16} /> {t('packs.title')}
          </span>
          <span className="kv__v">
            {inst.packCount} <Icon name="chevron" size={14} />
          </span>
        </button>
      </section>

      <section className="pcard">
        <h3>
          <Icon name="gear" size={16} /> {t('instances.launchSettings')}
        </h3>
        <Row
          icon="cube"
          label={t('settings.memory')}
          value={min != null && max != null ? `${memoryText(min)} – ${memoryText(max)}` : '—'}
        />
        <Row icon="layers" label={t('settings.window')} value={w && h ? `${w}×${h}${full ? ' FS' : ''}` : '—'} />
        {jvm && <Row icon="terminal" label="JVM" value={jvm} />}
      </section>
    </aside>
  );
}
