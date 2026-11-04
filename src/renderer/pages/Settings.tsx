import { useEffect, useState, type ReactNode } from 'react';
import { appSettingsSchema } from '../../shared/schemas';
import type { AppSettings, DnsTestResult, JavaInstall } from '../../shared/types';
import { DEFAULT_DNS_SERVERS, DEFAULT_DOH_URL, DNS_PLAIN_PRESETS, DOH_PRESETS, type DnsMode } from '../../shared/dns';
import { call, errMsg } from '../api';
import { AccountSection } from '../components/AccountSection';
import { DiscordSection } from '../components/Discord';
import { NAV_PAGES } from '../components/Shell';
import { Icon } from '../components/Icon';
import { MemorySliders } from '../components/MemorySliders';
import { Field, Switch } from '../components/ui';
import { recommendMemory } from '../../shared/memory';
import { useStore } from '../store';
import { ColorField } from '../components/ColorField';
import { DEFAULT_THEME, effectiveBg, THEME_PRESETS, toHex, type ThemeColors } from '../../shared/theme';
import { applyLook, applyTheme, lookFromSettings, themeFromSettings, type LookSettings } from '../theme';
import { memoryText, numOrNull } from '../util';
import { LOCALES, useI18n, type Locale } from '../i18n';

type Draft = {
  instancesDir: string; downloadsDir: string; javaPath: string; memAuto: boolean; min: number; max: number; jvmArgs: string;
  width: string; height: string; fullscreen: boolean; closeBehavior: AppSettings['closeBehavior'];
  checkUpdates: boolean; autoDownload: boolean; updateRepo: string; uiSounds: boolean; soundVolume: number;
  discordRpc: boolean; discordShowInstance: boolean;
  themeBg: string; themeAccent: string; themeSecondary: string; themeHighlight: string;
  uiScale: number; cornerStyle: LookSettings['cornerStyle']; glow: number; fontMode: LookSettings['fontMode']; animations: boolean; compactSidebar: boolean;
  hiddenPages: string[]; sidebarSide: AppSettings['sidebarSide']; panelSide: AppSettings['panelSide']; panelWidth: number; showStatusBar: boolean; customCss: string; customHtml: string;
  dnsMode: DnsMode; dnsServers: string; dnsDohUrl: string;
  language: Locale;
};

const toDraft = (s: AppSettings): Draft => ({
  instancesDir: s.instancesDir, downloadsDir: s.downloadsDir, javaPath: s.javaPath, memAuto: s.memoryAuto, min: s.memoryMinMb, max: s.memoryMaxMb, jvmArgs: s.jvmArgs,
  width: String(s.width), height: String(s.height), fullscreen: s.fullscreen, closeBehavior: s.closeBehavior, checkUpdates: s.checkUpdates, autoDownload: s.autoDownloadUpdates, updateRepo: s.updateRepo, uiSounds: s.uiSounds, soundVolume: s.soundVolume, discordRpc: s.discordRpc, discordShowInstance: s.discordShowInstance, themeBg: s.themeBg, themeAccent: s.themeAccent, themeSecondary: s.themeSecondary, themeHighlight: s.themeHighlight,
  uiScale: s.uiScale, cornerStyle: s.cornerStyle, glow: s.glow, fontMode: s.fontMode, animations: s.animations, compactSidebar: s.compactSidebar,
  hiddenPages: s.hiddenPages, sidebarSide: s.sidebarSide, panelSide: s.panelSide, panelWidth: s.panelWidth, showStatusBar: s.showStatusBar, customCss: s.customCss, customHtml: s.customHtml,
  dnsMode: s.dnsMode ?? 'system', dnsServers: s.dnsServers || DEFAULT_DNS_SERVERS, dnsDohUrl: s.dnsDohUrl || DEFAULT_DOH_URL,
  language: s.language ?? 'ru',
});

type Tab = 'general' | 'account' | 'game' | 'look' | 'layout' | 'discord';
const TABS: { id: Tab; icon: string; key: string }[] = [
  { id: 'general', icon: 'gear', key: 'settings.tabGeneral' },
  { id: 'account', icon: 'user', key: 'settings.tabAccount' },
  { id: 'game', icon: 'cube', key: 'settings.tabGame' },
  { id: 'look', icon: 'image', key: 'settings.tabLook' },
  { id: 'layout', icon: 'layers', key: 'settings.tabLayout' },
  { id: 'discord', icon: 'globe', key: 'settings.tabDiscord' },
];

