import { LuArrowRight, LuNavigation } from 'react-icons/lu';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { useAuth } from '../../lib/auth.jsx';
import { Link } from '../../lib/router.jsx';
import MapScreen from '../../components/MapScreen.jsx';
import { ErrorState } from '../../components/ui.jsx';

// Full-screen map of the team's active tasks; tap a bubble for the task card.
export default function CrewMap() {
  useDocumentTitle('Task map');
  const { config } = useAuth();
  const { data, error, loading, reload } = useApi('/api/maintenance/tasks?scope=active');
  if (error) {
    return (
      <div className="container page">
        <ErrorState error={error} onRetry={reload} />
      </div>
    );
  }
  const google = config?.map?.provider === 'google';
  const directions = (r) =>
    google
      ? `https://www.google.com/maps/dir/?api=1&destination=${r.latitude},${r.longitude}&travelmode=driving`
      : `https://www.openstreetmap.org/directions?route=%3B${r.latitude}%2C${r.longitude}`;
  return (
    <MapScreen
      title="Task map"
      mode="crew"
      markers={data?.items || []}
      loading={loading}
      intro="Your team's active repair tasks."
      detailActions={(r) => (
        <>
          <Link to={`/crew/tasks/${r.id}`} className="btn btn--primary">
            Open task <LuArrowRight aria-hidden />
          </Link>
          <a className="btn btn--secondary" href={directions(r)} target="_blank" rel="noopener noreferrer">
            <LuNavigation aria-hidden /> Directions
          </a>
        </>
      )}
    />
  );
}
