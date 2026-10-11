import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, surfaceFor } from './App';
// The fonts ship with the app (Vite bundles the woff2 files), so venue Wi-Fi or a hotspot that
// can't reach Google Fonts still gets them.
import '@fontsource-variable/instrument-sans/wght.css';
import '@fontsource-variable/instrument-sans/wght-italic.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import './styles.css';

// Light paper for the landing page and phones, the dark stage for the big screen. Set before the
// first paint so nothing flashes the wrong colour.
const surface = surfaceFor(location.pathname);
document.documentElement.dataset.surface = surface;
document.querySelector('meta[name="theme-color"]')?.setAttribute('content', surface === 'dark' ? '#07080b' : '#ffffff');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
