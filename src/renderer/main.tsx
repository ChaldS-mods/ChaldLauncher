import './chald-android-shim';
import '@fontsource/rubik/cyrillic-400.css';
import '@fontsource/rubik/cyrillic-500.css';
import '@fontsource/rubik/cyrillic-600.css';
import '@fontsource/rubik/latin-400.css';
import '@fontsource/rubik/latin-500.css';
import '@fontsource/rubik/latin-600.css';
import './tokens.css';
import './app.css';
import './pages.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { configureSound, installClickSounds } from './sound';
import { useStore } from './store';
import { applyCachedTheme, applyLook, applyTheme, cacheTheme, lookFromSettings, themeFromSettings } from './theme';

applyCachedTheme();
installClickSounds();
const applySound = () => {
  const s = useStore.getState().settings;
  configureSound({ enabled: s?.uiSounds ?? true, volume: s?.soundVolume ?? 50 });
};
let themeKey = '';
const applySavedTheme = () => {
  const s = useStore.getState().settings;
  if (!s) return;
  const colors = themeFromSettings(s);
  const key = JSON.stringify(colors);
  if (key === themeKey) return;
  themeKey = key;
  applyTheme(colors);
  cacheTheme(colors);
};
let lookKey = '';
const applySavedLook = () => {
  const s = useStore.getState().settings;
  if (!s) return;
  const look = lookFromSettings(s);
  const key = JSON.stringify(look);
  if (key === lookKey) return;
  lookKey = key;
  applyLook(look);
};
const applyAll = () => { applySound(); applySavedTheme(); applySavedLook(); };
applyAll();
useStore.subscribe(applyAll);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
