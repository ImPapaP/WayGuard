// Holds the signed-in user and the public app configuration.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, onAuthError } from './api.js';

const AuthContext = createContext(null);

export const HOME_BY_ROLE = { citizen: '/app', admin: '/admin', staff: '/admin', maintenance: '/crew', platform_admin: '/platform/lgus' };

// The last signed-in user is remembered on this device so the app (and the
// offline report outbox) still opens without a signal. The server session
// cookie stays the only thing that grants access.
const LAST_USER = 'wg-last-user';
function rememberUser(u) {
  try {
    if (u) localStorage.setItem(LAST_USER, JSON.stringify({ id: u.id, role: u.role, full_name: u.full_name, email: u.email, lgu_id: u.lgu_id, lgu_name: u.lgu_name, team_id: u.team_id, team_name: u.team_name }));
    else localStorage.removeItem(LAST_USER);
  } catch {
    /* storage unavailable */
  }
}
function lastUser() {
  try {
    const u = JSON.parse(localStorage.getItem(LAST_USER) || 'null');
    return u ? { ...u, offline: true } : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = still loading
  const [config, setConfig] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const { user: u } = await api.get('/api/auth/me');
      rememberUser(u);
      setUser(u);
      return u;
    } catch (err) {
      // No signal: keep working as the last signed-in user (citizens only).
      const cached = err?.code === 'network' ? lastUser() : null;
      if (cached?.role === 'citizen') {
        setUser(cached);
        return cached;
      }
      setUser(null);
      return null;
    }
  }, []);

  const refreshConfig = useCallback(async () => {
    try {
      const nextConfig = await api.get('/api/public/config');
      setConfig(nextConfig);
      return nextConfig;
    } catch {
      const fallback = {
        lgu_name: 'Local Government Unit',
        lgus: [],
        map_center: { lat: 14.8433, lng: 120.8114, zoom: 14 },
        max_photos_per_report: 5,
        max_photo_mb: 8,
        tiles: {
          url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 19,
        },
        geocoder_enabled: false,
        offline: true,
      };
      setConfig(fallback);
      return fallback;
    }
  }, []);

  useEffect(() => {
    refresh();
    refreshConfig();
  }, [refresh, refreshConfig]);

  // Back online after opening the app offline: confirm the session again.
  useEffect(() => {
    if (!user?.offline) return undefined;
    const again = () => refresh();
    window.addEventListener('online', again);
    return () => window.removeEventListener('online', again);
  }, [user, refresh]);

  // If the server says the session ended, reflect it immediately.
  useEffect(
    () =>
      onAuthError((err) => {
        if (err.status === 401) {
          rememberUser(null);
          setUser(null);
        }
        if (err.code === 'password_change_required') refresh();
      }),
    [refresh],
  );

  const login = useCallback(async (email, password) => {
    const { user: u } = await api.post('/api/auth/login', { email, password });
    rememberUser(u);
    setUser(u);
    await refreshConfig();
    return u;
  }, [refreshConfig]);

  const register = useCallback(async (payload) => {
    const { user: u } = await api.post('/api/auth/register', payload);
    rememberUser(u);
    setUser(u);
    await refreshConfig();
    return u;
  }, [refreshConfig]);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      rememberUser(null);
      setUser(null);
    }
  }, []);

  const setAndRemember = useCallback((u) => {
    rememberUser(u);
    setUser(u);
  }, []);

  const value = useMemo(
    () => ({ user, setUser: setAndRemember, refresh, refreshConfig, login, register, logout, config }),
    [user, setAndRemember, refresh, refreshConfig, login, register, logout, config],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
