// Citizen view of one report: progress road, status help, photos, history
// (FR-09, FR-15) and feedback on the finished repair (FR-17).
import { useState } from 'react';
import { LuArrowLeft, LuStar } from 'react-icons/lu';
import { api } from '../../lib/api.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { Link, useParams } from '../../lib/router.jsx';
import { useToast } from '../../lib/toast.jsx';
import { Alert, Button, ErrorState, Facts, Loading, SeverityBadge, StatusBadge, DemoTag, TextField } from '../../components/ui.jsx';
import RoadProgress from '../../components/RoadProgress.jsx';
import Timeline from '../../components/Timeline.jsx';
import { PhotoGrid } from '../../components/Photos.jsx';
import MapView from '../../components/MapView.jsx';
import { HAZARDS, ROAD_TYPES, STATUS, formatCoords, formatDateTime, isAwaitingVerification } from '../../lib/format.js';

export function Stars({ value, onChange, label = 'Rating' }) {
  return (
    <div className="stars" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value >= n}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          onClick={() => onChange(n)}
        >
          <LuStar fill={value >= n ? 'currentColor' : 'none'} aria-hidden />
        </button>
      ))}
    </div>
  );
}

export function StaticStars({ value }) {
  return (
    <span className="stars stars--static" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <LuStar key={n} className={value >= n ? 'on' : ''} fill={value >= n ? 'currentColor' : 'none'} aria-hidden />
      ))}
    </span>
  );
}

function FeedbackForm({ reportId, onSent }) {
  const toast = useToast();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    if (!rating) {
      setError('Choose a rating from 1 to 5 stars.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/reports/${reportId}/feedback`, { rating, comment: comment.trim() || null });
      toast('Thanks for your feedback.');
      onSent();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel feedback" onSubmit={submit}>
      <h2 className="section-title">How was the repair?</h2>
      <p className="muted small">Your rating helps the LGU check the quality of road repairs.</p>
      <Stars value={rating} onChange={setRating} label="Rate the repair" />
      <TextField label="Comment" optional multiline rows={3} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
      {error && <p className="field__error">{error}</p>}
      <div>
        <Button type="submit" variant="navy" loading={busy}>
          Send feedback
        </Button>
      </div>
    </form>
  );
}

export default function ReportDetail() {
  const { id } = useParams();
  const { data, error, loading, reload } = useApi(`/api/reports/${id}`);
  const r = data?.report;
  useDocumentTitle(r ? r.code : 'Report');

  if (error) return <div className="container page"><ErrorState error={error} onRetry={reload} /></div>;
  if (loading && !r) return <Loading />;

  const awaiting = isAwaitingVerification(r);
  const reportPhotos = r.photos.filter((p) => p.kind === 'report');
  const repairPhotos = r.photos.filter((p) => p.kind !== 'report');

  return (
    <div className="container page page--narrow">
      <Link to="/app/reports" className="back-link">
        <LuArrowLeft aria-hidden /> My reports
      </Link>
      <div className="detail-head">
        <h1 className="numeral">{r.code}</h1>
        <div className="cluster">
          <StatusBadge status={r.status} awaiting={awaiting} />
          <SeverityBadge severity={r.severity} />
          {r.is_demo && <DemoTag />}
        </div>
      </div>

      <section className="panel progress-panel" aria-label="Progress">
        <RoadProgress status={r.status} awaiting={awaiting} />
        <p className="progress-panel__help">
          {awaiting ? 'The road crew finished the repair. The LGU is checking the work before closing the report.' : STATUS[r.status].help}
        </p>
        {r.status === 'rejected' && (
          <Alert type="error" title="Why it was not accepted">
            {r.rejection_reason}
          </Alert>
        )}
        {r.status === 'duplicate' && r.duplicate_of && (
          <Alert type="info" title={`Tracked under ${r.duplicate_of.code}`}>
            The LGU found that this pothole was already reported. That report is {STATUS[r.duplicate_of.status].label.toLowerCase()}.
          </Alert>
        )}
        {r.active_assignment && (
          <p className="small muted">
            Assigned to {r.active_assignment.team_name}
            {r.agency ? ` (${r.agency.name})` : ''}.
          </p>
        )}
      </section>

      {r.can_give_feedback && <FeedbackForm reportId={r.id} onSent={reload} />}
      {r.feedback && (
        <section className="panel">
          <h2 className="section-title">Your feedback</h2>
          <StaticStars value={r.feedback.rating} />
          {r.feedback.comment && <p style={{ marginTop: 8 }}>{r.feedback.comment}</p>}
        </section>
      )}

      <div className="split">
        <div className="stack">
          <section className="panel" aria-labelledby="photos-title">
            <h2 id="photos-title" className="section-title">
              Your photos
            </h2>
            <PhotoGrid photos={reportPhotos} />
            {repairPhotos.length > 0 && (
              <>
                <h3 style={{ marginTop: 20 }}>Repair photos</h3>
                <PhotoGrid photos={repairPhotos} showKind />
              </>
            )}
          </section>
          <section className="panel" aria-labelledby="hist-title">
            <h2 id="hist-title" className="section-title">
              History
            </h2>
            <Timeline events={r.events} />
          </section>
        </div>
        <div className="stack">
          <section className="panel" aria-labelledby="details-title">
            <h2 id="details-title" className="section-title">
              Details
            </h2>
            <p>{r.description}</p>
            <Facts
              items={[
                ['Road', r.road_name],
                ['Barangay', r.barangay],
                ['City', r.city],
                ['Landmark', r.landmark],
                ['Road type', ROAD_TYPES[r.road_type]],
                ['Hazards', r.hazards.map((h) => HAZARDS[h]).join(', ')],
                ['Responsible agency', r.agency?.name],
                ['Reported', formatDateTime(r.created_at)],
                ['Coordinates', formatCoords(r.latitude, r.longitude)],
              ]}
            />
          </section>
          <MapView markers={[r]} center={{ lat: r.latitude, lng: r.longitude }} zoom={17} height={240} label={`Location of ${r.code}`} />
        </div>
      </div>
    </div>
  );
}
