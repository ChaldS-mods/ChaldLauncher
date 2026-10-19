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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
