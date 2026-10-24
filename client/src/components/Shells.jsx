// Page frames for each audience: the public site, the citizen and crew apps
// (phone-first with a bottom tab bar) and the administrator workspace.
import { useCallback, useEffect, useState } from 'react';
import {
  LuBell,
  LuLogOut,
  LuUser,
  LuHouse,
  LuList,
  LuMap,
  LuPlus,
  LuLayoutDashboard,
  LuUsers,
  LuSettings,
  LuDownload,
  LuClipboardList,
  LuHistory,
  LuMenu,
  LuBuilding2,
  LuActivity,
  LuWifiOff,
  LuHardHat,
} from 'react-icons/lu';
import Logo from './Logo.jsx';
import { Link, NavLink, useLocation, useNavigate } from '../lib/router.jsx';
import { useAuth, HOME_BY_ROLE } from '../lib/auth.jsx';
import HeroBackdrop from './HeroBackdrop.jsx';
import { api } from '../lib/api.js';
import { useClickOutside, useOnline } from '../lib/hooks.js';
import { initials, ROLES } from '../lib/format.js';

// ---------------------------------------------------------------- unread count
export function notifyNotificationsChanged() {
  window.dispatchEvent(new Event('wg:notifications'));
}

function useUnreadCount() {
  const { user } = useAuth();
  const [count, setCount] = useState(0);
  const load = useCallback(() => {
    if (!user || user.must_change_password) return;
    api
      .get('/api/notifications/unread-count')
      .then((d) => setCount(d.unread))
      .catch(() => {});
  }, [user]);
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    window.addEventListener('focus', load);
    window.addEventListener('wg:notifications', load);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', load);
      window.removeEventListener('wg:notifications', load);
    };
  }, [load]);
  return count;
}

function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="offline-banner" role="status">
      <LuWifiOff aria-hidden /> You are offline. Reports and updates will load again when you reconnect.
    </div>
  );
}

