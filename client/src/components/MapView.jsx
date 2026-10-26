// Map component used by every page. The provider comes from
// /api/public/config:
//   vector  Wayguard's Waze-style road map (MapLibre + free OpenStreetMap
//           vector tiles), loaded on demand — the default
//   google  Google Maps, when the server has GOOGLE_MAPS_API_KEY
//   osm     Leaflet with OpenStreetMap raster tiles
// If the chosen provider cannot load (no WebGL, blocked network, rejected
// key), maps fall back to the Leaflet/OpenStreetMap map with a short notice,
// so reporting keeps working. All engines take the same props and draw the
// same report bubbles; `mapApi` gives the full-screen map screen a handle to
// fly to places and show "you are here".
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useAuth } from '../lib/auth.jsx';
import { SEVERITY, STATUS } from '../lib/format.js';
import { useMapFailed } from '../lib/mapStatus.js';
import { useMapTheme } from '../lib/mapTheme.js';
import GoogleMap from './GoogleMap.jsx';
import { BUBBLE_ANCHOR, BUBBLE_SIZE, KIND_SIZE, ME_HTML, PICK_HTML, pinMarkup } from './mapPins.js';

// MapLibre is large, so it is downloaded only when a map is shown. The
// self-contained preview build never includes it.
const VectorMap = __WG_PREVIEW__ ? null : lazy(() => import('./VectorMap.jsx'));

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function pinIcon(opts) {
  const { className, html } = pinMarkup(opts);
  if (opts.kind) {
    const size = KIND_SIZE[opts.kind] || [48, 48];
    return L.divIcon({ className, html, iconSize: size, iconAnchor: [size[0] / 2, size[1] / 2] });
  }
  return L.divIcon({ className, html, iconSize: BUBBLE_SIZE, iconAnchor: BUBBLE_ANCHOR });
}

// Browser-preview build only: map tiles cannot be fetched inside the preview
// frame, so a plain street-grid backdrop is drawn locally instead.
function previewBasemap(options) {
  const Grid = L.GridLayer.extend({
    createTile() {
      const size = this.getTileSize();
      const c = document.createElement('canvas');
      c.width = size.x;
      c.height = size.y;
      const g = c.getContext('2d');
      g.fillStyle = '#E6EAF0';
      g.fillRect(0, 0, size.x, size.y);
      g.strokeStyle = '#F8FAFC';
      g.lineWidth = 2;
      for (let i = 1; i < 4; i += 1) {
        const p = (i * size.x) / 4;
        g.beginPath();
        g.moveTo(p, 0);
        g.lineTo(p, size.y);
        g.moveTo(0, p);
        g.lineTo(size.x, p);
        g.stroke();
      }
      g.strokeStyle = '#FFFFFF';
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(size.x, 0);
      g.moveTo(0, 0);
      g.lineTo(0, size.y);
      g.stroke();
      return c;
    },
  });
  return new Grid(options);
}

export const pickIcon = () =>
  L.divIcon({
    className: 'wg-pick',
    html: PICK_HTML,
    iconSize: [36, 48],
    iconAnchor: [18, 47],
  });

const FALLBACK_NOTICE = {
  google: 'Google Maps could not load, so OpenStreetMap is shown instead.',
  vector: 'The road map could not load, so the basic OpenStreetMap map is shown instead.',
};

export default function MapView(props) {
  const { config } = useAuth();
  const theme = useMapTheme();
  const googleFailed = useMapFailed('google');
  const vectorFailed = useMapFailed('vector');
  const provider = __WG_PREVIEW__ ? 'osm' : config?.map?.provider;
  const settings = config ? { ...config.map, center: config.map_center, jurisdiction_boundary: config.jurisdiction_boundary } : null;
  if (provider === 'google' && config.map.google_api_key && !googleFailed) {
    return <GoogleMap key={theme} {...props} settings={settings} theme={theme} />;
  }
  if (provider === 'vector' && config.map.vector && !vectorFailed && VectorMap) {
    return (
      <Suspense fallback={<MapPlaceholder height={props.height} className={props.className} />}>
        <VectorMap {...props} settings={settings} theme={theme} />
      </Suspense>
    );
  }
  const failedProvider = (provider === 'google' && googleFailed) || (provider === 'vector' && vectorFailed) ? provider : null;
  return <LeafletMap {...props} theme={theme} fallbackNotice={failedProvider ? FALLBACK_NOTICE[failedProvider] : null} />;
}

