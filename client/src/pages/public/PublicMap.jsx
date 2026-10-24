// Interactive map of verified potholes (FR-12), full screen and map-first.
// Public: no reporter data, no photos. Citizens see the same map inside their
// app, with the Report button leading straight to the report form.
import { useMemo, useState } from 'react';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { qs } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import MapScreen from '../../components/MapScreen.jsx';
import { ErrorState } from '../../components/ui.jsx';

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'verified,assigned,in_progress', label: 'Not yet fixed' },
  { value: 'resolved', label: 'Repaired' },
];
const SEVERITY_FILTERS = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

export default function PublicMap({ inApp = false }) {
  useDocumentTitle('Pothole map');
  const { user } = useAuth();
  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const { data, error, loading, reload } = useApi(`/api/public/reports${qs({ status, severity })}`);
  const items = useMemo(() => data?.items || [], [data]);

  if (error) {
    return (
      <div className="container page">
        <ErrorState error={error} onRetry={reload} />
      </div>
    );
  }

  const filters = (
    <>
      <div className="chips" role="group" aria-label="Filter by status">
        {STATUS_FILTERS.map((f) => (
          <button key={f.label} type="button" className="chip" aria-pressed={status === f.value} onClick={() => setStatus(f.value)}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="chips" role="group" aria-label="Filter by severity">
        {SEVERITY_FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            className="chip"
            aria-pressed={severity === f.value}
            onClick={() => setSeverity(severity === f.value ? '' : f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <MapScreen
      title="Pothole map"
      mode={inApp || user?.role === 'citizen' ? 'citizen' : 'public'}
      markers={items}
      loading={loading}
      filters={filters}
      intro="Potholes verified by the LGU, and repairs finished in the last few months. Reporter names, contact details and photos are never shown publicly."
    />
  );
}