// ---------------------------------------------------------------- account menu
export function AccountMenu({ basePath }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(useCallback(() => setOpen(false), []));
  if (!user) return null;
  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className="icon-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Account menu for ${user.full_name}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="avatar" aria-hidden>
          {initials(user.full_name)}
        </span>
      </button>
      {open && (
        <div className="menu__panel" role="menu">
          <div className="menu__who">
            <strong>{user.full_name}</strong>
            <span>
              {ROLES[user.role]}
              {user.team_name ? `, ${user.team_name}` : ''}
            </span>
          </div>
          <Link to={`${basePath}/profile`} className="menu__item" role="menuitem" onClick={() => setOpen(false)}>
            <LuUser aria-hidden /> Profile and password
          </Link>
          <button
            type="button"
            className="menu__item"
            role="menuitem"
            onClick={async () => {
              setOpen(false);
              await logout();
              navigate('/login');
            }}
          >
            <LuLogOut aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- public site
export function PublicHeader() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <Link to="/" className="site-header__logo" aria-label="Wayguard home">
          <Logo variant="horizontal-color" height={40} />
        </Link>
        <nav className="site-nav" aria-label="Main">
          <NavLink to="/map" className="hide-sm">
            Pothole map
          </NavLink>
          {user ? (
            <Link to={HOME_BY_ROLE[user.role]} className="btn btn--navy btn--sm">
              Open my workspace
            </Link>
          ) : (
            <>
              <NavLink to="/login" className={pathname === '/login' ? '' : ''}>
                Sign in
              </NavLink>
              <Link to="/register" className="btn btn--primary btn--sm hide-sm">
                Report a pothole
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export function PublicFooter() {
  const { config } = useAuth();
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="site-footer__inner">
          <Logo variant="full-reversed" height={110} />
          <div className="site-footer__links">
            <strong style={{ color: '#fff' }}>Wayguard</strong>
            <Link to="/map">Public pothole map</Link>
            <Link to="/register">Create a citizen account</Link>
            <Link to="/login">Sign in</Link>
          </div>
          <div className="site-footer__links" style={{ maxWidth: '38ch' }}>
            <strong style={{ color: '#fff' }}>{config?.lgu_name || 'Your LGU'}</strong>
            <span>
              Reports are reviewed by authorized LGU personnel before they appear on the public map. Your name and contact details
              are never shown publicly.
            </span>
          </div>
        </div>
        <div className="site-footer__legal">
          {config?.map?.provider === 'google' ? (
            <>Maps &copy; Google. </>
          ) : (
            <>
              Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors.{' '}
            </>
          )}
          Wayguard IT 305 project,
          Bulacan State University.
        </div>
      </div>
    </footer>
  );
}

// `bare` omits the footer, for full-screen pages such as the map.
export function PublicLayout({ children, bare = false }) {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <PublicHeader />
      <OfflineBanner />
      <main id="main">{children}</main>
      {!bare && <PublicFooter />}
    </>
  );
}

export function AuthLayout({ children }) {
  return (
    <div className="auth">
      <aside className="auth__brand" aria-hidden>
        <HeroBackdrop glows={false} bubbles={false} />
        <span className="lane" />
        <Logo variant="full-reversed" height={150} />
        <p>Spot a pothole, send a photo and its location, and follow the repair until the road is safe again.</p>
      </aside>
      <main className="auth__form" id="main">
        <div className="auth__card">
          <Link to="/" className="auth__mobile-logo" aria-label="Wayguard home">
            <Logo variant="full-color" height={120} />
          </Link>
          {children}
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- citizen + crew
const CITIZEN_TABS = [
  { to: '/app', label: 'Home', icon: LuHouse, end: true },
  { to: '/app/reports', label: 'My reports', icon: LuList },
  { to: '/app/report', label: 'Report', icon: LuPlus, cta: true, end: true },
  { to: '/app/map', label: 'Map', icon: LuMap },
  { to: '/app/notifications', label: 'Alerts', icon: LuBell, badge: true },
];

const CREW_TABS = [
  { to: '/crew', label: 'Tasks', icon: LuClipboardList, end: true },
  { to: '/crew/map', label: 'Map', icon: LuMap },
  { to: '/crew/history', label: 'History', icon: LuHistory },
  { to: '/crew/notifications', label: 'Alerts', icon: LuBell, badge: true },
];

export function AppShell({ kind = 'citizen', children }) {
  const tabs = kind === 'crew' ? CREW_TABS : CITIZEN_TABS;
  const base = kind === 'crew' ? '/crew' : '/app';
  const unread = useUnreadCount();
  const dark = kind === 'crew';
  return (
    <div className="app">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className={`topbar ${dark ? 'topbar--dark' : ''}`}>
        <div className="container topbar__inner">
          <Link to={base} className="topbar__logo" aria-label="Wayguard home">
            <Logo variant={dark ? 'horizontal-reversed' : 'horizontal-color'} height={40} />
          </Link>
          {dark && (
            <span className="crew-chip">
              <LuHardHat aria-hidden /> Crew
            </span>
          )}
          <nav className="topbar__nav" aria-label="Main">
            {tabs
              .filter((t) => !t.badge)
              .map((t) => (
                <NavLink key={t.to} to={t.to} end={t.end}>
                  <t.icon aria-hidden /> {t.cta ? 'Report a pothole' : t.label}
                </NavLink>
              ))}
          </nav>
          <Link to={`${base}/notifications`} className="icon-btn" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
            <LuBell aria-hidden />
            {unread > 0 && <span className="icon-btn__dot">{unread > 99 ? '99+' : unread}</span>}
          </Link>
          <AccountMenu basePath={base} />
        </div>
      </header>
      <OfflineBanner />
      <main id="main" className="app__main">
        {children}
      </main>
      <nav className="tabbar" aria-label="Main">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={t.cta ? 'tabbar__cta' : ''}>
            <span>
              <t.icon aria-hidden />
            </span>
            <span>{t.label}</span>
            {t.badge && unread > 0 && <span className="tabbar__badge">{unread > 99 ? '99+' : unread}</span>}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

// ---------------------------------------------------------------- administrator
function AdminNav({ counts, unread, onNavigate }) {
  const items = [
    { to: '/admin', label: 'Dashboard', icon: LuLayoutDashboard, end: true },
    { to: '/admin/reports', label: 'Reports', icon: LuClipboardList, count: counts?.pending_review },
    { to: '/admin/map', label: 'Map', icon: LuMap },
    { to: '/admin/exports', label: 'Exports and summaries', icon: LuDownload },
    { to: '/admin/notifications', label: 'Notifications', icon: LuBell, count: unread },
  ];
  const manage = [
    { to: '/admin/users', label: 'Users', icon: LuUsers },
    { to: '/admin/teams', label: 'Teams and agencies', icon: LuBuilding2 },
    { to: '/admin/settings', label: 'System settings', icon: LuSettings },
    { to: '/admin/activity', label: 'Activity log', icon: LuActivity },
  ];
  const render = (i) => (
    <NavLink key={i.to} to={i.to} end={i.end} onClick={onNavigate}>
      <i.icon aria-hidden /> {i.label}
      {i.count > 0 && <span className="sidebar__count">{i.count}</span>}
    </NavLink>
  );
  return (
    <>
      <nav className="sidebar__nav" aria-label="Workspace">
        {items.map(render)}
      </nav>
      <div className="sidebar__group" id="manage-label">
        Management
      </div>
      <nav className="sidebar__nav" aria-labelledby="manage-label">
        {manage.map(render)}
      </nav>
    </>
  );
}

function Sidebar({ counts, unread, onNavigate }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="sidebar admin__sidebar-inner" style={{ display: 'flex' }}>
      <Link to="/admin" className="sidebar__logo" aria-label="Wayguard dashboard" onClick={onNavigate}>
        <Logo variant="horizontal-reversed" height={48} />
      </Link>
      <AdminNav counts={counts} unread={unread} onNavigate={onNavigate} />
      <div className="sidebar__foot">
        <div className="sidebar__user">
          <span className="avatar" aria-hidden>
            {initials(user?.full_name)}
          </span>
          <span>
            {user?.full_name}
            <small>LGU administrator</small>
          </span>
        </div>
        <nav className="sidebar__nav" aria-label="Account">
          <NavLink to="/admin/profile" onClick={onNavigate}>
            <LuUser aria-hidden /> Profile and password
          </NavLink>
          <a
            href="/login"
            onClick={async (e) => {
              e.preventDefault();
              await logout();
              navigate('/login');
            }}
          >
            <LuLogOut aria-hidden /> Sign out
          </a>
        </nav>
      </div>
    </div>
  );
}

export function AdminShell({ children }) {
  const unread = useUnreadCount();
  const [drawer, setDrawer] = useState(false);
  const [counts, setCounts] = useState(null);
  const { pathname } = useLocation();
  useEffect(() => {
    api
      .get('/api/admin/stats')
      .then((s) => setCounts(s.totals))
      .catch(() => {});
  }, [pathname]);
  useEffect(() => {
    if (!drawer) return undefined;
    const onKey = (e) => e.key === 'Escape' && setDrawer(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawer]);
  return (
    <div className="admin">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="admin__sidebar">
        <Sidebar counts={counts} unread={unread} />
      </aside>
      <header className="admin__mobilebar">
        <Link to="/admin" aria-label="Wayguard dashboard" className="logo-link">
          <Logo variant="horizontal-reversed" height={40} />
        </Link>
        <Link to="/admin/notifications" className="icon-btn" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
          <LuBell aria-hidden />
          {unread > 0 && <span className="icon-btn__dot">{unread}</span>}
        </Link>
        <button type="button" className="icon-btn" aria-label="Open menu" aria-expanded={drawer} onClick={() => setDrawer(true)}>
          <LuMenu aria-hidden />
        </button>
      </header>
      {drawer && (
        <>
          <div className="drawer-backdrop" onClick={() => setDrawer(false)} />
          <div className="drawer" role="dialog" aria-modal="true" aria-label="Menu">
            <Sidebar counts={counts} unread={unread} onNavigate={() => setDrawer(false)} />
          </div>
        </>
      )}
      <div className="admin__main">
        <OfflineBanner />
        <main id="main">{children}</main>
      </div>
    </div>
  );
}
