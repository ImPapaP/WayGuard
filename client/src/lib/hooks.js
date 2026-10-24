import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

// Loads JSON from the API and re-runs when `path` changes.
// Returns { data, error, loading, reload, setData }.
export function useApi(path, { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path && enabled) });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path || !enabled) {
      setState((s) => ({ ...s, loading: false }));
      return undefined;
    }
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    api
      .get(path, { signal: ctrl.signal })
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error) => {
        if (error.name !== 'AbortError') setState((s) => ({ ...s, error, loading: false }));
      });
    return () => ctrl.abort();
  }, [path, enabled, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((updater) => setState((s) => ({ ...s, data: typeof updater === 'function' ? updater(s.data) : updater })), []);
  return { ...state, reload, setData };
}

export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} — Wayguard` : 'Wayguard — Road Pothole Reporting and Monitoring';
  }, [title]);
}

export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function useDebounced(value, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useClickOutside(onOutside) {
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onOutside();
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [onOutside]);
  return ref;
}
