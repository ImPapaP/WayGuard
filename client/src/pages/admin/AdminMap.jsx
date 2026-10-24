// Interactive map of all reports for LGU staff, including unverified ones.
import { useState } from 'react';
import { LuX, LuMapPin } from 'react-icons/lu';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { qs } from '../../lib/api.js';
import { Link } from '../../lib/router.jsx';
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

export default function AdminMap() {
  useDocumentTitle('Map');
  const [view, setView] = useState('open');
  const [severity, setSeverity] = useState('');
  const [selected, setSelected] = useState(null);
  const status = VIEWS.find((v) => v.key === view).status;
  const { data, error, reload } = useApi(`/api/admin/map${qs({ status, severity })}`);
  const items = data?.items || [];
  const current = items.find((r) => r.id === selected);

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
            <MapView markers={items} selectedId={selected} onMarkerClick={(r) => setSelected(r.id)} fitToMarkers={items.length > 1 && !selected} height={600} label="Map of pothole reports. Select a marker for details." />
            <MapLegend />
          </div>
          <aside className="map-layout__side">
            {current ? (
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
