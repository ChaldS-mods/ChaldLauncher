import { useEffect, useState } from 'react';
import { call, errMsg } from './api';
import { Icon } from './components/Icon';
import { LogoMark } from './components/Logo';
import { CreateWizard } from './components/CreateWizard';
import { Sidebar, StatusBar, TitleBar, Toasts } from './components/Shell';
import { Modal, ProgressBar } from './components/ui';
import { ConsolePage } from './pages/Console';
import { ContentPage } from './pages/Content';
import { HomePage } from './pages/Home';
import { InstancesPage } from './pages/Instances';
import { ModrinthPage } from './pages/Modrinth';
import { MojangPage } from './pages/Mojang';
import { SettingsPage } from './pages/Settings';
import { VersionsPage } from './pages/Versions';
import { WardrobePage } from './pages/Wardrobe';
import { useI18n } from './i18n';
import { useStore, type Page } from './store';

function PageView({ page }: { page: Page }) {
  switch (page) {
    case 'home': return <HomePage />;
    case 'instances': return <InstancesPage />;
    case 'versions': return <VersionsPage />;
    case 'mods': return <ContentPage kind="mods" />;
    case 'resourcepacks': return <ContentPage kind="resourcepacks" />;
    case 'wardrobe': return <WardrobePage />;
    case 'modrinth': return <ModrinthPage />;
    case 'console': return <ConsolePage />;
    case 'mojang': return <MojangPage />;
    case 'settings': return <SettingsPage />;
  }
}

/** Microsoft device-code sign-in: the user enters the code on microsoft.com. */
function DeviceCodeModal() {
  const dc = useStore((s) => s.deviceCode);
  const { t } = useI18n();
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!dc) return;
    const end = Date.now() + dc.expiresInSec * 1000;
    const tick = () => setLeft(Math.max(0, Math.round((end - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [dc]);
  if (!dc) return null;
  const cancel = () => void call('auth:cancel').catch(() => undefined);
  return (
    <Modal
      title={t('auth.msTitle')}
      onClose={cancel}
      footer={<button className="btn" onClick={cancel}>{t('auth.cancelLogin')}</button>}
    >
      <div className="stack">
        <p><strong className="mono">{dc.verificationUri}</strong></p>
        <div className="devcode" aria-label={t('auth.msCode')}>{dc.userCode}</div>
        <button className="btn btn--sm" onClick={() => void navigator.clipboard?.writeText(dc.userCode)}>{t('auth.copyCode')}</button>
        <ProgressBar fraction={null} />
        <p className="muted">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} — {t('auth.msBrowserHint')}</p>
      </div>
    </Modal>
  );
}

/** Browser sign-in: the page opens in the system browser, here we only wait. */
function BrowserLoginModal() {
  const waiting = useStore((s) => s.loginWait);
  const dc = useStore((s) => s.deviceCode);
  const { t } = useI18n();
  if (waiting !== 'browser' || dc) return null;
  const cancel = () => void call('auth:cancel').catch(() => undefined);
  return (
    <Modal
      title={t('auth.msTitle')}
      onClose={cancel}
      footer={<button className="btn" onClick={cancel}>{t('auth.cancelLogin')}</button>}
    >
      <div className="stack">
        <p>{t('auth.msBrowser')}</p>
        <ProgressBar fraction={null} />
        <p className="muted">{t('auth.msBrowserHint')}</p>
      </div>
    </Modal>
  );
}

function Boot({ error, retry }: { error: string | null; retry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="boot" role="status" aria-live="polite">
      <div className="boot__inner">
        <LogoMark size={64} />
        <div className="wordmark">Chald<span>Launcher</span></div>
        {error ? (
          <>
            <p className="boot__error"><Icon name="alert" size={16} /> {error}</p>
            <button className="btn" onClick={retry}>{t('boot.retry')}</button>
          </>
        ) : (
          <>
            <ProgressBar fraction={null} />
            <p className="muted">{t('boot.loading')}</p>
          </>
        )}
      </div>
    </div>
  );
}

export function App() {
  const ready = useStore((s) => s.ready);
  const page = useStore((s) => s.page);
  const wizardOpen = useStore((s) => s.wizard.open);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setError(null);
    useStore.getState().init().catch((e) => setError(errMsg(e)));
  }, [attempt]);

  if (!ready) {
    return <Boot error={error} retry={() => { useStore.setState({}); setAttempt((a) => a + 1); }} />;
  }
  return (
    <div className="app">
      <TitleBar />
      <Sidebar />
      <main className="main" id="main">
        <PageView page={page} />
      </main>
      <StatusBar />
      <Toasts />
      {wizardOpen && <CreateWizard />}
      <DeviceCodeModal />
      <BrowserLoginModal />
    </div>
  );
}
