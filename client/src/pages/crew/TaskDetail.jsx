// One repair task: location and navigation link, report evidence, progress
// updates with before/progress photos (FR-13) and completion with after
// photos for LGU verification.
import { useState } from 'react';
import { LuArrowLeft, LuNavigation, LuExternalLink, LuPlay, LuCircleCheck, LuNotebookPen, LuHourglass } from 'react-icons/lu';
import { api, upload } from '../../lib/api.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { Link, useParams } from '../../lib/router.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useToast } from '../../lib/toast.jsx';
import { Alert, Button, ErrorState, Facts, Loading, SeverityBadge, StatusBadge, TextField, DemoTag } from '../../components/ui.jsx';
import MapView from '../../components/MapView.jsx';
import Timeline from '../../components/Timeline.jsx';
import { PhotoGrid, PhotoPicker } from '../../components/Photos.jsx';
import { HAZARDS, formatCoords, formatDate, formatDateTime, isAwaitingVerification } from '../../lib/format.js';

function RepairForm({ reportId, type, onDone }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [kind, setKind] = useState('before');
  const [photos, setPhotos] = useState([]);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null);
  const completing = type === 'complete';

  async function submit(e) {
    e.preventDefault();
    const v = {};
    if (note.trim().length < 3) v.note = completing ? 'Describe the repair that was done.' : 'Write a short update.';
    if (completing && !photos.length) v.photos = 'Add at least one photo of the finished repair.';
    setErrors(v);
    setError(null);
    if (Object.keys(v).length) return;
    const fd = new FormData();
    fd.append('note', note.trim());
    if (!completing) fd.append('photo_kind', kind);
    photos.forEach((p, i) => fd.append('photos', p.file, p.file.name || `photo-${i + 1}.jpg`));
    setProgress(0);
    try {
      await upload(`/api/maintenance/tasks/${reportId}/${completing ? 'complete' : 'updates'}`, fd, { onProgress: setProgress });
      toast(completing ? 'Completion sent to the LGU for verification.' : 'Update posted.');
      setNote('');
      setPhotos([]);
      onDone();
    } catch (err) {
      setErrors(err.fields || {});
      setError(err.message);
    } finally {
      setProgress(null);
    }
  }

  return (
    <form className="form-stack" onSubmit={submit} noValidate>
      {error && <Alert type="error">{error}</Alert>}
      {!completing && (
        <fieldset className="fieldset">
          <legend className="field__label">Photos show</legend>
          <div className="chips">
            {[
              ['before', 'Before repair'],
              ['progress', 'Work in progress'],
            ].map(([k, label]) => (
              <label key={k} className="choice choice--chip">
                <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} /> {label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div>
        <span className="field__label">{completing ? 'After photos' : 'Photos'}</span>{' '}
        {!completing && <span className="field__optional">(optional)</span>}
        <div style={{ marginTop: 6 }}>
          <PhotoPicker value={photos} onChange={setPhotos} max={6} error={errors.photos} label="Add photo" />
        </div>
      </div>
      <TextField
        label={completing ? 'Repair notes' : 'Update'}
        multiline
        rows={3}
        hint={completing ? 'What was done, materials used, and the size of the patched area.' : 'e.g. Site inspected, cones placed, waiting for asphalt.'}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        error={errors.note}
        maxLength={2000}
      />
      <div>
        <Button type="submit" variant={completing ? 'primary' : 'navy'} loading={progress !== null}>
          {completing ? <LuCircleCheck aria-hidden /> : <LuNotebookPen aria-hidden />}
          {progress !== null ? `Uploading… ${progress}%` : completing ? 'Submit repair for verification' : 'Post update'}
        </Button>
      </div>
    </form>
  );
}

export default function TaskDetail() {
  const { id } = useParams();
  const toast = useToast();
  const { config } = useAuth();
  const { data, error, loading, reload } = useApi(`/api/reports/${id}`);
  const [tab, setTab] = useState('update');
  const [starting, setStarting] = useState(false);
  const r = data?.report;
  useDocumentTitle(r ? `Task ${r.code}` : 'Task');

  if (error) return <div className="container page"><ErrorState error={error} onRetry={reload} /></div>;
  if (loading && !r) return <Loading />;

  const awaiting = isAwaitingVerification(r);
  const active = r.is_active_for_my_team;
  const canWork = active && ['assigned', 'in_progress'].includes(r.status) && !awaiting;
  // Directions open in Google Maps when the app uses Google Maps (no key is
  // needed for these links), otherwise on OpenStreetMap.
  const useGoogle = config?.map?.provider === 'google';
  const ll = `${r.latitude},${r.longitude}`;
  const viewUrl = useGoogle
    ? `https://www.google.com/maps/search/?api=1&query=${ll}`
    : `https://www.openstreetmap.org/?mlat=${r.latitude}&mlon=${r.longitude}#map=18/${r.latitude}/${r.longitude}`;
  const directionsUrl = useGoogle
    ? `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=driving`
    : `https://www.openstreetmap.org/directions?route=%3B${r.latitude}%2C${r.longitude}`;
  const geoUrl = `geo:${r.latitude},${r.longitude}?q=${r.latitude},${r.longitude}(${encodeURIComponent(r.code)})`;

  async function start() {
    setStarting(true);
    try {
      await api.post(`/api/maintenance/tasks/${r.id}/start`, {});
      toast('Work started. The reporter has been notified.');
      reload();
    } catch (err) {
      toast(err.message, { type: 'error' });
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="container page">
      <Link to="/crew" className="back-link">
        <LuArrowLeft aria-hidden /> Tasks
      </Link>
      <div className="detail-head">
        <h1 className="numeral">{r.code}</h1>
        <div className="cluster">
          <StatusBadge status={r.status} awaiting={awaiting} />
          <SeverityBadge severity={r.severity} />
          {r.is_demo && <DemoTag />}
        </div>
      </div>

      {!active && (
        <Alert type="info" className="mb">
          This task is no longer assigned to your team. It is shown for your records.
        </Alert>
      )}

      <div className="split">
        <div className="stack">
          <section className="panel" aria-labelledby="loc-title">
            <h2 id="loc-title" className="section-title">
              Location
            </h2>
            <p className="task-address">
              <strong>
                {r.road_name}
                {r.barangay ? `, ${r.barangay}` : ''}
                {r.city ? `, ${r.city}` : ''}
              </strong>
              {r.landmark && <span>Landmark: {r.landmark}</span>}
            </p>
            <MapView markers={[r]} center={{ lat: r.latitude, lng: r.longitude }} zoom={17} height={280} label={`Location of ${r.code}`} />
            <div className="cluster" style={{ marginTop: 12 }}>
              <a className="btn btn--navy" href={directionsUrl} target="_blank" rel="noopener noreferrer">
                <LuNavigation aria-hidden /> Directions
              </a>
              <a className="btn btn--secondary" href={geoUrl}>
                Open in maps app
              </a>
              <a className="btn btn--ghost" href={viewUrl} target="_blank" rel="noopener noreferrer">
                <LuExternalLink aria-hidden /> {useGoogle ? 'Google Maps' : 'OpenStreetMap'}
              </a>
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>
              {formatCoords(r.latitude, r.longitude)}
              {r.location_accuracy_m ? `, GPS accuracy about ${Math.round(r.location_accuracy_m)} m` : ''}
            </p>
          </section>

          {active && (
            <section className="panel" aria-labelledby="work-title">
              <h2 id="work-title" className="section-title">
                Repair work
              </h2>
              {awaiting ? (
                <Alert type="info" title="Waiting for LGU verification">
                  <LuHourglass aria-hidden style={{ verticalAlign: '-2px' }} /> You submitted the completed repair on{' '}
                  {formatDateTime(r.work_completed_at)}. The LGU will check it and close the report, or ask for more work.
                </Alert>
              ) : canWork ? (
                <>
                  {r.status === 'assigned' && (
                    <div className="start-work">
                      <p>Tap start when the crew begins inspecting or repairing. The reporter will be told that work has started.</p>
                      <Button variant="primary" onClick={start} loading={starting}>
                        <LuPlay aria-hidden /> Start work
                      </Button>
                    </div>
                  )}
                  <div className="segmented" role="tablist" aria-label="Repair actions">
                    <button type="button" role="tab" aria-selected={tab === 'update'} onClick={() => setTab('update')}>
                      Progress update
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={tab === 'complete'}
                      onClick={() => setTab('complete')}
                      disabled={r.status !== 'in_progress'}
                      title={r.status !== 'in_progress' ? 'Start work first' : undefined}
                    >
                      Repair finished
                    </button>
                  </div>
                  <div role="tabpanel">
                    <RepairForm key={tab} reportId={r.id} type={tab} onDone={reload} />
                  </div>
                </>
              ) : (
                <p className="muted">No actions are available for this task.</p>
              )}
            </section>
          )}

          {r.repair_updates?.length > 0 && (
            <section className="panel" aria-labelledby="upd-title">
              <h2 id="upd-title" className="section-title">
                Repair updates
              </h2>
              <ul className="updates">
                {[...r.repair_updates].reverse().map((u) => (
                  <li key={u.id} className={`update ${u.update_type === 'completion' ? 'update--done' : ''}`}>
                    <div className="update__head">
                      <strong>{u.update_type === 'completion' ? 'Repair completed' : 'Progress update'}</strong>
                      <span className="muted small">
                        {formatDateTime(u.created_at)}
                        {u.author_name ? ` by ${u.author_name}` : ''}
                      </span>
                    </div>
                    <p>{u.note}</p>
                    {u.photos.length > 0 && <PhotoGrid photos={u.photos} showKind />}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="stack">
          <section className="panel" aria-labelledby="rep-title">
            <h2 id="rep-title" className="section-title">
              Reported damage
            </h2>
            {r.active_assignment?.instructions && (
              <Alert type="warn" title="Instructions from the LGU">
                {r.active_assignment.instructions}
              </Alert>
            )}
            <p style={{ marginTop: 12 }}>{r.description}</p>
            <Facts
              items={[
                ['Severity', <SeverityBadge key="s" severity={r.severity} />],
                ['Hazards', r.hazards.map((h) => HAZARDS[h]).join(', ')],
                ['Due', r.active_assignment?.due_date ? formatDate(r.active_assignment.due_date) : null],
                ['Agency', r.agency?.name],
                ['Reported', formatDateTime(r.created_at)],
              ]}
            />
            <div style={{ marginTop: 12 }}>
              <PhotoGrid photos={r.photos.filter((p) => p.kind === 'report')} />
            </div>
          </section>
          <section className="panel" aria-labelledby="hist-title">
            <h2 id="hist-title" className="section-title">
              History
            </h2>
            <Timeline events={r.events} showActors />
          </section>
        </div>
      </div>
    </div>
  );
}