function Section({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
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
  const [tab, setTab] = useState<Tab>('general');
  const [dnsTest, setDnsTest] = useState<DnsTestResult | null>(null);
  const [dnsTesting, setDnsTesting] = useState(false);

  useEffect(() => { if (settings && !d) setD(toDraft(settings)); }, [settings, d]);
  useEffect(() => { void useStore.getState().refreshMemory(); }, []);
  // live preview: the draft colors are shown at once; leaving the page returns to the saved ones
  const draftTheme = d ? JSON.stringify([d.themeBg, d.themeAccent, d.themeSecondary, d.themeHighlight]) : null;
  useEffect(() => {
    if (!draftTheme) return;
    const [bg, accent, secondary, highlight] = JSON.parse(draftTheme) as string[];
    applyTheme({ bg: bg!, accent: accent!, secondary: secondary!, highlight: highlight! });
  }, [draftTheme]);
  const draftLook = d ? JSON.stringify(lookFromSettings({ ...(settings as AppSettings), ...d } as AppSettings)) : null;
  useEffect(() => { if (draftLook) applyLook(JSON.parse(draftLook) as LookSettings); }, [draftLook]);
  useEffect(() => () => {
    const saved = useStore.getState().settings;
    if (saved) { applyTheme(themeFromSettings(saved)); applyLook(lookFromSettings(saved)); }
  }, []);
  if (!settings || !d) return null;
  const colors: ThemeColors = { bg: d.themeBg, accent: d.themeAccent, secondary: d.themeSecondary, highlight: d.themeHighlight };
  const setColors = (c: ThemeColors) => setD({ ...d, themeBg: c.bg, themeAccent: c.accent, themeSecondary: c.secondary, themeHighlight: c.highlight });
  const bgTooLight = toHex(effectiveBg(colors.bg)) !== colors.bg.toLowerCase();
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
  const setDns = (patch: Partial<Pick<Draft, 'dnsMode' | 'dnsServers' | 'dnsDohUrl'>>) => { setD({ ...d, ...patch }); setDnsTest(null); };
  const testDns = async () => {
    setDnsTesting(true);
    setDnsTest(null);
    try { setDnsTest(await call('net:testDns', { dnsMode: d.dnsMode, dnsServers: d.dnsServers.trim(), dnsDohUrl: d.dnsDohUrl.trim() })); } catch (e) { toast('error', errMsg(e)); } finally { setDnsTesting(false); }
  };
  const save = async () => {
    const nums = { width: numOrNull(d.width), height: numOrNull(d.height) };
    for (const [k, v] of Object.entries(nums)) if (v === null || Number.isNaN(v)) return setError(k);
    const next = { ...settings, instancesDir: d.instancesDir.trim(), downloadsDir: d.downloadsDir.trim(), javaPath: d.javaPath.trim(), memoryAuto: d.memAuto, memoryMinMb: d.min, memoryMaxMb: d.max, jvmArgs: d.jvmArgs, fullscreen: d.fullscreen, closeBehavior: d.closeBehavior, checkUpdates: d.checkUpdates, autoDownloadUpdates: d.autoDownload, updateRepo: d.updateRepo.trim(), uiSounds: d.uiSounds, soundVolume: d.soundVolume, discordRpc: d.discordRpc, discordShowInstance: d.discordShowInstance, themeBg: d.themeBg, themeAccent: d.themeAccent, themeSecondary: d.themeSecondary, themeHighlight: d.themeHighlight, uiScale: d.uiScale, cornerStyle: d.cornerStyle, glow: d.glow, fontMode: d.fontMode, animations: d.animations, compactSidebar: d.compactSidebar, hiddenPages: d.hiddenPages, sidebarSide: d.sidebarSide, panelSide: d.panelSide, panelWidth: d.panelWidth, showStatusBar: d.showStatusBar, customCss: d.customCss, customHtml: d.customHtml, language: d.language, dnsMode: d.dnsMode, dnsServers: d.dnsServers.trim(), dnsDohUrl: d.dnsDohUrl.trim(), ...nums };
    const p = appSettingsSchema.safeParse(next);
    if (!p.success) return setError(p.error.issues[0]?.message ?? 'error');
    setSaving(true);
    setError(null);
    try {
      const { accountMode: _a, offlineName: _o, msClientId: _m, lastInstanceId: _l, ...patch } = p.data;
      const saved = await saveSettings(patch);
      setD(toDraft(saved));
      toast('ok', t('settings.saved'));
    } catch (e) { setError(errMsg(e)); } finally { setSaving(false); }
  };

  const { t } = useI18n();

  return (
    <div className="page">
      <header className="page-head"><div className="page-head__title"><Icon name="gear" size={40} /><div><h1>{t('settings.title')}</h1><p>{t('settings.account')}, {t('settings.paths')}, Java</p></div></div></header>

      <nav className="tabs settings-tabs" role="tablist" aria-label={t('settings.title')}>
        {TABS.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} className={`tab${tab === x.id ? ' is-on' : ''}`} onClick={() => setTab(x.id)}>
            <Icon name={x.icon} size={16} /> {t(x.key)}
          </button>
        ))}
      </nav>

      {tab === 'general' && <>
      <Section icon="globe" title={t('settings.language')}>
        <Field label={t('settings.language')} hint={t('settings.languageHint')}>
          <select className="input" value={d.language} onChange={(e) => set('language', e.target.value as Locale)}>
            {LOCALES.map((loc) => (
              <option key={loc.id} value={loc.id}>{loc.native} ({loc.label})</option>
            ))}
          </select>
        </Field>
      </Section>

      <Section icon="gear" title={t('settings.behavior')}>
        <Field label={t('settings.closeBehavior')}>
          <select className="input" value={d.closeBehavior} onChange={(e) => set('closeBehavior', e.target.value as Draft['closeBehavior'])}>
            <option value="quit">{t('settings.closeQuit')}</option>
            <option value="minimize-while-playing">{t('settings.closeMinimize')}</option>
          </select>
        </Field>
      </Section>

      <Section icon="globe" title={t('settings.network')}>
        <Field label={t('settings.dns')} hint={t('settings.dnsHint')}>
          <div className="segmented" role="group" aria-label={t('settings.dns')}>
            {(['system', 'plain', 'doh'] as const).map((m) => (
              <button key={m} type="button" className={d.dnsMode === m ? 'is-on' : ''} aria-pressed={d.dnsMode === m} onClick={() => setDns({ dnsMode: m })}>{t(`settings.dns.${m}`)}</button>
            ))}
          </div>
        </Field>
        {d.dnsMode === 'plain' && <>
          <div className="segmented" role="group" aria-label={t('settings.dnsPresets')}>
            {DNS_PLAIN_PRESETS.map((p) => (
              <button key={p.id} type="button" className={d.dnsServers.trim() === p.servers ? 'is-on' : ''} aria-pressed={d.dnsServers.trim() === p.servers} onClick={() => setDns({ dnsServers: p.servers })}>{p.label}</button>
            ))}
          </div>
          <Field label={t('settings.dnsServers')} hint={t('settings.dnsServersHint')}>
            <input className="input mono" value={d.dnsServers} onChange={(e) => setDns({ dnsServers: e.target.value })} placeholder={DEFAULT_DNS_SERVERS} spellCheck={false} maxLength={200} />
          </Field>
        </>}
        {d.dnsMode === 'doh' && <>
          <div className="segmented" role="group" aria-label={t('settings.dnsPresets')}>
            {DOH_PRESETS.map((p) => (
              <button key={p.id} type="button" className={d.dnsDohUrl.trim() === p.url ? 'is-on' : ''} aria-pressed={d.dnsDohUrl.trim() === p.url} onClick={() => setDns({ dnsDohUrl: p.url })}>{p.label}</button>
            ))}
          </div>
          <Field label={t('settings.dohUrl')} hint={t('settings.dohUrlHint')}>
            <input className="input mono" value={d.dnsDohUrl} onChange={(e) => setDns({ dnsDohUrl: e.target.value })} placeholder={DEFAULT_DOH_URL} spellCheck={false} maxLength={256} />
          </Field>
        </>}
        <div className="row">
          <button type="button" className="btn btn--sm" disabled={dnsTesting} onClick={() => void testDns()}>{dnsTesting ? t('settings.dnsTesting') : t('settings.dnsTest')}</button>
          {dnsTest && (dnsTest.ok
            ? <span className="muted" role="status">{t('settings.dnsTestOk', { host: dnsTest.host, ips: dnsTest.addresses.slice(0, 2).join(', '), ms: dnsTest.ms })}</span>
            : <span className="form-error" role="alert">{t('settings.dnsTestFail', { error: dnsTest.error ?? '' })}</span>)}
        </div>
      </Section>

      <Section icon="refresh" title={t('settings.updates')}>
        <div className="row row--between"><span>{t('settings.checkUpdates')}</span><Switch checked={d.checkUpdates} label={t('settings.checkUpdates')} onChange={(v) => set('checkUpdates', v)} /></div>
        <div className="row row--between"><span>{t('settings.autoDownload')}</span><Switch checked={d.autoDownload} label={t('settings.autoDownload')} onChange={(v) => set('autoDownload', v)} /></div>
        <Field label="GitHub">
          <input className="input" value={d.updateRepo} onChange={(e) => set('updateRepo', e.target.value)} placeholder="ChaldS-mods/ChaldLauncher" spellCheck={false} />
        </Field>
        <div className="row">
          <button type="button" className="btn btn--sm" onClick={() => void checkUpdate()}>{t('settings.checkNow')}</button>
          {update && <span className="muted">{!update.configured ? t('update.check') : update.hasUpdate ? `${t('update.available')} ${update.latest}` : t('update.upToDate')}</span>}
        </div>
      </Section>
      </>}

      {tab === 'account' && <>
      <Section icon="user" title={t('settings.account')}><AccountSection /></Section>
      </>}

      {tab === 'game' && <>
      <Section icon="folder" title={t('settings.paths')}>
        <Field label={t('settings.instancesDir')} hint={info ? info.instancesDir : t('settings.defaultPath')}>
          <div className="row"><input className="input" value={d.instancesDir} onChange={(e) => set('instancesDir', e.target.value)} placeholder={t('settings.defaultPath')} /><button type="button" className="btn" onClick={() => void pick('instancesDir', t('settings.instancesDir'))}>{t('action.choose')}</button></div>
        </Field>
        <Field label={t('settings.downloadsDir')} hint={t('settings.defaultPath')}>
          <div className="row"><input className="input" value={d.downloadsDir} onChange={(e) => set('downloadsDir', e.target.value)} placeholder={t('settings.defaultPath')} /><button type="button" className="btn" onClick={() => void pick('downloadsDir', t('settings.downloadsDir'))}>{t('action.choose')}</button></div>
        </Field>
        {info && <p className="faint">{t('settings.dataDir')}<span className="mono">{info.dataDir}</span></p>}
      </Section>

      <Section icon="terminal" title="Java">
        <Field label={t('settings.javaPath')} hint={t('settings.javaAuto')}>
          <div className="row"><input className="input" value={d.javaPath} onChange={(e) => set('javaPath', e.target.value)} placeholder={t('settings.javaAuto')} /><button type="button" className="btn" disabled={detecting} onClick={() => void detect()}>{detecting ? t('common.loading') : 'Java'}</button></div>
        </Field>
        {javas && (javas.length === 0
          ? <p className="muted">Java</p>
          : <ul className="javas">{javas.map((j) => <li key={j.path}><button type="button" className="btn btn--sm" onClick={() => set('javaPath', j.path)}>{t('action.choose')}</button><strong>Java {j.major}</strong><span className="badge badge--plain">{j.source === 'launcher' ? 'launcher' : 'system'}</span><span className="mono muted grow">{j.path}</span></li>)}</ul>)}
      </Section>

      <Section icon="cube" title={t('settings.memory')}>
        <div className="row row--between"><span>{t('settings.memoryAuto')}</span><Switch checked={d.memAuto} label={t('settings.memoryAuto')} onChange={(v) => set('memAuto', v)} /></div>
        {d.memAuto ? (
          <div className="stack">
            <p className="muted">
              {sys ? memoryText(sys.totalMb) : ''}
            </p>
            {advice && <p><strong>{memoryText(advice.minMb)} – {memoryText(advice.maxMb)}</strong></p>}
          </div>
        ) : (
          <MemorySliders minMb={d.min} maxMb={d.max} onChange={(a, b) => setD({ ...d, min: a, max: b })} sys={sys} advice={advice} />
        )}
        <div className="form-grid">
          <Field label={t('settings.width')}><input className="input" inputMode="numeric" value={d.width} onChange={(e) => set('width', e.target.value)} /></Field>
          <Field label={t('settings.height')}><input className="input" inputMode="numeric" value={d.height} onChange={(e) => set('height', e.target.value)} /></Field>
          <div className="form-grid__wide"><Field label={t('settings.jvmArgs')}><input className="input" value={d.jvmArgs} onChange={(e) => set('jvmArgs', e.target.value)} spellCheck={false} /></Field></div>
        </div>
        <div className="row row--between"><span>{t('settings.fullscreen')}</span><Switch checked={d.fullscreen} label={t('settings.fullscreen')} onChange={(v) => set('fullscreen', v)} /></div>
      </Section>
      </>}

      {tab === 'look' && <>
      <Section icon="gear" title={t('settings.interface')}>
        <Field label={`${t('settings.uiScale')}: ${d.uiScale}%`} hint={t('settings.uiScaleHint')}>
          <input type="range" min={80} max={130} step={5} value={d.uiScale} onChange={(e) => set('uiScale', Number(e.target.value))} aria-label={t('settings.uiScale')} />
        </Field>
        <Field label={t('settings.corners')}>
          <div className="segmented" role="group" aria-label={t('settings.corners')}>
            {(['sharp', 'normal', 'round'] as const).map((c) => (
              <button key={c} type="button" className={d.cornerStyle === c ? 'is-on' : ''} aria-pressed={d.cornerStyle === c} onClick={() => set('cornerStyle', c)}>{t(`settings.corners.${c}`)}</button>
            ))}
          </div>
        </Field>
        <Field label={t('settings.fontMode')} hint={t('settings.fontModeHint')}>
          <div className="segmented" role="group" aria-label={t('settings.fontMode')}>
            {(['pixel', 'clean'] as const).map((c) => (
              <button key={c} type="button" className={d.fontMode === c ? 'is-on' : ''} aria-pressed={d.fontMode === c} onClick={() => set('fontMode', c)}>{t(`settings.font.${c}`)}</button>
            ))}
          </div>
        </Field>
        <Field label={`${t('settings.glow')}: ${d.glow}%`}>
          <input type="range" min={0} max={100} step={5} value={d.glow} onChange={(e) => set('glow', Number(e.target.value))} aria-label={t('settings.glow')} />
        </Field>
        <div className="row row--between"><span>{t('settings.animations')}</span><Switch checked={d.animations} label={t('settings.animations')} onChange={(v) => set('animations', v)} /></div>
        <div className="row row--between"><span>{t('settings.compactSidebar')}</span><Switch checked={d.compactSidebar} label={t('settings.compactSidebar')} onChange={(v) => set('compactSidebar', v)} /></div>
      </Section>

      <Section icon="gear" title={t('settings.appearance')}>
        <p className="muted">{t('settings.themeHint')}</p>
        <div className="presets" role="group" aria-label={t('settings.themePresets')}>
          {THEME_PRESETS.map((p) => {
            const on = (Object.keys(p.colors) as (keyof ThemeColors)[]).every((k) => p.colors[k] === colors[k].toLowerCase());
            return (
              <button key={p.id} type="button" className={`preset${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => setColors(p.colors)}>
                <span className="preset__sw" style={{ background: p.colors.bg }}><i style={{ background: p.colors.accent }} /><i style={{ background: p.colors.secondary }} /><i style={{ background: p.colors.highlight }} /></span>
                {p.label}
              </button>
            );
          })}
        </div>
        <ColorField label={t('settings.themeBg')} hint={t('settings.themeBgHint')} value={d.themeBg} onChange={(v) => set('themeBg', v)} />
        <ColorField label={t('settings.themeAccent')} hint={t('settings.themeAccentHint')} value={d.themeAccent} onChange={(v) => set('themeAccent', v)} />
        <ColorField label={t('settings.themeSecondary')} value={d.themeSecondary} onChange={(v) => set('themeSecondary', v)} />
        <ColorField label={t('settings.themeHighlight')} value={d.themeHighlight} onChange={(v) => set('themeHighlight', v)} />
        {bgTooLight && <p className="faint">{t('settings.themeLightWarn')}</p>}
        <div className="row"><button type="button" className="btn btn--sm" disabled={JSON.stringify(colors) === JSON.stringify(DEFAULT_THEME)} onClick={() => setColors(DEFAULT_THEME)}>{t('settings.themeReset')}</button></div>
      </Section>

      <Section icon="play" title={t('settings.sounds')}>
        <div className="row row--between"><span>{t('settings.uiSounds')}</span><Switch checked={d.uiSounds} label={t('settings.uiSounds')} onChange={(v) => set('uiSounds', v)} /></div>
        <Field label={`${t('settings.volume')}: ${d.soundVolume}%`}>
          <input type="range" min={0} max={100} step={5} value={d.soundVolume} disabled={!d.uiSounds} onChange={(e) => set('soundVolume', Number(e.target.value))} aria-label={t('settings.volume')} />
        </Field>
      </Section>
      </>}

      {tab === 'layout' && <>
      <Section icon="layers" title={t('settings.layoutTabs')}>
        <p className="muted">{t('settings.layoutTabsHint')}</p>
        {NAV_PAGES.filter((n) => n.page !== 'settings').map((n) => (
          <div key={n.page} className="row row--between">
            <span><Icon name={n.icon} size={16} /> {t(n.labelKey)}</span>
            <Switch checked={!d.hiddenPages.includes(n.page)} label={t(n.labelKey)} onChange={(v) => set('hiddenPages', v ? d.hiddenPages.filter((x) => x !== n.page) : [...d.hiddenPages, n.page])} />
          </div>
        ))}
      </Section>

      <Section icon="cube" title={t('settings.layoutPlace')}>
        <Field label={t('settings.sidebarSide')}>
          <div className="segmented" role="group" aria-label={t('settings.sidebarSide')}>
            {(['left', 'right'] as const).map((c) => (
              <button key={c} type="button" className={d.sidebarSide === c ? 'is-on' : ''} aria-pressed={d.sidebarSide === c} onClick={() => set('sidebarSide', c)}>{t(`settings.side.${c}`)}</button>
            ))}
          </div>
        </Field>
        <Field label={t('settings.panelSide')} hint={t('settings.panelSideHint')}>
          <div className="segmented" role="group" aria-label={t('settings.panelSide')}>
            {(['right', 'left', 'bottom', 'hidden'] as const).map((c) => (
              <button key={c} type="button" className={d.panelSide === c ? 'is-on' : ''} aria-pressed={d.panelSide === c} onClick={() => set('panelSide', c)}>{t(`settings.side.${c}`)}</button>
            ))}
          </div>
        </Field>
        <Field label={`${t('settings.panelWidth')}: ${d.panelWidth}px`}>
          <input type="range" min={260} max={560} step={10} value={d.panelWidth} disabled={d.panelSide === 'bottom' || d.panelSide === 'hidden'} onChange={(e) => set('panelWidth', Number(e.target.value))} aria-label={t('settings.panelWidth')} />
        </Field>
        <div className="row row--between"><span>{t('settings.showStatusBar')}</span><Switch checked={d.showStatusBar} label={t('settings.showStatusBar')} onChange={(v) => set('showStatusBar', v)} /></div>
      </Section>

      <Section icon="terminal" title={t('settings.customCss')}>
        <p className="muted">{t('settings.customCssHint')}</p>
        <textarea className="input code-area" value={d.customCss} spellCheck={false} maxLength={20000} placeholder={'.sidebar { background: #000; }'} onChange={(e) => set('customCss', e.target.value)} aria-label={t('settings.customCss')} />
        <div className="row"><button type="button" className="btn btn--sm" disabled={!d.customCss} onClick={() => set('customCss', '')}>{t('settings.clear')}</button></div>
      </Section>

      <Section icon="home" title={t('settings.customHtml')}>
        <p className="muted">{t('settings.customHtmlHint')}</p>
        <textarea className="input code-area" value={d.customHtml} spellCheck={false} maxLength={20000} placeholder={'<h2>Привет!</h2>'} onChange={(e) => set('customHtml', e.target.value)} aria-label={t('settings.customHtml')} />
        <div className="row"><button type="button" className="btn btn--sm" disabled={!d.customHtml} onClick={() => set('customHtml', '')}>{t('settings.clear')}</button></div>
      </Section>
      </>}

      {tab === 'discord' && <>
      <Section icon="globe" title={t('settings.discord')}>
        <div className="row row--between"><span>{t('settings.discordRpc')}</span><Switch checked={d.discordRpc} label={t('settings.discordRpc')} onChange={(v) => set('discordRpc', v)} /></div>
        <div className="row row--between"><span>{t('settings.discordInstance')}</span><Switch checked={d.discordShowInstance} label={t('settings.discordInstance')} onChange={(v) => set('discordShowInstance', v)} /></div>
        <p className="muted">{t('settings.discordHint')}</p>
      </Section>

      <DiscordSection />
      </>}

      <div className="savebar" role="region" aria-label={t('settings.save')}>
        {error ? <p className="form-error" role="alert">{error}</p> : <span className="muted">{dirty ? '…' : t('settings.saved')}</span>}
        <button className="btn" disabled={!dirty || saving} onClick={() => { setD(toDraft(settings)); setError(null); }}>{t('action.reset')}</button>
        <button className="btn btn--primary" disabled={!dirty || saving} onClick={() => void save()}>{t('action.save')}</button>
      </div>
    </div>
  );
}
