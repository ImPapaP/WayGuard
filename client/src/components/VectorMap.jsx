// Waze-style vector road map (MapLibre GL JS + OpenMapTiles vector tiles,
// OpenFreeMap by default; no API key). Same props as the other map engines,
// plus an imperative `mapApi` handle used by the full-screen map screen
// (fly to a place, read the centre, show "you are here", tilt to 3D).
// Loaded on demand so pages without a map stay light.
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl/dist/maplibre-gl-csp.js';
import { SEVERITY, STATUS } from '../lib/format.js';
import { markMapFailed } from '../lib/mapStatus.js';
import { buildRoadStyle, shieldImage } from './roadStyle.js';
import { pinMarkup, PICK_HTML, ME_HTML } from './mapPins.js';

// The CSP-friendly build loads its worker from our own origin.
maplibregl.setWorkerUrl('/vendor/maplibre-gl-csp-worker.js');

const MAX_FIT_ZOOM = 16;
const LOAD_TIMEOUT_MS = 15_000;

function circlePolygon(lat, lng, radiusM, steps = 64) {
  const coords = [];
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i += 1) {
    const a = (i / steps) * 2 * Math.PI;
    coords.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} };
}

function el(className, html) {
  const div = document.createElement('div');
  div.className = className;
  div.innerHTML = html;
  return div;
}

