// Pothole location: GPS (FR-04), map pin or address search (FR-05).
// GPS is only requested when the person taps the button.
import { useEffect, useState } from 'react';
import { LuLocateFixed, LuSearch, LuMapPin, LuTriangleAlert, LuKeyboard } from 'react-icons/lu';
import MapView from './MapView.jsx';
import { Button, Alert, StatusBadge } from './ui.jsx';
import { api, qs } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { formatCoords, formatDistance, timeAgo } from '../lib/format.js';
import ConfirmButton from './ConfirmButton.jsx';

const SOURCE_TEXT = { gps: 'from GPS', map: 'pinned on the map', address: 'from address search' };

export default function LocationPicker({ value, onChange, onAddress, error }) {
  const { config } = useAuth();
  const [gps, setGps] = useState({ state: 'idle', message: null });
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState({ loading: false, items: null, error: null });
  const [nearby, setNearby] = useState(null);
  const [manual, setManual] = useState(false);
  const [manualText, setManualText] = useState({ lat: '', lng: '' });

  const set = (lat, lng, source, accuracy = null) => onChange({ lat, lng, source, accuracy });

  function useGps() {
    if (!('geolocation' in navigator)) {
      setGps({ state: 'error', message: 'This browser cannot share your location. Tap the map to place the pin instead.' });
      return;
    }
    if (!window.isSecureContext) {
      setGps({
        state: 'error',
        message: 'Location access needs a secure (https) connection. Tap the map to place the pin instead.',
      });
      return;
    }
    setGps({ state: 'locating', message: null });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        set(pos.coords.latitude, pos.coords.longitude, 'gps', Math.round(pos.coords.accuracy));
        setGps({ state: 'done', message: null });
      },
      (err) => {
        const message =
          err.code === 1
            ? 'Location permission was denied. You can allow it in your browser settings, or tap the map to place the pin.'
            : err.code === 3
              ? 'Getting your location took too long. Try again outdoors, or tap the map to place the pin.'
              : 'Your location is unavailable right now. Tap the map to place the pin instead.';
        setGps({ state: 'error', message });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    );
  }

  async function runSearch(e) {
    e?.preventDefault();
    if (query.trim().length < 3) {
      setSearch({ loading: false, items: null, error: 'Type at least 3 characters.' });
      return;
    }
    setSearch({ loading: true, items: null, error: null });
    try {
      const { items } = await api.get(`/api/geo/search${qs({ q: query.trim() })}`);
      setSearch({ loading: false, items, error: items.length ? null : 'No matching places. Try a nearby landmark or pin the map.' });
    } catch (err) {
      setSearch({ loading: false, items: null, error: err.message });
    }
  }

  function chooseResult(r) {
    set(r.latitude, r.longitude, 'address');
    onAddress?.({ road_name: r.road_name, barangay: r.barangay, city: r.city });
    setSearch({ loading: false, items: null, error: null });
  }

  function applyManual(e) {
    e?.preventDefault();
    const lat = Number(manualText.lat);
    const lng = Number(manualText.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      setGps({ state: 'error', message: 'Enter a latitude between -90 and 90 and a longitude between -180 and 180.' });
      return;
    }
    setGps({ state: 'idle', message: null });
    set(lat, lng, 'map');
  }

  // When the point changes: suggest road details and show nearby reports.
  useEffect(() => {
    if (!value) return undefined;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api
        .get(`/api/reports/nearby${qs({ lat: value.lat.toFixed(6), lng: value.lng.toFixed(6) })}`, { signal: ctrl.signal })
        .then(setNearby)
        .catch(() => setNearby(null));
      if (config?.geocoder_enabled && value.source !== 'address') {
        api
          .get(`/api/geo/reverse${qs({ lat: value.lat.toFixed(6), lng: value.lng.toFixed(6) })}`, { signal: ctrl.signal })
          .then(({ result }) => result && onAddress?.(result))
          .catch(() => {});
      }
    }, 500);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.lat, value?.lng]);

  return (
    <div className="locpick">
      <div className="locpick__actions">
        <Button variant="navy" onClick={useGps} loading={gps.state === 'locating'}>
          <LuLocateFixed aria-hidden /> {gps.state === 'locating' ? 'Finding you…' : 'Use my current location'}
        </Button>
        {config?.geocoder_enabled && (
          // Not a <form>: this picker sits inside the report form, and forms cannot be nested.
          <div className="locpick__search" role="search">
            <label className="visually-hidden" htmlFor="addr-search">
              Search for an address or landmark
            </label>
            <input
              id="addr-search"
              className="input"
              placeholder="Search address or landmark"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch(e)}
              autoComplete="off"
              enterKeyHint="search"
            />
            <Button variant="secondary" onClick={runSearch} loading={search.loading} aria-label="Search address">
              <LuSearch aria-hidden />
            </Button>
          </div>
        )}
      </div>
      <p className="field__hint">
        Your browser will ask before sharing your location. Wayguard saves only the pothole&apos;s position. You can also tap the
        map, or drag the pin to the exact spot.
      </p>

      {gps.message && (
        <Alert type="warn" className="locpick__msg">
          {gps.message}
        </Alert>
      )}
      {search.error && <p className="field__error">{search.error}</p>}
      {search.items?.length > 0 && (
        <ul className="locpick__results" aria-label="Address search results">
          {search.items.map((r, i) => (
            <li key={i}>
              <button type="button" onClick={() => chooseResult(r)}>
                <LuMapPin aria-hidden /> <span>{r.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <MapView
        height={340}
        pick={value ? { lat: value.lat, lng: value.lng } : null}
        accuracy={value?.source === 'gps' ? value.accuracy : null}
        onMapClick={(p) => set(p.lat, p.lng, 'map')}
        onPickMove={(p) => set(p.lat, p.lng, 'map')}
        label="Map for choosing the pothole location. Click to place the pin."
      />

      <div className="locpick__status" aria-live="polite">
        {value ? (
          <>
            <LuMapPin aria-hidden />
            <span>
              <strong>{formatCoords(value.lat, value.lng)}</strong> {SOURCE_TEXT[value.source]}
              {value.source === 'gps' && value.accuracy ? `, accurate to about ${value.accuracy} m` : ''}
            </span>
          </>
        ) : (
          <span className="muted">No location set yet.</span>
        )}
        <button type="button" className="linkish" onClick={() => setManual((m) => !m)}>
          <LuKeyboard aria-hidden /> {manual ? 'Hide coordinates' : 'Type coordinates'}
        </button>
      </div>
      {manual && (
        <div className="locpick__manual" onKeyDown={(e) => e.key === 'Enter' && applyManual(e)}>
          <input
            className="input"
            inputMode="decimal"
            aria-label="Latitude"
            placeholder="Latitude, e.g. 14.8433"
            value={manualText.lat}
            onChange={(e) => setManualText((m) => ({ ...m, lat: e.target.value }))}
          />
          <input
            className="input"
            inputMode="decimal"
            aria-label="Longitude"
            placeholder="Longitude, e.g. 120.8114"
            value={manualText.lng}
            onChange={(e) => setManualText((m) => ({ ...m, lng: e.target.value }))}
          />
          <Button variant="secondary" onClick={applyManual}>
            Set location
          </Button>
        </div>
      )}
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}

      {nearby?.items?.length > 0 && (
        <div className="alert alert--warn locpick__nearby">
          <LuTriangleAlert aria-hidden />
          <div>
            <strong>
              {nearby.items.length === 1 ? 'A pothole was already reported' : `${nearby.items.length} potholes were already reported`}{' '}
              within {nearby.radius_m} m
            </strong>
            <p>If it is the same pothole, the LGU is already tracking it — tap <strong>I saw this too</strong> instead of sending a new report. You can still submit if this is a different one.</p>
            <ul>
              {nearby.items.slice(0, 4).map((n) => (
                <li key={n.code}>
                  <span className="numeral">{n.code}</span>, {formatDistance(n.distance_m)} away on {n.road_name}
                  {n.landmark ? ` (${n.landmark})` : ''}, reported {timeAgo(n.created_at)} <StatusBadge status={n.status} />
                  {n.id && <div className="locpick__confirm"><ConfirmButton report={n} /></div>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
