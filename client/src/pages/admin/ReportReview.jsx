// Administrator review of one report (FR-08, FR-10, FR-13, FR-15, FR-16):
// verify / reject / flag duplicates, assign a team, check completed repairs.
import { useState } from 'react';
import {
  LuArrowLeft,
  LuSearch,
  LuShieldCheck,
  LuCircleX,
  LuCopy,
  LuUsers,
  LuCircleCheck,
  LuUndo2,
  LuRotateCcw,
  LuPencil,
  LuStickyNote,
  LuUserMinus,
  LuPhone,
  LuMail,
} from 'react-icons/lu';
import { api } from '../../lib/api.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { Link, useParams } from '../../lib/router.jsx';
import { useToast } from '../../lib/toast.jsx';
import {
  Alert,
  Button,
  DemoTag,
  ErrorState,
  Facts,
  Loading,
  Modal,
  SelectField,
  SeverityBadge,
  StatusBadge,
  TextField,
} from '../../components/ui.jsx';
import RoadProgress from '../../components/RoadProgress.jsx';
import Timeline from '../../components/Timeline.jsx';
import { PhotoGrid } from '../../components/Photos.jsx';
import MapView from '../../components/MapView.jsx';
import { StaticStars } from '../citizen/ReportDetail.jsx';
import {
  HAZARDS,
  ROAD_TYPES,
  SEVERITY,
  STATUS,
  formatCoords,
  formatDate,
  formatDateTime,
  formatDistance,
  isAwaitingVerification,
  timeAgo,
} from '../../lib/format.js';

const SEVERITY_OPTIONS = Object.entries(SEVERITY).map(([value, v]) => ({ value, label: v.label }));

function useAction(reportId, reload) {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  async function run(name, body, message) {
    setBusy(name);
    setError(null);
    try {
      await api.post(`/api/admin/reports/${reportId}/${name}`, body);
      toast(message);
      reload();
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setBusy(null);
    }
  }
  return { run, busy, error, setError };
}

function ReasonModal({ title, label, hint, confirm, variant = 'navy', onSubmit, onClose, busy, error, minLength = 5 }) {
  const [text, setText] = useState('');
  const [local, setLocal] = useState(null);
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={variant}
            loading={busy}
            onClick={() => {
              if (text.trim().length < minLength) {
                setLocal(`Write at least ${minLength} characters.`);
                return;
              }
              onSubmit(text.trim());
            }}
          >
            {confirm}
          </Button>
        </>
      }
    >
      <TextField label={label} hint={hint} multiline rows={4} value={text} onChange={(e) => setText(e.target.value)} error={local || error?.fields?.reason || error?.fields?.note} />
      {error && !error.fields && <Alert type="error">{error.message}</Alert>}
    </Modal>
  );
}

