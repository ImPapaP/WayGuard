// A small history-based router (no dependency): <Router>, <Link>,
// useLocation, useNavigate, useParams and route matching.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const RouterContext = createContext(null);
const ParamsContext = createContext({});

// The self-contained preview build keeps its history in memory, because the
// page runs inside a frame whose own URL cannot change.
const memory = __WG_PREVIEW__ ? { stack: [{ pathname: '/', search: '', hash: '' }], index: 0 } : null;

function current() {
  if (memory) return { pathname: memory.stack[memory.index].pathname, search: memory.stack[memory.index].search };
  return { pathname: window.location.pathname, search: window.location.search };
}

function currentHref() {
  if (memory) {
    const e = memory.stack[memory.index];
    return e.pathname + e.search + e.hash;
  }
  return window.location.pathname + window.location.search + window.location.hash;
}

export function Router({ children }) {
  const [location, setLocation] = useState(current);

  useEffect(() => {
    const onPop = () => setLocation(current());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to, { replace = false, scroll = true } = {}) => {
    if (typeof to === 'number') {
      if (memory) {
        memory.index = Math.min(memory.stack.length - 1, Math.max(0, memory.index + to));
        setLocation(current());
      } else {
        window.history.go(to);
      }
      return;
    }
    const base = memory ? `http://wayguard.preview${currentHref()}` : window.location.origin;
    const url = new URL(to, base);
    const next = url.pathname + url.search + url.hash;
    if (next === currentHref()) return;
    if (memory) {
      const entry = { pathname: url.pathname, search: url.search, hash: url.hash };
      if (replace) memory.stack[memory.index] = entry;
      else {
        memory.stack = memory.stack.slice(0, memory.index + 1).concat(entry);
        memory.index += 1;
      }
    } else {
      window.history[replace ? 'replaceState' : 'pushState']({}, '', next);
    }
    setLocation(current());
    if (scroll) window.scrollTo(0, 0);
  }, []);

  const value = useMemo(() => {
    const query = Object.fromEntries(new URLSearchParams(location.search));
    return { ...location, query, navigate };
  }, [location, navigate]);

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useLocation() {
  return useContext(RouterContext);
}

export function useNavigate() {
  return useContext(RouterContext).navigate;
}

export function useParams() {
  return useContext(ParamsContext);
}

// Updates query-string parameters without adding a history entry.
export function useQueryState() {
  const { query, pathname, navigate } = useLocation();
  const setQuery = useCallback(
    (patch) => {
      const next = new URLSearchParams({ ...query, ...patch });
      for (const [k, v] of [...next.entries()]) if (v === '' || v === 'undefined' || v === 'null') next.delete(k);
      const s = next.toString();
      navigate(pathname + (s ? `?${s}` : ''), { replace: true, scroll: false });
    },
    [query, pathname, navigate],
  );
  return [query, setQuery];
}

export function matchPath(pattern, pathname) {
  const keys = [];
  const source = pattern
    .split('/')
    .map((seg) => {
      if (seg === '*') return '.*';
      if (seg.startsWith(':')) {
        keys.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  const m = new RegExp(`^${source}/?$`).exec(pathname);
  if (!m) return null;
  return Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
}

// Renders the first route whose path matches. `routes` is [{ path, element }].
export function Routes({ routes, fallback = null }) {
  const { pathname } = useLocation();
  for (const route of routes) {
    const params = matchPath(route.path, pathname);
    if (params) {
      return <ParamsContext.Provider value={params}>{route.element}</ParamsContext.Provider>;
    }
  }
  return fallback;
}

export function Link({ to, replace, onClick, children, ...rest }) {
  const { navigate } = useLocation();
  return (
    <a
      href={to}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (rest.target === '_blank') return;
        e.preventDefault();
        navigate(to, { replace });
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

// Link that marks itself as the current page for assistive technology.
export function NavLink({ to, end = false, children, ...rest }) {
  const { pathname } = useLocation();
  const active = end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);
  return (
    <Link to={to} aria-current={active ? 'page' : undefined} {...rest}>
      {children}
    </Link>
  );
}

export function Navigate({ to, replace = true }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to, { replace });
  }, [to, replace, navigate]);
  return null;
}
