import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, surfaceFor } from './App';
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