function DuplicateModal({ report, onClose, onSubmit, busy, error }) {
  const [code, setCode] = useState('');
  const [results, setResults] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [note, setNote] = useState('');
  async function find(e) {
    e.preventDefault();
    if (!code.trim()) return;
    const res = await api.get(`/api/admin/reports?q=${encodeURIComponent(code.trim())}&pageSize=8`);
    setResults(res.items.filter((r) => r.id !== report.id));
  }
  const candidates = report.duplicate_candidates.filter((c) => !['rejected', 'duplicate'].includes(c.status));
  return (
    <Modal
      title={`Mark ${report.code} as a duplicate`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="navy" loading={busy} disabled={!chosen} onClick={() => onSubmit(chosen.id, note.trim() || null)}>
            Mark as duplicate
          </Button>
        </>
      }
    >
      <p className="small muted">Choose the existing report that already covers this pothole. The reporter will be told which report to follow.</p>
      {candidates.length > 0 && (
        <fieldset className="fieldset">
          <legend className="field__label">Nearby reports</legend>
          <div className="pick-list">
            {candidates.map((c) => (
              <label key={c.id} className="choice">
                <input type="radio" name="orig" checked={chosen?.id === c.id} onChange={() => setChosen(c)} />
                <span className="choice__title">
                  {c.code} <StatusBadge status={c.status} />
                </span>
                <span className="choice__desc">
                  {formatDistance(c.distance_m)} away on {c.road_name}, reported {formatDate(c.created_at)}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <form className="input-group" onSubmit={find} style={{ marginTop: 12 }}>
        <input className="input" placeholder="Or search by report code or road" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Search for the original report" />
        <Button type="submit" aria-label="Search">
          <LuSearch aria-hidden />
        </Button>
      </form>
      {results && (
        <div className="pick-list" style={{ marginTop: 8 }}>
          {results.length === 0 && <p className="muted small">No matching reports.</p>}
          {results.map((c) => (
            <label key={c.id} className="choice">
              <input type="radio" name="orig" checked={chosen?.id === c.id} onChange={() => setChosen(c)} />
              <span className="choice__title">
                {c.code} <StatusBadge status={c.status} />
              </span>
              <span className="choice__desc">
                {c.road_name}
                {c.barangay ? `, ${c.barangay}` : ''}
              </span>
            </label>
          ))}
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <TextField label="Note for staff" optional value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {error && <Alert type="error">{error.message}</Alert>}
    </Modal>
  );
}

function EditModal({ report, agencies, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    severity: report.severity,
    agency_id: report.agency_id ? String(report.agency_id) : '',
    road_type: report.road_type,
    road_name: report.road_name,
    barangay: report.barangay || '',
    landmark: report.landmark || '',
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api.patch(`/api/admin/reports/${report.id}`, {
        ...form,
        agency_id: form.agency_id ? Number(form.agency_id) : null,
        barangay: form.barangay || null,
        landmark: form.landmark || null,
      });
      toast('Report details updated.');
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <Modal
      title="Edit report details"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="navy" loading={busy} onClick={save}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="form-stack">
        {error && <Alert type="error">{error.message}</Alert>}
        <div className="form-row form-row--2">
          <SelectField label="Severity" value={form.severity} onChange={set('severity')} options={SEVERITY_OPTIONS} />
          <SelectField label="Road type" value={form.road_type} onChange={set('road_type')} options={Object.entries(ROAD_TYPES).map(([value, label]) => ({ value, label }))} />
        </div>
        <SelectField
          label="Responsible agency"
          value={form.agency_id}
          onChange={set('agency_id')}
          placeholder="Not set"
          options={agencies.filter((a) => a.is_active).map((a) => ({ value: String(a.id), label: a.name }))}
        />
        <TextField label="Road name" value={form.road_name} onChange={set('road_name')} error={error?.fields?.road_name} />
        <div className="form-row form-row--2">
          <TextField label="Barangay" optional value={form.barangay} onChange={set('barangay')} />
          <TextField label="Landmark" optional value={form.landmark} onChange={set('landmark')} />
        </div>
      </div>
    </Modal>
  );
}

function NoteForm({ reportId, onSaved }) {
  const toast = useToast();
  const [message, setMessage] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    if (message.trim().length < 2) {
      setError('Write a note first.');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/api/admin/reports/${reportId}/notes`, { message: message.trim(), is_public: isPublic });
      toast(isPublic ? 'Update sent to the reporter.' : 'Note added.');
      setMessage('');
      setError(null);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form-stack note-form" onSubmit={submit}>
      <TextField label="Add a note" multiline rows={2} value={message} onChange={(e) => setMessage(e.target.value)} error={error} />
      <div className="cluster" style={{ justifyContent: 'space-between' }}>
        <label className="checkline small">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
          Visible to the reporter (they will be notified)
        </label>
        <Button type="submit" size="sm" loading={busy}>
          <LuStickyNote aria-hidden /> Add note
        </Button>
      </div>
    </form>
  );
}

// The panel of next actions, which depends on the report's status.
function ActionPanel({ report: r, agencies, teams, reload }) {
  const { run, busy, error, setError } = useAction(r.id, reload);
  const [modal, setModal] = useState(null);
  const [verify, setVerify] = useState({ severity: r.severity, agency_id: r.agency_id ? String(r.agency_id) : '', note: '' });
  const [assign, setAssign] = useState({ team_id: '', due_date: '', instructions: '' });
  const awaiting = isAwaitingVerification(r);
  const activeTeams = teams.filter((t) => t.is_active);
  const close = () => {
    setModal(null);
    setError(null);
  };

  const closeOnOk = async (...args) => {
    if (await run(...args)) setModal(null);
  };

  const rejectDupButtons = ['submitted', 'under_review', 'verified'].includes(r.status) && (
    <div className="cluster">
      <Button variant="danger" size="sm" onClick={() => setModal('reject')}>
        <LuCircleX aria-hidden /> Reject
      </Button>
      <Button size="sm" onClick={() => setModal('duplicate')}>
        <LuCopy aria-hidden /> Mark as duplicate
      </Button>
    </div>
  );

  const assignForm = (label) => (
    <form
      className="form-stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (!assign.team_id) {
          setError({ message: 'Choose a maintenance team.', fields: { team_id: 'Choose a team.' } });
          return;
        }
        run(
          'assign',
          { team_id: Number(assign.team_id), due_date: assign.due_date || null, instructions: assign.instructions || null },
          `Assigned to ${activeTeams.find((t) => String(t.id) === assign.team_id)?.name}.`,
        );
      }}
    >
      {activeTeams.length === 0 ? (
        <Alert type="warn" title="No maintenance teams yet">
          <Link to="/admin/teams">Create a team</Link> before assigning repairs.
        </Alert>
      ) : (
        <>
          <div className="form-row form-row--2">
            <SelectField
              label="Maintenance team"
              value={assign.team_id}
              onChange={(e) => setAssign({ ...assign, team_id: e.target.value })}
              placeholder="Choose a team"
              error={error?.fields?.team_id}
              options={activeTeams
                .filter((t) => t.id !== r.active_assignment?.team_id)
                .map((t) => ({ value: String(t.id), label: `${t.name} (${t.active_tasks} active)` }))}
            />
            <TextField label="Due date" optional type="date" value={assign.due_date} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setAssign({ ...assign, due_date: e.target.value })} />
          </div>
          <TextField label="Instructions for the crew" optional multiline rows={2} value={assign.instructions} onChange={(e) => setAssign({ ...assign, instructions: e.target.value })} />
          <div>
            <Button type="submit" variant="primary" loading={busy === 'assign'}>
              <LuUsers aria-hidden /> {label}
            </Button>
          </div>
        </>
      )}
    </form>
  );

  let body = null;
  if (r.status === 'submitted') {
    body = (
      <>
        <p>Check the photos, location and severity, and look for possible duplicates before verifying.</p>
        <div className="cluster">
          <Button variant="primary" loading={busy === 'review'} onClick={() => run('review', {}, 'Review started. The reporter was notified.')}>
            <LuSearch aria-hidden /> Start review
          </Button>
        </div>
        {rejectDupButtons}
      </>
    );
  } else if (r.status === 'under_review') {
    body = (
      <>
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              'verify',
              { severity: verify.severity, agency_id: verify.agency_id ? Number(verify.agency_id) : null, note: verify.note || null },
              'Report verified. It now appears on the public map.',
            );
          }}
        >
          <div className="form-row form-row--2">
            <SelectField
              label="Confirmed severity"
              hint={`Reporter said: ${SEVERITY[r.reported_severity].label}`}
              value={verify.severity}
              onChange={(e) => setVerify({ ...verify, severity: e.target.value })}
              options={SEVERITY_OPTIONS}
            />
            <SelectField
              label="Responsible agency"
              hint="Who maintains this road"
              value={verify.agency_id}
              onChange={(e) => setVerify({ ...verify, agency_id: e.target.value })}
              placeholder="Not set"
              options={agencies.filter((a) => a.is_active).map((a) => ({ value: String(a.id), label: a.name }))}
            />
          </div>
          <TextField label="Internal note" optional value={verify.note} onChange={(e) => setVerify({ ...verify, note: e.target.value })} />
          <div>
            <Button type="submit" variant="primary" loading={busy === 'verify'}>
              <LuShieldCheck aria-hidden /> Verify report
            </Button>
          </div>
        </form>
        {rejectDupButtons}
      </>
    );
  } else if (r.status === 'verified') {
    body = (
      <>
        {assignForm('Assign repair')}
        {rejectDupButtons}
      </>
    );
  } else if (r.status === 'assigned' || r.status === 'in_progress') {
    body = (
      <>
        {awaiting && (
          <div className="completion-check">
            <Alert type="info" title={`Repair submitted ${timeAgo(r.work_completed_at)}`}>
              Compare the after photos with the reported damage, then close the report or send it back to the crew.
            </Alert>
            {(() => {
              const last = [...(r.repair_updates || [])].reverse().find((u) => u.update_type === 'completion');
              return last ? (
                <div className="completion-check__evidence">
                  <p>
                    <strong>{last.author_name || 'Crew'}:</strong> {last.note}
                  </p>
                  <PhotoGrid photos={last.photos} showKind />
                </div>
              ) : null;
            })()}
            <div className="cluster">
              <Button variant="primary" loading={busy === 'approve-completion'} onClick={() => run('approve-completion', {}, 'Repair verified. The report is resolved and the reporter was notified.')}>
                <LuCircleCheck aria-hidden /> Approve and close report
              </Button>
              <Button onClick={() => setModal('return')}>
                <LuUndo2 aria-hidden /> Send back to crew
              </Button>
            </div>
          </div>
        )}
        <p className="small">
          Assigned to <strong>{r.active_assignment?.team_name}</strong> {timeAgo(r.active_assignment?.assigned_at)}
          {r.active_assignment?.due_date ? `, due ${formatDate(r.active_assignment.due_date)}` : ''}.
        </p>
        <details className="reassign">
          <summary>Reassign to another team</summary>
          {assignForm('Reassign')}
        </details>
        {r.status === 'assigned' && (
          <Button size="sm" variant="ghost" onClick={() => setModal('unassign')}>
            <LuUserMinus aria-hidden /> Remove assignment
          </Button>
        )}
      </>
    );
  } else if (r.status === 'rejected' || r.status === 'duplicate') {
    body = (
      <>
        {r.status === 'rejected' && <Alert type="error" title="Rejected">{r.rejection_reason}</Alert>}
        {r.status === 'duplicate' && r.duplicate_of && (
          <Alert type="info" title="Duplicate">
            Tracked under <Link to={`/admin/reports/${r.duplicate_of.id}`}>{r.duplicate_of.code}</Link> ({STATUS[r.duplicate_of.status].label}).
          </Alert>
        )}
        <div>
          <Button onClick={() => setModal('reopen')}>
            <LuRotateCcw aria-hidden /> Reopen for review
          </Button>
        </div>
      </>
    );
  } else if (r.status === 'resolved') {
    body = <p>Resolved {formatDateTime(r.resolved_at)}. Resolved reports are final.</p>;
  }

  return (
    <section className="panel action-panel" aria-labelledby="next-title">
      <h2 id="next-title" className="section-title">
        Next step
      </h2>
      <div className="stack">
        {error && !modal && <Alert type="error">{error.message}</Alert>}
        {body}
      </div>
      {modal === 'reject' && (
        <ReasonModal
          title={`Reject ${r.code}`}
          label="Reason shown to the reporter"
          hint="Be specific, e.g. outside LGU jurisdiction, not a pothole, or photo does not match the location."
          confirm="Reject report"
          variant="danger"
          busy={busy === 'reject'}
          error={error}
          onClose={close}
          onSubmit={(reason) => closeOnOk('reject', { reason }, 'Report rejected. The reporter was notified.')}
        />
      )}
      {modal === 'duplicate' && (
        <DuplicateModal
          report={r}
          busy={busy === 'duplicate'}
          error={error}
          onClose={close}
          onSubmit={(id, note) => closeOnOk('duplicate', { duplicate_of_id: id, note }, 'Marked as duplicate.')}
        />
      )}
      {modal === 'return' && (
        <ReasonModal
          title="Send the repair back to the crew"
          label="What still needs to be done?"
          confirm="Send back"
          busy={busy === 'return-completion'}
          error={error}
          onClose={close}
          onSubmit={(reason) => closeOnOk('return-completion', { reason }, 'Sent back to the crew.')}
        />
      )}
      {modal === 'reopen' && (
        <ReasonModal
          title={`Reopen ${r.code}`}
          label="Why is it being reopened?"
          confirm="Reopen for review"
          busy={busy === 'review'}
          error={error}
          minLength={2}
          onClose={close}
          onSubmit={(note) => closeOnOk('review', { note }, 'Report reopened for review.')}
        />
      )}
      {modal === 'unassign' && (
        <ReasonModal
          title="Remove the team assignment"
          label="Reason (internal)"
          confirm="Remove assignment"
          variant="danger"
          busy={busy === 'unassign'}
          error={error}
          minLength={2}
          onClose={close}
          onSubmit={(note) => closeOnOk('unassign', { note }, 'Assignment removed. The report is back to Verified.')}
        />
      )}
    </section>
  );
}

export default function ReportReview() {
  const { id } = useParams();
  const { data, error, loading, reload } = useApi(`/api/reports/${id}`);
  const { data: agencies } = useApi('/api/admin/agencies');
  const { data: teams } = useApi('/api/admin/teams');
  const [editing, setEditing] = useState(false);
  const r = data?.report;
  useDocumentTitle(r ? `Review ${r.code}` : 'Review');

  if (error) return <div className="container page"><ErrorState error={error} onRetry={reload} /></div>;
  if ((loading && !r) || !agencies || !teams) return <Loading />;

  const awaiting = isAwaitingVerification(r);
  const closed = ['resolved', 'rejected', 'duplicate'].includes(r.status);
  const nearbyMarkers = [r, ...r.duplicate_candidates.map((c) => ({ ...c, id: `c${c.id}` }))];

  return (
    <div className="container page">
      <Link to="/admin/reports" className="back-link">
        <LuArrowLeft aria-hidden /> Reports
      </Link>
      <div className="detail-head">
        <div>
          <h1 className="numeral">{r.code}</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Reported {formatDateTime(r.created_at)} by {r.reporter.full_name}
          </p>
        </div>
        <div className="cluster">
          <StatusBadge status={r.status} awaiting={awaiting} />
          <SeverityBadge severity={r.severity} />
          {r.is_demo && <DemoTag />}
          {!closed && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <LuPencil aria-hidden /> Edit details
            </Button>
          )}
        </div>
      </div>

      <section className="panel progress-panel" aria-label="Progress">
        <RoadProgress status={r.status} awaiting={awaiting} />
      </section>

      <div className="split">
        <div className="stack">
          <ActionPanel report={r} agencies={agencies.items} teams={teams.items} reload={reload} />

          {r.duplicate_candidates.length > 0 && !closed && (
            <section className="panel dup-panel" aria-labelledby="dup-title">
              <h2 id="dup-title" className="section-title">
                <LuCopy aria-hidden /> Possible duplicates
              </h2>
              <p className="small muted">Open reports within the duplicate radius, ranked by distance, road name, barangay and date.</p>
              <ul className="dup-list">
                {r.duplicate_candidates.map((c) => (
                  <li key={c.id}>
                    <div>
                      <Link to={`/admin/reports/${c.id}`} className="numeral">
                        {c.code}
                      </Link>{' '}
                      <StatusBadge status={c.status} />
                      <span className={`likelihood likelihood--${c.likelihood}`}>{c.likelihood} match</span>
                    </div>
                    <div className="small muted">
                      {formatDistance(c.distance_m)} away, {c.road_name}
                      {c.landmark ? ` (${c.landmark})` : ''}, reported {formatDate(c.created_at)}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="panel" aria-labelledby="ph-title">
            <h2 id="ph-title" className="section-title">
              Photos
            </h2>
            <PhotoGrid photos={r.photos} showKind />
          </section>

          {r.repair_updates.length > 0 && (
            <section className="panel" aria-labelledby="ru-title">
              <h2 id="ru-title" className="section-title">
                Repair updates
              </h2>
              <ul className="updates">
                {[...r.repair_updates].reverse().map((u) => (
                  <li key={u.id} className={`update ${u.update_type === 'completion' ? 'update--done' : ''}`}>
                    <div className="update__head">
                      <strong>{u.update_type === 'completion' ? 'Repair completed' : 'Progress update'}</strong>
                      <span className="muted small">
                        {formatDateTime(u.created_at)} by {u.author_name}
                      </span>
                    </div>
                    <p>{u.note}</p>
                    {u.photos.length > 0 && <PhotoGrid photos={u.photos} showKind />}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="panel" aria-labelledby="hist-title">
            <h2 id="hist-title" className="section-title">
              History
            </h2>
            <NoteForm reportId={r.id} onSaved={reload} />
            <hr />
            <Timeline events={r.events} showActors />
          </section>
        </div>

        <div className="stack">
          <section className="panel" aria-labelledby="det-title">
            <h2 id="det-title" className="section-title">
              Report
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
                ['Reported severity', SEVERITY[r.reported_severity].label],
                ['Agency', r.agency?.name || 'Not set'],
                ['Location', `${formatCoords(r.latitude, r.longitude)} (${r.location_source === 'gps' ? `GPS${r.location_accuracy_m ? `, ±${Math.round(r.location_accuracy_m)} m` : ''}` : r.location_source === 'address' ? 'address search' : 'map pin'})`],
              ]}
            />
          </section>
          <MapView markers={nearbyMarkers} center={{ lat: r.latitude, lng: r.longitude }} zoom={18} height={300} selectedId={r.id} label={`Location of ${r.code} and nearby reports`} />
          <section className="panel" aria-labelledby="rep-title">
            <h2 id="rep-title" className="section-title">
              Reporter
            </h2>
            <Facts
              items={[
                ['Name', r.reporter.full_name],
                ['E-mail', <a key="e" href={`mailto:${r.reporter.email}`}><LuMail aria-hidden size={14} style={{ verticalAlign: '-2px' }} /> {r.reporter.email}</a>],
                ['Phone', r.reporter.phone ? <a key="p" href={`tel:${r.reporter.phone}`}><LuPhone aria-hidden size={14} style={{ verticalAlign: '-2px' }} /> {r.reporter.phone}</a> : null],
                ['Reports sent', r.reporter.report_count],
              ]}
            />
            <p className="small muted" style={{ marginTop: 8 }}>
              Personal details are for follow-up only and are not included in exports or the public map.
            </p>
          </section>
          {r.feedback && (
            <section className="panel">
              <h2 className="section-title">Reporter feedback</h2>
              <StaticStars value={r.feedback.rating} />
              {r.feedback.comment && <p style={{ marginTop: 8 }}>{r.feedback.comment}</p>}
            </section>
          )}
          {r.duplicates_of_this.length > 0 && (
            <section className="panel">
              <h2 className="section-title">Linked duplicates</h2>
              <ul className="plain-list">
                {r.duplicates_of_this.map((d) => (
                  <li key={d.id}>
                    <Link to={`/admin/reports/${d.id}`}>{d.code}</Link>, reported {formatDate(d.created_at)}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      {editing && (
        <EditModal
          report={r}
          agencies={agencies.items}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      )}
    </div>
  );
}
