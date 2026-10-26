// Full-screen, map-first screen in the style of driving apps such as Waze:
// the map fills the screen; a floating search bar and filter chips sit on
// top; round buttons locate you, tilt the map to 3D and zoom; a big Report
// button drops a report at your position (or the map centre) with a quick
// severity choice; and a bottom sheet slides up with report details or the
// full list (the accessible text alternative to the map).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  LuSearch,
  LuX,
  LuLocateFixed,
  LuPlus,
  LuMinus,
  LuList,
  LuChevronUp,
  LuChevronDown,
  LuMapPin,
  LuNavigation,
  LuCrosshair,
  LuArrowRight,
  LuSun,
  LuMoon,
  LuCar,
  LuTriangleAlert,
  LuVolume2,
  LuVolumeX,
} from 'react-icons/lu';
import { voiceSupported, voicePreference, setVoicePreference, speak, alertText, ANNOUNCE_AT } from '../lib/voice.js';
import { setMapTheme, useMapTheme } from '../lib/mapTheme.js';
import MapView, { MapLegend } from './MapView.jsx';
import { StatusBadge, SeverityBadge, DemoTag } from './ui.jsx';
import { api, qs } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Link } from '../lib/router.jsx';
import { useToast } from '../lib/toast.jsx';
import { useDebounced } from '../lib/hooks.js';
import { STATUS, formatDate, formatDistance, timeAgo, isAwaitingVerification } from '../lib/format.js';
import { pinMarkup } from './mapPins.js';
import ConfirmButton from './ConfirmButton.jsx';