function MapPlaceholder({ height = 420, className = '' }) {
  return (
    <div className={`map-frame ${className}`} style={{ height }}>
      <div className="map-loading" aria-hidden>
        Loading map…
      </div>
    </div>
  );
}

function LeafletMap({
  markers = [],
  center,
  zoom,
  selectedId = null,
  onMarkerClick,
  onMapClick,
  fitToMarkers = false,
  pick = null, // { lat, lng } location being chosen
  onPickMove,
  accuracy = null, // metres, drawn around `pick`
  height = 420,
  label = 'Map of reported potholes',
  className = '',
  fallbackNotice = null,
  mapApi,
  onViewChange,
  onUserMove,
  theme = 'night',
}) {
  const { config } = useAuth();
  const el = useRef(null);
  const map = useRef(null);
  const meMarker = useRef(null);
  // While `fitToMarkers` is on, keep all reports in view, also when the map
  // is resized (e.g. a frame that starts small or hidden).
  const fit = useRef({ on: false, bounds: [] });
  fit.current.on = fitToMarkers;
  const layer = useRef(null);
  const pickMarker = useRef(null);
  const accuracyCircle = useRef(null);
  const jurisdictionLayer = useRef(null);
  const outsideMaskLayer = useRef(null);
  const handlers = useRef({});
  const [tileError, setTileError] = useState(false);
  const [ready, setReady] = useState(false);
  handlers.current = { onMarkerClick, onMapClick, onPickMove, onViewChange, onUserMove };

  // Create the map once.
  useEffect(() => {
    if (!config || map.current || !el.current) return undefined;
    const c = center || config.map_center;
    const m = L.map(el.current, {
      center: [c.lat, c.lng],
      zoom: zoom || c.zoom || 14,
      zoomControl: true,
      attributionControl: true,
      keyboard: true,
    });
    let failures = 0;
    const tileOptions = { attribution: config.tiles.attribution, maxZoom: config.tiles.maxZoom || 19, crossOrigin: false };
    (__WG_PREVIEW__ && config.tiles.preview ? previewBasemap(tileOptions) : L.tileLayer(config.tiles.url, tileOptions))
      .on('tileerror', () => {
        failures += 1;
        if (failures >= 4) setTileError(true);
      })
      .on('tileload', () => {
        failures = 0;
        setTileError(false);
      })
      .addTo(m);
    m.attributionControl.setPrefix('<a href="https://leafletjs.com" title="Leaflet map library">Leaflet</a>');
    m.on('click', (e) => handlers.current.onMapClick?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
    m.on('dragstart', () => handlers.current.onUserMove?.());
    m.on('moveend', () => {
      if (map.current !== m) return; // map is being removed
      const cc = m.getCenter();
      handlers.current.onViewChange?.({ lat: cc.lat, lng: cc.lng, zoom: m.getZoom(), pitch: 0, bearing: 0 });
    });
    // Leaflet 1.9 finishes zoom animations on a timer, which can fire after
    // the map was removed (leaving the page mid-zoom); skip it then.
    const finishZoom = m._onZoomTransitionEnd;
    m._onZoomTransitionEnd = function onZoomTransitionEnd() {
      if (this._mapPane) finishZoom.call(this);
    };
    const boundary = config.jurisdiction_boundary;
    if (boundary) {
      const geometry = boundary.type === 'Feature' ? boundary.geometry : boundary;
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
      const world = [[-85, -179.99], [-85, 179.99], [85, 179.99], [85, -179.99], [-85, -179.99]];
      const holes = polygons.map((rings) => {
        const ring = rings[0];
        const area = ring.reduce((sum, point, i) => { const next = ring[(i + 1) % ring.length]; return sum + point[0] * next[1] - next[0] * point[1]; }, 0);
        const closed = area < 0 ? ring : [...ring].reverse();
        return closed.map(([lng, lat]) => [lat, lng]);
      });
      outsideMaskLayer.current = L.polygon([world, ...holes], { stroke: false, fillColor: '#061429', fillOpacity: 0.42, interactive: false }).addTo(m);
    }
    layer.current = L.layerGroup().addTo(m);
    if (boundary) {
      const geometry = boundary.type === 'Feature' ? boundary.geometry : boundary;
      const toLatLngs = (ring) => ring.map(([lng, lat]) => [lat, lng]);
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
      jurisdictionLayer.current = L.polygon(polygons.map((rings) => rings.map(toLatLngs)), { color: '#FAAE0B', weight: 3, opacity: 1, fillColor: '#FAAE0B', fillOpacity: 0.08, interactive: false }).addTo(m);
      m.fitBounds(jurisdictionLayer.current.getBounds(), { padding: [28, 28], maxZoom: 13, animate: false });
    }
    map.current = m;
    setReady(true);
    // The container may be resized by layout after mounting.
    const ro = new ResizeObserver(() => {
      m.invalidateSize();
      const size = m.getSize();
      if (fit.current.on && fit.current.bounds.length && size.x > 0 && size.y > 0) {
        m.fitBounds(fit.current.bounds, { padding: [40, 40], maxZoom: 16, animate: false });
      }
    });
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      map.current = null;
      m.remove();
      setReady(false);
      pickMarker.current = null;
      accuracyCircle.current = null;
      jurisdictionLayer.current = null;
      outsideMaskLayer.current = null;
      meMarker.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  // Imperative handle for the full-screen map screen.
  useEffect(() => {
    if (!mapApi) return undefined;
    mapApi.current = {
      engine: 'leaflet',
      supports3d: false,
      flyTo(lat, lng, z) {
        map.current?.flyTo([lat, lng], z ?? Math.max(map.current.getZoom(), 16));
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
          meMarker.current = L.marker([pos.lat, pos.lng], {
            icon: L.divIcon({ className: 'wg-me', html: ME_HTML, iconSize: [22, 22], iconAnchor: [11, 11] }),
            interactive: false,
            keyboard: false,
          }).addTo(m);
        } else meMarker.current.setLatLng([pos.lat, pos.lng]);
        const node = meMarker.current.getElement();
        if (node) {
          node.classList.toggle('wg-me--drive', Boolean(pos.drive));
          node.style.setProperty('--heading', `${pos.drive && Number.isFinite(pos.heading) ? pos.heading : 0}deg`);
        }
      },
      follow(pos) {
        const m = map.current;
        if (!m) return;
        m.setView([pos.lat, pos.lng], Math.max(m.getZoom(), 17), { animate: true });
      },
      endDrive() {},
      set3d() {},
      resetNorth() {},
      zoomBy(d) {
        map.current?.setZoom(map.current.getZoom() + d);
      },
    };
    return () => {
      mapApi.current = null;
    };
  }, [mapApi]);

  // Report markers
  useEffect(() => {
    const m = map.current;
    if (!m || !layer.current) return;
    layer.current.clearLayers();
    const bounds = [];
    for (const r of markers) {
      if (!Number.isFinite(r.latitude) || !Number.isFinite(r.longitude)) continue;
      const isHeat = r.kind === 'heat';
      const marker = L.marker([r.latitude, r.longitude], {
        icon: pinIcon({
          kind: r.kind,
          count: r.count,
          label: r.label,
          severity: r.severity,
          status: r.status,
          awaiting: r.status === 'in_progress' && Boolean(r.work_completed_at),
          selected: r.id === selectedId,
        }),
        title: r.kind === 'area' ? `${r.label}: ${r.count} open reports` : isHeat ? '' : `${r.code}: ${SEVERITY[r.severity]?.label} severity, ${STATUS[r.status]?.label}`,
        alt: r.kind === 'area' ? r.label : `${r.code || ''}`,
        riseOnHover: !isHeat,
        zIndexOffset: r.id === selectedId ? 1000 : 0,
        keyboard: Boolean(handlers.current.onMarkerClick) && !isHeat,
        interactive: Boolean(handlers.current.onMarkerClick) && !isHeat,
      });
      if (isHeat) {
        // decoration only
      } else if (handlers.current.onMarkerClick) {
        marker.on('click', () => handlers.current.onMarkerClick?.(r));
        marker.on('keypress', (e) => {
          if (e.originalEvent.key === 'Enter' || e.originalEvent.key === ' ') handlers.current.onMarkerClick?.(r);
        });
      } else {
        marker.bindTooltip(escapeHtml(`${r.code}, ${r.road_name || ''}`));
      }
      marker.addTo(layer.current);
      bounds.push([r.latitude, r.longitude]);
    }
    fit.current.bounds = bounds;
    const size = m.getSize();
    if (fit.current.on && bounds.length && size.x > 0 && size.y > 0) {
      m.fitBounds(bounds, { padding: [40, 40], maxZoom: 16, animate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, markers, selectedId]);

  // Location being picked (draggable)
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!pick) {
      if (pickMarker.current) {
        pickMarker.current.remove();
        pickMarker.current = null;
      }
      return;
    }
    const ll = [pick.lat, pick.lng];
    if (!pickMarker.current) {
      pickMarker.current = L.marker(ll, {
        icon: pickIcon(),
        draggable: true,
        autoPan: true,
        title: 'Pothole location. Drag to adjust.',
        alt: 'Selected pothole location',
        keyboard: true,
      }).addTo(m);
      pickMarker.current.on('dragend', (e) => {
        const p = e.target.getLatLng();
        handlers.current.onPickMove?.({ lat: p.lat, lng: p.lng });
      });
    } else {
      pickMarker.current.setLatLng(ll);
    }
    if (!m.getBounds().pad(-0.15).contains(ll)) m.setView(ll, Math.max(m.getZoom(), 17));
  }, [ready, pick]);

  // GPS accuracy ring
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (accuracyCircle.current) {
      accuracyCircle.current.remove();
      accuracyCircle.current = null;
    }
    if (pick && accuracy && accuracy < 2000) {
      accuracyCircle.current = L.circle([pick.lat, pick.lng], {
        radius: accuracy,
        color: '#2B4F8A',
        weight: 1.5,
        fillColor: '#6D8BBE',
        fillOpacity: 0.12,
        interactive: false,
      }).addTo(m);
    }
  }, [ready, pick, accuracy]);

  // Re-centre when the requested centre changes.
  useEffect(() => {
    if (map.current && center && !pick) map.current.setView([center.lat, center.lng], zoom || map.current.getZoom());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center?.lat, center?.lng]);

  return (
    <div className={`map-frame map-frame--leaflet map-frame--${theme} ${className}`} style={{ height }}>
      <div ref={el} className="map" role="region" aria-label={label} />
      {fallbackNotice && !tileError && (
        <div className="map-notice map-notice--bottom" role="status">
          {fallbackNotice}
        </div>
      )}
      {tileError && (
        <div className="map-notice" role="status">
          Map tiles could not be loaded. Check your connection. Locations and markers still work.
        </div>
      )}
    </div>
  );
}

function LegendBubble(opts) {
  const { className, html } = pinMarkup(opts);
  // Static, trusted SVG markup from mapPins.js.
  // eslint-disable-next-line react/no-danger
  return <span className={`${className} wg-bubble--legend`} aria-hidden dangerouslySetInnerHTML={{ __html: html }} />;
}

export function MapLegend() {
  return (
    <ul className="map-legend" aria-label="Map legend">
      {['high', 'medium', 'low'].map((s) => (
        <li key={s}>
          <LegendBubble severity={s} status="verified" />
          {SEVERITY[s].label} severity
        </li>
      ))}
      <li>
        <LegendBubble severity="medium" status="resolved" />
        Repaired
      </li>
    </ul>
  );
}
