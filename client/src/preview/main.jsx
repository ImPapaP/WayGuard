// Entry point of the self-contained browser preview (client/build-preview.mjs).
// It runs the real Wayguard interface against an in-page stand-in for the API
// (mockServer.js) seeded with the labelled demo data. Nothing here is used by
// the real application, which always talks to the Node.js server.
import { createRoot } from 'react-dom/client';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/components.css';
import '../styles/layout.css';
import '../styles/pages.css';
import '../styles/motion.css';
import './preview.css';
import { useEffect } from 'react';
import App from '../App.jsx';
import { initReveal } from '../lib/reveal.js';
import { initLang } from '../lib/i18n/index.js';
import { useAuth, HOME_BY_ROLE } from '../lib/auth.jsx';
import { useNavigate } from '../lib/router.jsx';
import { useToast } from '../lib/toast.jsx';
import { api } from '../lib/api.js';
import { installMockServer, signInAs, demoDriveRoute, PREVIEW_PASSWORD } from './mockServer.js';

import logotypeColor from '../../public/brand/wayguard-logotype-wmark-color.png';
import logotypeReversed from '../../public/brand/wayguard-logotype-wmark-reversed.png';
import fullColor from '../../public/brand/wayguard-logo-full-color.png';
import fullReversed from '../../public/brand/wayguard-logo-full-reversed.png';
import markColor from '../../public/brand/wayguard-mark-color.png';
import markReversed from '../../public/brand/wayguard-mark-reversed.png';

globalThis.__WG_ASSETS__ = {
  '/brand/wayguard-logotype-wmark-color.png': logotypeColor,
  '/brand/wayguard-logotype-wmark-reversed.png': logotypeReversed,
  '/brand/wayguard-logo-full-color.png': fullColor,
  '/brand/wayguard-logo-full-reversed.png': fullReversed,
  '/brand/wayguard-mark-color.png': markColor,
  '/brand/wayguard-mark-reversed.png': markReversed,
};

installMockServer();

// Location access is not available inside the preview frame, so "Use my
// current location" returns a simulated reading near the demo city centre.
try {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition(ok) {
        setTimeout(
          () =>
            ok({
              coords: { latitude: 14.84398 + (Math.random() - 0.5) * 0.002, longitude: 120.81287 + (Math.random() - 0.5) * 0.002, accuracy: 9 + Math.round(Math.random() * 8) },
              timestamp: Date.now(),
            }),
          700,
        );
      },
      // Drive mode: replay a short simulated drive past a demo pothole.
      watchPosition(ok) {
        const route = demoDriveRoute();
        let i = 0;
        const tick = () => {
          const p = route[Math.min(i, route.length - 1)];
          if (p) ok({ coords: { latitude: p.lat, longitude: p.lng, accuracy: 8, heading: null, speed: null }, timestamp: Date.now() });
          i += 1;
        };
        tick();
        return setInterval(tick, 1000);
      },
      clearWatch(id) {
        clearInterval(id);
      },
    },
  });
} catch {
  // keep the browser's own behaviour
}

const ROLES = [
  { key: 'public', label: 'Public', email: null },
  { key: 'citizen', label: 'Citizen', email: 'maria@demo.wayguard.test' },
  { key: 'admin', label: 'LGU admin', email: 'admin@demo.wayguard.test' },
  { key: 'maintenance', label: 'Road crew', email: 'crew.alpha@demo.wayguard.test' },
];

function PreviewBar() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const active = user ? user.role : user === null ? 'public' : null;

  // Links that would download a file from the server (CSV/PDF exports) and
  // any plain link the app did not route itself.
  useEffect(() => {
    function onClick(e) {
      const a = e.target.closest?.('a[href]');
      if (!a || e.defaultPrevented) return;
      const href = a.getAttribute('href');
      if (href.startsWith('/api/')) {
        e.preventDefault();
        toast('File downloads (CSV, PDF and summary reports) are turned off in this preview. The installed app downloads them.', {
          type: 'error',
          duration: 6000,
        });
      } else if (href.startsWith('/')) {
        e.preventDefault();
        navigate(href);
      }
    }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [navigate, toast]);

  async function switchTo(role) {
    if (role.key === active) {
      navigate(role.email ? HOME_BY_ROLE[role.key] : '/');
      return;
    }
    if (role.email) signInAs(role.email);
    else await api.post('/api/auth/logout');
    await refresh();
    navigate(role.email ? HOME_BY_ROLE[role.key] : '/');
  }

  return (
    <div className="preview-bar" role="region" aria-label="Preview controls">
      <div className="preview-bar__inner">
        <p className="preview-bar__note">
          <span className="preview-bar__tag">Live preview</span>
          Demo data only, reset on reload. GPS and drive mode are simulated. Demo password: <code>{PREVIEW_PASSWORD}</code>
        </p>
        <div className="preview-bar__roles" role="group" aria-label="View Wayguard as">
          <span className="preview-bar__label">Quick switch</span>
          {ROLES.map((r) => (
            <button
              key={r.key}
              type="button"
              className="preview-bar__role"
              aria-pressed={active === r.key}
              onClick={() => switchTo(r)}
              title={r.email ? `Sign in as ${r.email}` : 'Sign out and open the public site'}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App banner={<PreviewBar />} />);
initReveal();
initLang();