function distanceM(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Compass bearing from a to b, degrees clockwise from north.
function bearing(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
const angleGap = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const OPEN_STATUSES = ['submitted', 'under_review', 'verified', 'assigned', 'in_progress'];
const AHEAD_M = 500; // warn about potholes this far ahead
const AHEAD_CONE = 40; // degrees either side of the heading

function Bubble({ r }) {
  const { className, html } = pinMarkup({ severity: r.severity, status: r.status, awaiting: isAwaitingVerification(r) });
  // Static, trusted SVG markup from mapPins.js.
  // eslint-disable-next-line react/no-danger
  return <span className={`${className} wg-bubble--legend`} aria-hidden dangerouslySetInnerHTML={{ __html: html }} />;
}

const SEVERITY_CHOICES = [
  { value: 'low', title: 'Low', text: 'Small or shallow. Drivers can pass carefully.' },
  { value: 'medium', title: 'Medium', text: 'Noticeable. Vehicles slow down or swerve.' },
  { value: 'high', title: 'High', text: 'Deep or wide. Dangerous, especially for motorcycles.' },
];

export default function MapScreen({
  title,
  markers = [],
  loading = false,
  filters = null,
  mode = 'public', // public | citizen | crew
  detailActions,
  intro,
}) {
  const { user, config } = useAuth();
  const toast = useToast();
  const mapApi = useRef(null);
  const screen = useRef(null);
  const sheet = useRef(null);
  const [height, setHeight] = useState(560);
  const [sheetH, setSheetH] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [me, setMe] = useState(null);
  const [locating, setLocating] = useState(false);
  const [is3d, setIs3d] = useState(false);
  const [engine, setEngine] = useState(null);
  const [query, setQuery] = useState('');
  const [searchFocus, setSearchFocus] = useState(false);
  const [places, setPlaces] = useState({ loading: false, items: [] });
  const [reporting, setReporting] = useState(false);
  const [reportSource, setReportSource] = useState('center');
  const [userMoved, setUserMoved] = useState(false);
  const theme = useMapTheme();
  // Drive mode (like a driving app): follow your position heading-up.
  const [drive, setDrive] = useState(false);
  const [following, setFollowing] = useState(true);
  const [speed, setSpeed] = useState(null);
  const [ahead, setAhead] = useState(null);
  const [voiceOn, setVoiceOn] = useState(() => voiceSupported() && voicePreference());
  const spoken = useRef(new Map());
  const watchId = useRef(null);
  const last = useRef(null);
  const live = useRef({});
  live.current = { ...live.current, following, markers, drive };
  const debounced = useDebounced(query, 400);
  const selected = markers.find((r) => r.id === selectedId) || null;
  const canReport = mode !== 'crew';

  // Fill the viewport below the header (and above the phone tab bar).
  useLayoutEffect(() => {
    function measure() {
      if (!screen.current) return;
      const top = screen.current.getBoundingClientRect().top + window.scrollY;
      const tabbar = document.querySelector('.tabbar');
      const tb = tabbar && getComputedStyle(tabbar).display !== 'none' ? tabbar.getBoundingClientRect().height : 0;
      setHeight(Math.max(380, window.innerHeight - top - tb));
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => {
    if (!sheet.current) return undefined;
    const ro = new ResizeObserver(() => setSheetH(sheet.current?.getBoundingClientRect().height || 0));
    ro.observe(sheet.current);
    return () => ro.disconnect();
  }, []);

  // Keep every report in view until the person moves the map themselves.
  const touched = () => setUserMoved(true);

  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return;
      if (reporting) setReporting(false);
      else if (selectedId != null) setSelectedId(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reporting, selectedId]);

  // Search: reports on the map, plus places when signed in.
  const reportHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return markers
      .filter((r) => [r.code, r.road_name, r.barangay, r.landmark].some((v) => (v || '').toLowerCase().includes(q)))
      .slice(0, 5);
  }, [query, markers]);
  useEffect(() => {
    const q = debounced.trim();
    if (!user || !config?.geocoder_enabled || q.length < 3) {
      setPlaces({ loading: false, items: [] });
      return undefined;
    }
    const ctrl = new AbortController();
    setPlaces((p) => ({ ...p, loading: true }));
    api
      .get(`/api/geo/search${qs({ q })}`, { signal: ctrl.signal })
      .then(({ items }) => setPlaces({ loading: false, items: items.slice(0, 5) }))
      .catch(() => setPlaces({ loading: false, items: [] }));
    return () => ctrl.abort();
  }, [debounced, user, config?.geocoder_enabled]);

  // ---- drive mode
  function onDrivePosition(pos) {
    const now = pos.timestamp || Date.now();
    const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy || 0) };
    const prev = last.current;
    const moved = prev ? distanceM(prev, p) : 0;
    let heading = prev?.heading ?? null;
    if (Number.isFinite(pos.coords.heading) && (pos.coords.speed ?? 1) > 0.5) heading = pos.coords.heading;
    else if (prev && moved > 4) heading = bearing(prev, p);
    let kmh = Number.isFinite(pos.coords.speed) && pos.coords.speed !== null ? pos.coords.speed * 3.6 : null;
    if (kmh === null && prev && now > prev.t) kmh = (moved / ((now - prev.t) / 1000)) * 3.6;
    last.current = { ...p, heading, t: now };
    setMe(p);
    setSpeed(kmh === null ? null : Math.max(0, Math.round(kmh)));
    mapApi.current?.setUserLocation({ ...p, heading, drive: true });
    if (live.current.following) mapApi.current?.follow({ ...p, heading });
    // Nearest open pothole in front of you, like a driving app's hazard alert.
    let best = null;
    for (const r of live.current.markers) {
      if (!OPEN_STATUSES.includes(r.status)) continue;
      const target = { lat: r.latitude, lng: r.longitude };
      const d = distanceM(p, target);
      if (d > AHEAD_M) continue;
      if (heading !== null && d > 25 && angleGap(bearing(p, target), heading) > AHEAD_CONE) continue;
      if (heading === null && d > 150) continue;
      if (!best || d < best.distance) best = { r, distance: d };
    }
    setAhead(best);
  }

  // Say each approaching pothole out loud at 400, 200 and 80 metres.
  useEffect(() => {
    if (!drive || !ahead || !voiceOn) return;
    const id = ahead.r.id;
    const done = spoken.current.get(id) || new Set();
    const due = ANNOUNCE_AT.filter((m) => ahead.distance <= m && !done.has(m));
    if (!due.length) return;
    due.forEach((m) => done.add(m));
    spoken.current.set(id, done);
    const lang = document.documentElement.lang === 'fil' ? 'fil' : 'en';
    speak(alertText({ distance: ahead.distance, severity: ahead.r.severity, road: ahead.r.road_name }, lang), lang === 'fil' ? 'fil-PH' : 'en-PH');
  }, [drive, ahead, voiceOn]);

  function toggleVoice() {
    const next = !voiceOn;
    setVoiceOn(next);
    setVoicePreference(next);
    if (next) speak(document.documentElement.lang === 'fil' ? 'Naka-on ang babala sa boses.' : 'Voice alerts on.');
    else window.speechSynthesis?.cancel?.();
  }

  function startDrive() {
    touched();
    if (!('geolocation' in navigator) || !window.isSecureContext) {
      toast('Drive mode needs your location, which is not available on this connection.', { type: 'error' });
      return;
    }
    setSelectedId(null);
    setSheetOpen(false);
    setReporting(false);
    setQuery('');
    setDrive(true);
    setFollowing(true);
    spoken.current = new Map();
    last.current = null;
    live.current.gpsWarned = false;
    watchId.current = navigator.geolocation.watchPosition(
      onDrivePosition,
      (err) => {
        if (err.code === 1) {
          toast('Location permission was denied, so drive mode cannot follow you.', { type: 'error' });
          stopDrive();
          return;
        }
        // Short GPS gaps (tunnels, tall buildings) are normal: keep driving.
        if (!live.current.gpsWarned) {
          live.current.gpsWarned = true;
          toast('GPS signal is weak. Drive mode will continue when it returns.', { type: 'error' });
        }
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
    );
  }

  function stopDrive() {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    setDrive(false);
    setSpeed(null);
    setAhead(null);
    mapApi.current?.endDrive?.();
    if (last.current) mapApi.current?.setUserLocation({ ...last.current, drive: false });
  }

  function recenter() {
    setFollowing(true);
    if (last.current) mapApi.current?.follow(last.current);
  }

  useEffect(
    () => () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    },
    [],
  );

  // Closing the details returns to the list only if it was opened from it.
  function selectReport(r, fromList = false) {
    touched();
    setSelectedId(r.id);
    setSheetOpen(fromList);
    setQuery('');
    setSearchFocus(false);
  }

  function goToPlace(p) {
    touched();
    mapApi.current?.flyTo(p.latitude, p.longitude, 17);
    setQuery('');
    setSearchFocus(false);
  }

  function locate(thenReport = false) {
    touched();
    if (!('geolocation' in navigator) || !window.isSecureContext) {
      toast('Your location is not available on this connection. Move the map to the spot instead.', { type: 'error' });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) };
        setMe(p);
        setLocating(false);
        mapApi.current?.setUserLocation(p);
        mapApi.current?.flyTo(p.lat, p.lng, 17);
        if (thenReport) setReportSource('gps');
      },
      (err) => {
        setLocating(false);
        toast(
          err.code === 1
            ? 'Location permission was denied. You can still move the map to the spot.'
            : 'Your location is unavailable right now. Move the map to the spot instead.',
          { type: 'error' },
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    );
  }

  function toggle3d() {
    touched();
    const next = !is3d;
    setIs3d(next);
    mapApi.current?.set3d(next);
  }

  function openReport() {
    setSelectedId(null);
    setReporting(true);
    setReportSource(me ? 'gps' : 'center');
  }

  function reportTarget(severity) {
    const point =
      reportSource === 'gps' && me ? { ...me, src: 'gps' } : { ...(mapApi.current?.getCenter() || config.map_center), src: 'map' };
    const path = `/app/report${qs({
      lat: point.lat.toFixed(7),
      lng: point.lng.toFixed(7),
      src: point.src,
      acc: point.src === 'gps' ? point.accuracy : undefined,
      severity,
    })}`;
    return user?.role === 'citizen' ? path : `/register?next=${encodeURIComponent(path)}`;
  }

  const showResults = searchFocus && query.trim().length >= 2;
  const floatBottom = sheetH + 12;
  const toolsBottom = floatBottom + (canReport ? 108 : 0);
  // Keep the round buttons clear of the search bar when a tall sheet is open.
  const toolsFit = height - toolsBottom > 300;

  return (
    <div className={`mapscreen mapscreen--${mode} mapscreen--${theme} ${drive ? 'mapscreen--drive' : ''}`} ref={screen} style={{ height }}>
      <h1 className="visually-hidden">{title}</h1>
      <div className="mapscreen__canvas" onPointerDown={touched} onWheel={touched}>
      <MapView
        markers={markers}
        selectedId={selectedId}
        onMarkerClick={selectReport}
        onMapClick={() => {
          if (!reporting) setSelectedId(null);
        }}
        fitToMarkers={!userMoved && markers.length > 0}
        height="100%"
        mapApi={mapApi}
        onViewChange={() => setEngine(mapApi.current?.engine || null)}
        onUserMove={() => {
          if (live.current.drive) setFollowing(false);
        }}
        controls={false}
        className="mapscreen__map"
        label={`${title}. Select a report bubble for details, or open the list below.`}
      />
      </div>

      {/* Drive mode: hazard alert and speed, like a driving app */}
      {drive && (
        <div className="drive-top">
          {ahead ? (
            <div className={`drive-alert drive-alert--${ahead.r.severity}`} role="status" aria-live="polite">
              <Bubble r={ahead.r} />
              <div>
                <strong>Pothole ahead</strong>
                <span>
                  {Math.round(ahead.distance / 10) * 10} m · {ahead.r.severity[0].toUpperCase() + ahead.r.severity.slice(1)} severity
                  {ahead.r.road_name ? ` · ${ahead.r.road_name}` : ''}
                </span>
              </div>
              <LuTriangleAlert aria-hidden className="drive-alert__icon" />
            </div>
          ) : (
            <div className="drive-alert drive-alert--clear" role="status" aria-live="polite">
              <LuCar aria-hidden className="drive-alert__car" />
              <div>
                <strong>Drive mode</strong>
                <span>No reported potholes ahead</span>
              </div>
            </div>
          )}
          <div className="speed-bubble" aria-label={speed === null ? 'Speed unknown' : `Speed ${speed} kilometres per hour`}>
            <span className="speed-bubble__value">{speed === null ? '–' : speed}</span>
            <span className="speed-bubble__unit">km/h</span>
          </div>
        </div>
      )}

      {/* Search and filters */}
      <div className="mapscreen__top" hidden={drive}>
        <div className={`mapsearch ${showResults ? 'mapsearch--open' : ''}`}>
          <LuSearch aria-hidden className="mapsearch__icon" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSearchFocus(true)}
            onBlur={() => setTimeout(() => setSearchFocus(false), 150)}
            placeholder={user && config?.geocoder_enabled ? 'Search a place or report' : 'Search reports by road, barangay or code'}
            aria-label="Search"
            autoComplete="off"
          />
          {query && (
            <button type="button" className="mapsearch__clear" onClick={() => setQuery('')} aria-label="Clear search">
              <LuX aria-hidden />
            </button>
          )}
          {showResults && (
            <div className="mapsearch__results" role="listbox" aria-label="Search results">
              {reportHits.map((r) => (
                <button key={`r${r.id}`} type="button" role="option" aria-selected="false" onMouseDown={(e) => e.preventDefault()} onClick={() => selectReport(r)}>
                  <Bubble r={r} />
                  <span>
                    <strong className="numeral">{r.code}</strong>
                    <span className="muted small">
                      {r.road_name}
                      {r.barangay ? `, ${r.barangay}` : ''}
                    </span>
                  </span>
                </button>
              ))}
              {places.items.map((p) => (
                <button key={`p${p.latitude},${p.longitude}`} type="button" role="option" aria-selected="false" onMouseDown={(e) => e.preventDefault()} onClick={() => goToPlace(p)}>
                  <span className="mapsearch__place" aria-hidden>
                    <LuMapPin />
                  </span>
                  <span className="small">{p.label}</span>
                </button>
              ))}
              {places.loading && <p className="mapsearch__note">Searching places…</p>}
              {!places.loading && !reportHits.length && !places.items.length && (
                <p className="mapsearch__note">No matches{user ? '' : ' among reports. Sign in to search places'}.</p>
              )}
            </div>
          )}
        </div>
        {filters && <div className="mapscreen__filters">{filters}</div>}
      </div>

      {/* Round map buttons */}
      <div className="mapscreen__tools" style={{ bottom: toolsBottom }} hidden={!toolsFit}>
        <button
          type="button"
          className="maptool"
          onClick={() => setMapTheme(theme === 'night' ? 'day' : 'night')}
          aria-label={theme === 'night' ? 'Switch to day map' : 'Switch to night map'}
          title={theme === 'night' ? 'Day map' : 'Night map'}
        >
          {theme === 'night' ? <LuSun aria-hidden /> : <LuMoon aria-hidden />}
        </button>
        {drive ? (
          !following && (
            <button type="button" className="maptool maptool--accent" onClick={recenter} aria-label="Recenter on my position" title="Recenter">
              <LuNavigation aria-hidden />
            </button>
          )
        ) : (
          <>
            <button type="button" className="maptool" onClick={startDrive} aria-label="Start drive mode" title="Drive mode">
              <LuCar aria-hidden />
            </button>
            <button type="button" className="maptool" onClick={() => locate(false)} aria-label="Show my location" title="Show my location" disabled={locating}>
              <LuLocateFixed aria-hidden className={locating ? 'spin-slow' : ''} />
            </button>
          </>
        )}
        {engine === 'vector' && !drive && (
          <button type="button" className="maptool maptool--text" onClick={toggle3d} aria-pressed={is3d} title={is3d ? 'Flat map' : 'Tilt to 3D'}>
            {is3d ? '2D' : '3D'}
          </button>
        )}
        <div className="maptool-pair">
          <button type="button" className="maptool" onClick={() => {
            touched();
            mapApi.current?.zoomBy(1);
          }} aria-label="Zoom in">
            <LuPlus aria-hidden />
          </button>
          <button type="button" className="maptool" onClick={() => {
            touched();
            mapApi.current?.zoomBy(-1);
          }} aria-label="Zoom out">
            <LuMinus aria-hidden />
          </button>
        </div>
      </div>

      {canReport && !reporting && (
        <button type="button" className="report-fab" style={{ bottom: floatBottom }} onClick={openReport}>
          <span className="report-fab__icon" aria-hidden>
            <LuPlus />
          </span>
          <span className="report-fab__label">Report</span>
        </button>
      )}

      {reporting && reportSource === 'center' && (
        <div className="map-crosshair" aria-hidden>
          <LuCrosshair />
        </div>
      )}

      {/* Bottom sheet */}
      <section
        ref={sheet}
        className={`mapsheet ${sheetOpen || selected || reporting ? 'mapsheet--open' : ''}`}
        aria-label={reporting ? 'Report a pothole' : selected ? `Report ${selected.code}` : 'Reports on the map'}
      >
        {drive && !reporting ? (
          <div className="mapsheet__body mapsheet__drive">
            <LuCar aria-hidden />
            <div>
              <strong>Drive mode</strong>
              <span className="small muted">
                {(() => {
                  const near = me
                    ? markers.filter((r) => OPEN_STATUSES.includes(r.status) && distanceM(me, { lat: r.latitude, lng: r.longitude }) < 1000).length
                    : 0;
                  return `${near} open report${near === 1 ? '' : 's'} within 1 km`;
                })()}
              </span>
            </div>
            {voiceSupported() && (
              <button
                type="button"
                className={`btn btn--sm ${voiceOn ? 'btn--navy' : 'btn--secondary'}`}
                aria-pressed={voiceOn}
                onClick={toggleVoice}
                aria-label={voiceOn ? 'Turn voice alerts off' : 'Turn voice alerts on'}
              >
                {voiceOn ? <LuVolume2 aria-hidden /> : <LuVolumeX aria-hidden />} Voice
              </button>
            )}
            <button type="button" className="btn btn--secondary btn--sm" onClick={stopDrive}>
              <LuX aria-hidden /> Stop
            </button>
          </div>
        ) : reporting ? (
          <div className="mapsheet__body">
            <div className="mapsheet__head">
              <h2>Report a pothole here</h2>
              <button type="button" className="icon-btn" onClick={() => setReporting(false)} aria-label="Cancel report">
                <LuX aria-hidden />
              </button>
            </div>
            <div className="report-where" role="radiogroup" aria-label="Where is the pothole?">
              <button
                type="button"
                role="radio"
                aria-checked={reportSource === 'gps'}
                className="report-where__opt"
                onClick={() => (me ? setReportSource('gps') : locate(true))}
              >
                <LuLocateFixed aria-hidden />
                <span>
                  <strong>Where I am</strong>
                  <span className="small muted">{me ? `GPS, about ${me.accuracy} m` : locating ? 'Finding you…' : 'Use GPS'}</span>
                </span>
              </button>
              <button type="button" role="radio" aria-checked={reportSource === 'center'} className="report-where__opt" onClick={() => setReportSource('center')}>
                <LuCrosshair aria-hidden />
                <span>
                  <strong>Map centre</strong>
                  <span className="small muted">Move the map under the target</span>
                </span>
              </button>
            </div>
            <p className="report-ask">How bad is it?</p>
            <div className="report-severity">
              {SEVERITY_CHOICES.map((s) => (
                <Link key={s.value} to={reportTarget(s.value)} className={`report-sev report-sev--${s.value}`}>
                  <Bubble r={{ severity: s.value, status: 'verified' }} />
                  <span>
                    <strong>{s.title}</strong>
                    <span className="small">{s.text}</span>
                  </span>
                  <LuArrowRight aria-hidden className="report-sev__go" />
                </Link>
              ))}
            </div>
            <p className="small muted">
              {user?.role === 'citizen'
                ? 'Next you add a photo and a short description.'
                : 'You will be asked to sign in or create a free citizen account first.'}
            </p>
          </div>
        ) : selected ? (
          <div className="mapsheet__body">
            <div className="mapsheet__head">
              <div className="mapsheet__title">
                <Bubble r={selected} />
                <div>
                  <h2 className="numeral">{selected.code}</h2>
                  <p className="mapsheet__road">
                    {selected.road_name}
                    {selected.barangay ? `, ${selected.barangay}` : ''}
                  </p>
                </div>
              </div>
              <button type="button" className="icon-btn" onClick={() => setSelectedId(null)} aria-label="Close details">
                <LuX aria-hidden />
              </button>
            </div>
            <div className="cluster">
              <StatusBadge status={selected.status} awaiting={isAwaitingVerification(selected)} />
              <SeverityBadge severity={selected.severity} />
              {selected.is_demo && <DemoTag />}
              {me && (
                <span className="small muted">
                  <LuNavigation aria-hidden /> {formatDistance(distanceM(me, { lat: selected.latitude, lng: selected.longitude }))} away
                </span>
              )}
            </div>
            {selected.landmark && <p className="small muted">Landmark: {selected.landmark}</p>}
            {selected.description && <p className="mapsheet__desc">{selected.description}</p>}
            <p className="small muted">
              Reported {formatDate(selected.created_at)}.{' '}
              {selected.status === 'resolved'
                ? `Repaired ${formatDate(selected.resolved_at)}.`
                : `${STATUS[selected.status]?.help || ''} Last update ${timeAgo(selected.updated_at || selected.created_at)}.`}
            </p>
            <div className="cluster">
              <ConfirmButton key={selected.id} report={selected} />
              {detailActions && detailActions(selected)}
            </div>
          </div>
        ) : (
          <div className="mapsheet__body">
            <button type="button" className="mapsheet__toggle" onClick={() => setSheetOpen((o) => !o)} aria-expanded={sheetOpen}>
              <span className="mapsheet__grip" aria-hidden />
              <span className="mapsheet__summary">
                <LuList aria-hidden />
                {loading ? 'Loading reports…' : `${markers.length} report${markers.length === 1 ? '' : 's'} on the map`}
              </span>
              {sheetOpen ? <LuChevronDown aria-hidden /> : <LuChevronUp aria-hidden />}
            </button>
            {sheetOpen && (
              <div className="mapsheet__list">
                {intro && <p className="small muted">{intro}</p>}
                {markers.length ? (
                  <ul className="map-list">
                    {[...markers]
                      .sort((a, b) =>
                        me
                          ? distanceM(me, { lat: a.latitude, lng: a.longitude }) - distanceM(me, { lat: b.latitude, lng: b.longitude })
                          : 0,
                      )
                      .slice(0, 60)
                      .map((r) => (
                        <li key={r.id}>
                          <button type="button" onClick={() => selectReport(r, true)}>
                            <span className="map-list__lead">
                              <Bubble r={r} />
                              <span>
                                <strong className="numeral">{r.code}</strong>
                                <span className="map-list__road">
                                  {r.road_name}
                                  {r.barangay ? `, ${r.barangay}` : ''}
                                </span>
                              </span>
                            </span>
                            <span className="map-list__meta">
                              {me && (
                                <span className="small muted">{formatDistance(distanceM(me, { lat: r.latitude, lng: r.longitude }))}</span>
                              )}
                              <StatusBadge status={r.status} awaiting={isAwaitingVerification(r)} />
                            </span>
                          </button>
                        </li>
                      ))}
                  </ul>
                ) : (
                  !loading && <p className="muted">Nothing matches these filters yet.</p>
                )}
                <MapLegend />
              </div>
            )}
          </div>
        )}
      </section>

    </div>
  );
}
