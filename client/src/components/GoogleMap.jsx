// Google Maps version of the map (Maps JavaScript API with Advanced Markers).
// Takes the same props as the Leaflet map in MapView.jsx: report markers,
// a draggable "pick" pin for choosing a location, a GPS accuracy circle,
// map clicks, fit-to-markers and a selected marker.
import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '../lib/googleMaps.js';
import { SEVERITY, STATUS } from '../lib/format.js';
import { pinMarkup, PICK_HTML, ME_HTML } from './mapPins.js';

const MAX_FIT_ZOOM = 16;

function el(className, html) {
  const div = document.createElement('div');
  div.className = className;
  div.innerHTML = html;
  return div;
}

const latLng = (p) => ({
  lat: typeof p.lat === 'function' ? p.lat() : p.lat,
  lng: typeof p.lng === 'function' ? p.lng() : p.lng,
});

export default function GoogleMap({
  settings,
  markers = [],
  center,
  zoom,
  selectedId = null,
  onMarkerClick,
  onMapClick,
  fitToMarkers = false,
  pick = null,
  onPickMove,
  accuracy = null,
  height = 420,
  label = 'Map of reported potholes',
  className = '',
  mapApi,
  onViewChange,
  controls = true,
  onUserMove,
  theme = 'night',
}) {
  const box = useRef(null);
  const map = useRef(null);
  const gm = useRef(null);
  const reportMarkers = useRef([]);
  const pickMarker = useRef(null);
  const circle = useRef(null);
  const meMarker = useRef(null);
  const fitRef = useRef(false);
  fitRef.current = fitToMarkers;
  const handlers = useRef({});
  const [ready, setReady] = useState(false);
  handlers.current = { onMarkerClick, onMapClick, onPickMove, onViewChange, onUserMove };

  // Load the API and create the map once.
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps(settings.google_api_key)
      .then((maps) => {
        if (cancelled || !box.current || map.current) return;
        gm.current = maps;
        const c = center || settings.center || { lat: 14.8433, lng: 120.8114 };
        const m = new maps.Map(box.current, {
          center: { lat: c.lat, lng: c.lng },
          zoom: zoom || c.zoom || 14,
          mapId: settings.google_map_id || 'DEMO_MAP_ID',
          clickableIcons: false,
          streetViewControl: false,
          mapTypeControl: true,
          // Google's own dark scheme for night (works with Map IDs).
          colorScheme: theme === 'night' ? 'DARK' : 'LIGHT',
          gestureHandling: controls ? 'cooperative' : 'greedy',
          zoomControl: controls,
          fullscreenControl: controls,
        });
        m.addListener('click', (e) => {
          if (e.latLng) handlers.current.onMapClick?.(latLng(e.latLng));
        });
        m.addListener('dragstart', () => handlers.current.onUserMove?.());
        m.addListener('idle', () => {
          const cc = m.getCenter();
          if (cc) handlers.current.onViewChange?.({ lat: cc.lat(), lng: cc.lng(), zoom: m.getZoom(), pitch: 0, bearing: 0 });
        });
        map.current = m;
        setReady(true);
      })
      .catch(() => {
        // MapView switches to OpenStreetMap through useGoogleMapsFailed().
      });
    return () => {
      cancelled = true;
      for (const mk of reportMarkers.current) mk.map = null;
      reportMarkers.current = [];
      if (pickMarker.current) pickMarker.current.map = null;
      pickMarker.current = null;
      circle.current?.setMap(null);
      circle.current = null;
      if (map.current && gm.current) gm.current.event.clearInstanceListeners(map.current);
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Imperative handle for the full-screen map screen.
  useEffect(() => {
    if (!mapApi) return undefined;
    mapApi.current = {
      engine: 'google',
      supports3d: false,
      flyTo(lat, lng, z) {
        const m = map.current;
        if (!m) return;
        m.panTo({ lat, lng });
        m.setZoom(z ?? Math.max(m.getZoom() || 0, 16));
      },
      getCenter() {
        const c = map.current?.getCenter();
        return c ? { lat: c.lat(), lng: c.lng() } : null;
      },
      setUserLocation(pos) {
        const m = map.current;
        const maps = gm.current;
        if (!m || !maps) return;
        if (!pos) {
          if (meMarker.current) meMarker.current.map = null;
          meMarker.current = null;
          return;
        }
        if (!meMarker.current) {
          const node = document.createElement('div');
          node.className = 'wg-me wg-me--google';
          node.innerHTML = ME_HTML;
          meMarker.current = new maps.marker.AdvancedMarkerElement({ map: m, position: { lat: pos.lat, lng: pos.lng }, content: node, zIndex: 1500 });
        } else meMarker.current.position = { lat: pos.lat, lng: pos.lng };
        const node = meMarker.current.content;
        node.classList.toggle('wg-me--drive', Boolean(pos.drive));
        node.style.setProperty('--heading', `${pos.drive && Number.isFinite(pos.heading) ? pos.heading : 0}deg`);
      },
      follow(pos) {
        const m = map.current;
        if (!m) return;
        m.panTo({ lat: pos.lat, lng: pos.lng });
        if ((m.getZoom() || 0) < 17) m.setZoom(17);
      },
      endDrive() {},
      set3d() {},
      resetNorth() {},
      zoomBy(d) {
        const m = map.current;
        m?.setZoom((m.getZoom() || 14) + d);
      },
    };
    return () => {
      mapApi.current = null;
    };
  }, [mapApi]);

  // Report markers
  useEffect(() => {
    const m = map.current;
    const maps = gm.current;
    if (!ready || !m || !maps) return;
    for (const mk of reportMarkers.current) mk.map = null;
    reportMarkers.current = [];
    const bounds = new maps.LatLngBounds();
    let count = 0;
    for (const r of markers) {
      if (!Number.isFinite(r.latitude) || !Number.isFinite(r.longitude)) continue;
      const { className: cls, html } = pinMarkup({
        kind: r.kind,
        count: r.count,
        label: r.label,
        severity: r.severity,
        status: r.status,
        awaiting: r.status === 'in_progress' && Boolean(r.work_completed_at),
        selected: r.id === selectedId,
      });
      const clickable = Boolean(handlers.current.onMarkerClick) && r.kind !== 'heat';
      // Advanced markers sit on their bottom edge; centre the round kinds.
      const content = el(r.kind ? `${cls} wg-centred` : cls, html);
      const marker = new maps.marker.AdvancedMarkerElement({
        map: m,
        position: { lat: r.latitude, lng: r.longitude },
        content,
        title: r.kind === 'area'
          ? `${r.label}: ${r.count} open reports`
          : r.kind === 'heat'
            ? ''
            : clickable
              ? `${r.code}: ${SEVERITY[r.severity]?.label} severity, ${STATUS[r.status]?.label}`
              : `${r.code}, ${r.road_name || ''}`,
        zIndex: r.id === selectedId ? 1000 : undefined,
        gmpClickable: clickable,
      });
      if (clickable) marker.addListener('click', () => handlers.current.onMarkerClick?.(r));
      reportMarkers.current.push(marker);
      bounds.extend({ lat: r.latitude, lng: r.longitude });
      count += 1;
    }
    if (fitRef.current && count) {
      m.fitBounds(bounds, 40);
      maps.event.addListenerOnce(m, 'idle', () => {
        if (m.getZoom() > MAX_FIT_ZOOM) m.setZoom(MAX_FIT_ZOOM);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, markers, selectedId]);

  // Location being picked (draggable)
  useEffect(() => {
    const m = map.current;
    const maps = gm.current;
    if (!ready || !m || !maps) return;
    if (!pick) {
      if (pickMarker.current) pickMarker.current.map = null;
      pickMarker.current = null;
      return;
    }
    const pos = { lat: pick.lat, lng: pick.lng };
    if (!pickMarker.current) {
      const marker = new maps.marker.AdvancedMarkerElement({
        map: m,
        position: pos,
        content: el('wg-pick wg-gpick', PICK_HTML),
        title: 'Pothole location. Drag to adjust.',
        gmpDraggable: true,
        zIndex: 2000,
      });
      marker.addListener('dragend', (e) => {
        const p = e?.latLng ? latLng(e.latLng) : latLng(marker.position);
        handlers.current.onPickMove?.(p);
      });
      pickMarker.current = marker;
    } else {
      pickMarker.current.position = pos;
    }
    const b = m.getBounds();
    if (!b || !b.contains(pos)) {
      m.setCenter(pos);
      if ((m.getZoom() || 0) < 17) m.setZoom(17);
    }
  }, [ready, pick]);

  // GPS accuracy ring
  useEffect(() => {
    const m = map.current;
    const maps = gm.current;
    if (!ready || !m || !maps) return;
    circle.current?.setMap(null);
    circle.current = null;
    if (pick && accuracy && accuracy < 2000) {
      circle.current = new maps.Circle({
        map: m,
        center: { lat: pick.lat, lng: pick.lng },
        radius: accuracy,
        strokeColor: '#2B4F8A',
        strokeWeight: 1.5,
        fillColor: '#6D8BBE',
        fillOpacity: 0.12,
        clickable: false,
      });
    }
  }, [ready, pick, accuracy]);

  // Re-centre when the requested centre changes.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !center || pick) return;
    m.setCenter({ lat: center.lat, lng: center.lng });
    if (zoom) m.setZoom(zoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, center?.lat, center?.lng]);

  return (
    <div className={`map-frame map-frame--google ${className}`} style={{ height }}>
      <div ref={box} className="map" role="region" aria-label={label} />
      {!ready && (
        <div className="map-loading" aria-hidden>
          Loading Google Maps…
        </div>
      )}
    </div>
  );
}
