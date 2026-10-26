// Holds the signed-in user and the public app configuration.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, onAuthError } from './api.js';

const AuthContext = createContext(null);

export const HOME_BY_ROLE = { citizen: '/app', admin: '/admin', staff: '/admin', maintenance: '/crew', platform_admin: '/platform/lgus' };

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = still loading
  const [config, setConfig] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const { user: u } = await api.get('/api/auth/me');
      setUser(u);
      return u;
    } catch {
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

  // If the server says the session ended, reflect it immediately.
  useEffect(
    () =>
      onAuthError((err) => {
        if (err.status === 401) setUser(null);
        if (err.code === 'password_change_required') refresh();
      }),
    [refresh],
  );

  const login = useCallback(async (email, password) => {
    const { user: u } = await api.post('/api/auth/login', { email, password });
    setUser(u);
    await refreshConfig();
    return u;
  }, [refreshConfig]);

  const register = useCallback(async (payload) => {
    const { user: u } = await api.post('/api/auth/register', payload);
    setUser(u);
    await refreshConfig();
    return u;
  }, [refreshConfig]);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, setUser, refresh, refreshConfig, login, register, logout, config }),
    [user, refresh, refreshConfig, login, register, logout, config],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
