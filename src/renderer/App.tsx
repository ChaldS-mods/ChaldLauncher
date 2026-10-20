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
import { SettingsPage } from './pages/Settings';
import { VersionsPage } from './pages/Versions';
import { WardrobePage } from './pages/Wardrobe';
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
    case 'settings': return <SettingsPage />;
  }
}

/** Microsoft device-code sign-in: the user enters the code on microsoft.com. */
function DeviceCodeModal() {
  const dc = useStore((s) => s.deviceCode);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!dc) return;
    const end = Date.now() + dc.expiresInSec * 1000;
    const tick = () => setLeft(Math.max(0, Math.round((end - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [dc]);
  if (!dc) return null;
  const cancel = () => void call('auth:cancel').catch(() => undefined);
  return (
    <Modal
      title="Вход через Microsoft"
      onClose={cancel}
      footer={<button className="btn" onClick={cancel}>Отменить вход</button>}
    >
      <div className="stack">
        <p>Открой страницу <strong className="mono">{dc.verificationUri}</strong> в браузере и введи этот код:</p>
        <div className="devcode" aria-label="Код для входа">{dc.userCode}</div>
        <button className="btn btn--sm" onClick={() => void navigator.clipboard?.writeText(dc.userCode)}>Скопировать код</button>
        <ProgressBar fraction={null} />
        <p className="muted">Ожидаем подтверждения… Код действует ещё {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}. Пароль вводится только на сайте Microsoft, лаунчер его не видит.</p>
      </div>
    </Modal>
  );
}

/** Browser sign-in: the page opens in the system browser, here we only wait. */
function BrowserLoginModal() {
  const waiting = useStore((s) => s.loginWait);
  const dc = useStore((s) => s.deviceCode);
  if (waiting !== 'browser' || dc) return null;
  const cancel = () => void call('auth:cancel').catch(() => undefined);
  return (
    <Modal
      title="Вход через Microsoft"
      onClose={cancel}
      footer={<button className="btn" onClick={cancel}>Отменить вход</button>}
    >
      <div className="stack">
        <p>Страница входа открыта в браузере. Войди в аккаунт Microsoft, а затем вернись сюда: лаунчер продолжит сам.</p>
        <ProgressBar fraction={null} />
        <p className="muted">Если вкладка не открылась, отмени вход и выбери «Войти по коду». Пароль вводится только на сайте Microsoft, лаунчер его не видит.</p>
      </div>
    </Modal>
  );
}

function Boot({ error, retry }: { error: string | null; retry: () => void }) {
  return (
    <div className="boot" role="status" aria-live="polite">
      <div className="boot__inner">
        <LogoMark size={64} />
        <div className="wordmark">Chald<span>Launcher</span></div>
        {error ? (
          <>
            <p className="boot__error"><Icon name="alert" size={16} /> {error}</p>
            <button className="btn" onClick={retry}>Повторить</button>
          </>
        ) : (
          <>
            <ProgressBar fraction={null} />
            <p className="muted">Загрузка…</p>
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