export default function VectorMap({
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
  onUserMove,
  controls = true,
  theme = 'night',
}) {
  const box = useRef(null);
  const map = useRef(null);
  const reportMarkers = useRef([]);
  const pickMarker = useRef(null);
  const meMarker = useRef(null);
  const handlers = useRef({});
  const lastMarkerClick = useRef(0);
  // While `fitToMarkers` is on, keep all reports in view, also on resize.
  const fit = useRef({ on: false, bounds: null });
  fit.current.on = fitToMarkers;
  const [ready, setReady] = useState(false);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  handlers.current = { onMarkerClick, onMapClick, onPickMove, onViewChange, onUserMove };

  // Create the map once.
  useEffect(() => {
    if (!box.current) return undefined;
    const c = center || settings.center || { lat: 14.8433, lng: 120.8114 };
    let m;
    try {
      m = new maplibregl.Map({
        container: box.current,
        style: buildRoadStyle(settings.vector, theme),
        center: [c.lng, c.lat],
        zoom: zoom || c.zoom || 14,
        attributionControl: { compact: true },
        dragRotate: true,
        pitchWithRotate: true,
        maxPitch: 60,
        cooperativeGestures: false,
      });
    } catch (err) {
      markMapFailed('vector', err.message || 'WebGL is not available');
      return undefined;
    }
    let loaded = false;
    const timer = setTimeout(() => {
      if (!loaded) markMapFailed('vector', 'timed out');
    }, LOAD_TIMEOUT_MS);
    m.on('error', (e) => {
      // An error before the map first loaded (style, tile service, fonts)
      // means it cannot be shown here; later single-tile errors are ignored.
      const message = e.error?.message || 'unknown map error';
      // A tile service without one of the optional layers is not fatal.
      if (!loaded && !/does not exist on source/i.test(message)) markMapFailed('vector', message);
      else console.warn(`[maps] ${message}`);
    });
    // Route-number shields are drawn at runtime instead of loading a sprite.
    m.on('styleimagemissing', (e) => {
      if (e.id !== 'wg-shield' || m.hasImage('wg-shield')) return;
      const { image, options } = shieldImage(themeRef.current);
      m.addImage('wg-shield', image, options);
    });
    // The person dragging or rotating the map (not our own animations).
    m.on('dragstart', (e) => {
      if (e.originalEvent) handlers.current.onUserMove?.();
    });
    m.on('rotatestart', (e) => {
      if (e.originalEvent) handlers.current.onUserMove?.();
    });
    m.on('load', () => {
      loaded = true;
      clearTimeout(timer);
      setReady(true);
    });
    if (controls) m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    m.on('click', (e) => {
      if (Date.now() - lastMarkerClick.current < 300) return;
      handlers.current.onMapClick?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });
    m.on('moveend', () => {
      const cc = m.getCenter();
      handlers.current.onViewChange?.({ lat: cc.lat, lng: cc.lng, zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing() });
    });
    map.current = m;
    const ro = new ResizeObserver(() => {
      m.resize();
      const c = m.getContainer();
      if (fit.current.on && fit.current.bounds && c.clientWidth > 0 && c.clientHeight > 0) {
        m.fitBounds(fit.current.bounds, { padding: 60, maxZoom: MAX_FIT_ZOOM, duration: 0 });
      }
    });
    ro.observe(box.current);
    return () => {
      clearTimeout(timer);
      ro.disconnect();
      m.remove();
      map.current = null;
      reportMarkers.current = [];
      pickMarker.current = null;
      meMarker.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Imperative handle for the full-screen map screen.
  useEffect(() => {
    if (!mapApi) return undefined;
    mapApi.current = {
      engine: 'vector',
      supports3d: true,
      flyTo(lat, lng, z) {
        map.current?.flyTo({ center: [lng, lat], zoom: z ?? Math.max(map.current.getZoom(), 16), essential: true });
      },
      getCenter() {
        const c = map.current?.getCenter();
        return c ? { lat: c.lat, lng: c.lng } : null;
      },
      setUserLocation(pos) {
        const m = map.current;
        if (!m) return;
        if (!pos) {
          meMarker.current?.remove();
          meMarker.current = null;
          return;
        }
        if (!meMarker.current) {
          meMarker.current = new maplibregl.Marker({
            element: el('wg-me', ME_HTML),
            anchor: 'center',
            rotationAlignment: 'map',
            pitchAlignment: 'viewport',
          })
            .setLngLat([pos.lng, pos.lat])
            .addTo(m);
        } else meMarker.current.setLngLat([pos.lng, pos.lat]);
        meMarker.current.getElement().classList.toggle('wg-me--drive', Boolean(pos.drive));
        meMarker.current.setRotation(pos.drive && Number.isFinite(pos.heading) ? pos.heading : 0);
      },
      // Drive mode: keep you in view, heading up, tilted like a driving app.
      follow(pos) {
        const m = map.current;
        if (!m) return;
        m.easeTo({
          center: [pos.lng, pos.lat],
          bearing: Number.isFinite(pos.heading) ? pos.heading : m.getBearing(),
          pitch: 55,
          zoom: Math.max(m.getZoom(), 17),
          offset: [0, Math.round(m.getContainer().clientHeight * 0.18)],
          duration: 900,
          essential: true,
        });
      },
      endDrive() {
        map.current?.easeTo({ pitch: 0, bearing: 0, offset: [0, 0], duration: 600 });
      },
      set3d(on) {
        map.current?.easeTo({ pitch: on ? 55 : 0, bearing: on ? map.current.getBearing() : 0, duration: 600 });
      },
      resetNorth() {
        map.current?.easeTo({ bearing: 0, pitch: 0, duration: 500 });
      },
      zoomBy(d) {
        const m = map.current;
        m?.easeTo({ zoom: m.getZoom() + d, duration: 250 });
      },
    };
    return () => {
      mapApi.current = null;
    };
  }, [mapApi]);

  // Day / night: swap the style; markers are DOM elements and stay put.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    m.setStyle(buildRoadStyle(settings.vector, theme), { diff: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  // Report markers
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const mk of reportMarkers.current) mk.remove();
    reportMarkers.current = [];
    const bounds = new maplibregl.LngLatBounds();
    let count = 0;
    for (const r of markers) {
      if (!Number.isFinite(r.latitude) || !Number.isFinite(r.longitude)) continue;
      const { className: cls, html } = pinMarkup({
        severity: r.severity,
        status: r.status,
        awaiting: r.status === 'in_progress' && Boolean(r.work_completed_at),
        selected: r.id === selectedId,
      });
      const node = el(cls, html);
      const clickable = Boolean(handlers.current.onMarkerClick);
      const title = clickable
        ? `${r.code}: ${SEVERITY[r.severity]?.label} severity, ${STATUS[r.status]?.label}`
        : `${r.code}, ${r.road_name || ''}`;
      node.title = title;
      if (clickable) {
        node.setAttribute('role', 'button');
        node.setAttribute('tabindex', '0');
        node.setAttribute('aria-label', title);
        const open = (e) => {
          e.stopPropagation();
          lastMarkerClick.current = Date.now();
          handlers.current.onMarkerClick?.(r);
        };
        node.addEventListener('click', open);
        node.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open(e);
          }
        });
      }
      const marker = new maplibregl.Marker({ element: node, anchor: 'bottom', offset: [0, 2] })
        .setLngLat([r.longitude, r.latitude])
        .addTo(m);
      if (r.id === selectedId) node.style.zIndex = '3';
      reportMarkers.current.push(marker);
      bounds.extend([r.longitude, r.latitude]);
      count += 1;
    }
    fit.current.bounds = count ? bounds : null;
    const c = m.getContainer();
    if (fit.current.on && count && c.clientWidth > 0 && c.clientHeight > 0) {
      m.fitBounds(bounds, { padding: 60, maxZoom: MAX_FIT_ZOOM, duration: 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, markers, selectedId]);

  // Bring the selected report into view, Waze-style.
  useEffect(() => {
    const m = map.current;
    if (!m || selectedId == null) return;
    const r = markers.find((x) => x.id === selectedId);
    if (r) m.easeTo({ center: [r.longitude, r.latitude], zoom: Math.max(m.getZoom(), 15), duration: 500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selectedId]);

  // Location being picked (draggable)
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!pick) {
      pickMarker.current?.remove();
      pickMarker.current = null;
      return;
    }
    if (!pickMarker.current) {
      const node = el('wg-pick', PICK_HTML);
      node.title = 'Pothole location. Drag to adjust.';
      const mk = new maplibregl.Marker({ element: node, anchor: 'bottom', draggable: true }).setLngLat([pick.lng, pick.lat]).addTo(m);
      mk.on('dragend', () => {
        const p = mk.getLngLat();
        handlers.current.onPickMove?.({ lat: p.lat, lng: p.lng });
      });
      pickMarker.current = mk;
    } else {
      pickMarker.current.setLngLat([pick.lng, pick.lat]);
    }
    const b = m.getBounds();
    if (!b.contains([pick.lng, pick.lat])) m.jumpTo({ center: [pick.lng, pick.lat], zoom: Math.max(m.getZoom(), 17) });
  }, [ready, pick]);

  // GPS accuracy ring
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const apply = () => {
      const src = m.getSource('overlay');
      if (!src) return;
      src.setData({
        type: 'FeatureCollection',
        features: pick && accuracy && accuracy < 2000 ? [circlePolygon(pick.lat, pick.lng, accuracy)] : [],
      });
    };
    if (m.isStyleLoaded()) apply();
    else m.once('styledata', apply);
  }, [ready, pick, accuracy, theme]);

  // Re-centre when the requested centre changes.
  useEffect(() => {
    const m = map.current;
    if (!m || !center || pick) return;
    m.jumpTo({ center: [center.lng, center.lat], ...(zoom ? { zoom } : {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center?.lat, center?.lng]);

  return (
    <div className={`map-frame map-frame--vector map-frame--${theme} ${className}`} style={{ height }}>
      <div ref={box} className="map" role="region" aria-label={label} />
      {!ready && (
        <div className="map-loading" aria-hidden>
          Loading map…
        </div>
      )}
    </div>
  );
}
