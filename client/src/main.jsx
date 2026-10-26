import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/layout.css';
import './styles/pages.css';
import './styles/motion.css';
import App from './App.jsx';
import { initReveal } from './lib/reveal.js';
import { initLang } from './lib/i18n/index.js';

createRoot(document.getElementById('root')).render(<App />);
initReveal();
initLang();

// Installable PWA: register the service worker in production builds.
if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
