// Interactive map of all reports for LGU staff, including unverified ones.
import { useMemo, useState } from 'react';
import { LuX, LuMapPin, LuFlame, LuMapPinned, LuLayers } from 'react-icons/lu';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { qs } from '../../lib/api.js';
import { Link, useNavigate } from '../../lib/router.jsx';
import MapView, { MapLegend } from '../../components/MapView.jsx';
import { ErrorState, SeverityBadge, StatusBadge, DemoTag } from '../../components/ui.jsx';
import { formatDate, isAwaitingVerification } from '../../lib/format.js';

const VIEWS = [
  { key: 'open', label: 'Open', status: 'submitted,under_review,verified,assigned,in_progress' },
  { key: 'review', label: 'Needs review', status: 'submitted,under_review' },
  { key: 'repair', label: 'Being repaired', status: 'assigned,in_progress' },
  { key: 'resolved', label: 'Resolved', status: 'resolved' },
  { key: 'all', label: 'All', status: '' },
];

const LAYERS = [
  { key: 'pins', label: 'Pins', icon: LuMapPin },
  { key: 'heat', label: 'Heat map', icon: LuFlame },
  { key: 'barangay', label: 'By barangay', icon: LuMapPinned },
];

// One bubble per barangay at the middle of its reports. (Official barangay
// boundary shapes are not bundled, so areas are shown as counts, not outlines.)
function barangayAreas(items) {
  const groups = new Map();
  for (const r of items) {
    const key = (r.barangay || '').trim() || 'Unspecified';
    if (!groups.has(key)) groups.set(key, { lat: 0, lng: 0, n: 0, high: 0 });
    const g = groups.get(key);
    g.lat += r.latitude;
    g.lng += r.longitude;
    g.n += 1;
    if (r.severity === 'high') g.high += 1;
  }
  return [...groups.entries()].map(([label, g]) => ({
    id: `area:${label}`,
    kind: 'area',
    label,
    count: g.n,
    high: g.high,
    latitude: g.lat / g.n,
    longitude: g.lng / g.n,
  }));
}

export default function AdminMap() {
  useDocumentTitle('Map');
  const [view, setView] = useState('open');
  const [severity, setSeverity] = useState('');
  const [selected, setSelected] = useState(null);
  const [layer, setLayer] = useState('pins');
  const navigate = useNavigate();
  const status = VIEWS.find((v) => v.key === view).status;
  const { data, error, reload } = useApi(`/api/admin/map${qs({ status, severity })}`);
  const items = data?.items || [];
  const current = items.find((r) => r.id === selected);
  const areas = useMemo(() => barangayAreas(items), [items]);
  const shown = layer === 'heat'
    ? items.map((r) => ({ ...r, id: `heat:${r.id}`, kind: 'heat' }))
    : layer === 'barangay'
      ? areas
      : items;
  const topAreas = [...areas].sort((a, b) => b.count - a.count).slice(0, 8);

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1>Map</h1>
          <p>{data ? `${items.length} report${items.length === 1 ? '' : 's'} shown` : ' '}</p>
        </div>
      </div>
      <div className="map-filters">
        <div className="chips" role="group" aria-label="Which reports">
          {VIEWS.map((v) => (
            <button key={v.key} type="button" className="chip" aria-pressed={view === v.key} onClick={() => { setView(v.key); setSelected(null); }}>
              {v.label}
            </button>
          ))}
        </div>
        <div className="segmented map-layer-switch" role="radiogroup" aria-label="Show reports as">
          {LAYERS.map((l) => (
            <button key={l.key} type="button" role="radio" aria-checked={layer === l.key} className={layer === l.key ? 'is-on' : ''} onClick={() => { setLayer(l.key); setSelected(null); }}>
              <l.icon aria-hidden /> {l.label}
            </button>
          ))}
        </div>
        <select className="select select--sm" aria-label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="">Any severity</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <div className="map-layout">
          <div className="map-layout__map">
            <MapView
              markers={shown}
              selectedId={selected}
              onMarkerClick={(r) => {
                if (r.kind === 'area') {
                  if (r.label !== 'Unspecified') navigate(`/admin/reports${qs({ barangay: r.label, status })}`);
                } else setSelected(r.id);
              }}
              fitToMarkers={shown.length > 1 && !selected}
              height={600}
              label={layer === 'heat' ? 'Heat map of pothole reports' : layer === 'barangay' ? 'Open reports per barangay. Select a bubble to list them.' : 'Map of pothole reports. Select a marker for details.'}
            />
            {layer === 'pins' && <MapLegend />}
            {layer === 'heat' && (
              <p className="map-layer-note small muted">
                <span className="heat-key" aria-hidden /> Brighter, redder areas have more reports close together; high-severity reports glow stronger. Switch to Pins to open a report.
              </p>
            )}
            {layer === 'barangay' && (
              <p className="map-layer-note small muted">
                <LuLayers aria-hidden /> Each bubble is a barangay, placed at the middle of its reports; the number is how many reports are shown. Red bubbles have 10 or more. Select one to list its reports.
              </p>
            )}
          </div>
          <aside className="map-layout__side">
            {layer === 'barangay' ? (
              <div className="panel">
                <h2 className="section-title">Barangays with the most reports</h2>
                {topAreas.length ? (
                  <ol className="area-rank">
                    {topAreas.map((a) => (
                      <li key={a.label}>
                        {a.label === 'Unspecified' ? <span>{a.label}</span> : <Link to={`/admin/reports${qs({ barangay: a.label, status })}`}>{a.label}</Link>}
                        <span className="numeral">{a.count}</span>
                        {a.high > 0 && <span className="small muted">{a.high} high</span>}
                      </li>
                    ))}
                  </ol>
                ) : <p className="muted small">No reports in this view.</p>}
              </div>
            ) : current ? (
              <div className="panel map-detail">
                <div className="panel__head">
                  <h2 className="numeral">{current.code}</h2>
                  <button type="button" className="icon-btn" onClick={() => setSelected(null)} aria-label="Close details">
                    <LuX aria-hidden />
                  </button>
                </div>
                <div className="cluster" style={{ marginBottom: 12 }}>
                  <StatusBadge status={current.status} awaiting={isAwaitingVerification(current)} />
                  <SeverityBadge severity={current.severity} />
                  {current.is_demo && <DemoTag />}
                </div>
                <p className="map-detail__road">
                  <LuMapPin aria-hidden /> {current.road_name}
                  {current.barangay ? `, ${current.barangay}` : ''}
                </p>
                {current.landmark && <p className="muted small">Landmark: {current.landmark}</p>}
                <p className="muted small">Reported {formatDate(current.created_at)}</p>
                <Link to={`/admin/reports/${current.id}`} className="btn btn--navy btn--block">
                  Open report
                </Link>
              </div>
            ) : (
              <div className="panel">
                <p className="muted" style={{ margin: 0 }}>
                  Select a marker to see the report. Markers show severity by letter and colour; a check mark means the repair is
                  verified.
                </p>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
