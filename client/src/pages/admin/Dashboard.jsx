// Administrator dashboard (FR-14): the work queues, trends and where the
// open potholes are. Every number links to the matching filtered list.
import { useState } from 'react';
import { LuDownload, LuTriangleAlert, LuStar } from 'react-icons/lu';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { qs } from '../../lib/api.js';
import { Link } from '../../lib/router.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { Alert, ErrorState, Loading, StatusBadge, SeverityBadge } from '../../components/ui.jsx';
import { BarList, PairedColumns } from '../../components/Charts.jsx';
import MapView, { MapLegend } from '../../components/MapView.jsx';
import { STATUS, ALL_STATUSES, timeAgo } from '../../lib/format.js';

const QUEUE = [
  { key: 'pending_review', label: 'To review', hint: 'Submitted or under review', href: '/admin/reports?status=submitted,under_review' },
  { key: 'awaiting_assignment', label: 'To assign', hint: 'Verified, no team yet', href: '/admin/reports?status=verified' },
  { key: 'active_repairs', label: 'Being repaired', hint: 'Assigned or in progress', href: '/admin/reports?status=assigned,in_progress' },
  { key: 'awaiting_verification', label: 'To check', hint: 'Crew says it is fixed', href: '/admin/reports?awaiting_completion=true' },
  { key: 'resolved', label: 'Resolved', hint: 'Repair verified', href: '/admin/reports?status=resolved' },
];

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-PH', { month: 'short' });
}

export default function Dashboard() {
  useDocumentTitle('Dashboard');
  const { config } = useAuth();
  const [range, setRange] = useState({ from: '', to: '' });
  const { data: s, error, loading, reload } = useApi(`/api/admin/stats${qs(range)}`);
  const { data: open } = useApi('/api/admin/map?status=submitted,under_review,verified,assigned,in_progress');

  if (error) return <div className="container page"><ErrorState error={error} onRetry={reload} /></div>;

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>{config?.lgu_name}</p>
        </div>
        <form className="range" onSubmit={(e) => e.preventDefault()} aria-label="Reporting period">
          <label>
            <span className="visually-hidden">From</span>
            <input type="date" className="input input--sm" value={range.from} max={range.to || undefined} onChange={(e) => setRange({ ...range, from: e.target.value })} aria-label="Reported from" />
          </label>
          <span aria-hidden>to</span>
          <label>
            <span className="visually-hidden">To</span>
            <input type="date" className="input input--sm" value={range.to} min={range.from || undefined} onChange={(e) => setRange({ ...range, to: e.target.value })} aria-label="Reported to" />
          </label>
          {(range.from || range.to) && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setRange({ from: '', to: '' })}>
              All time
            </button>
          )}
          <a className="btn btn--secondary btn--sm" href={`/api/admin/exports/summary.pdf${qs(range)}`} download>
            <LuDownload aria-hidden /> Summary PDF
          </a>
        </form>
      </div>

      {loading && !s ? (
        <Loading />
      ) : (
        <div className="stack stack--lg">
          {s.demo_reports > 0 && (
            <p className="demo-note">
              Includes {s.demo_reports} demonstration reports created by the seed script. They are tagged “Demo” throughout.
            </p>
          )}

          <section aria-label="Work queues">
            <ol className="queue">
              {QUEUE.map((q) => (
                <li key={q.key}>
                  <Link to={q.href} className={`queue__step ${q.key === 'pending_review' && s.totals[q.key] ? 'queue__step--attention' : ''}`}>
                    <span className="queue__value numeral">{s.totals[q.key]}</span>
                    <span className="queue__label">{q.label}</span>
                    <span className="queue__hint">{q.hint}</span>
                  </Link>
                </li>
              ))}
            </ol>
            <p className="queue__foot">
              <span className="numeral">{s.totals.total}</span> reports in total
              {range.from || range.to ? ' in this period' : ''}, <span className="numeral">{s.totals.closed_invalid}</span> rejected
              or duplicate. Average time from report to verified repair:{' '}
              <strong>{s.totals.avg_resolution_days != null ? `${s.totals.avg_resolution_days} days` : 'no repairs yet'}</strong>.
            </p>
          </section>

          {s.totals.high_open_over_7_days > 0 && (
            <Alert type="warn" title={`${s.totals.high_open_over_7_days} high-severity pothole${s.totals.high_open_over_7_days > 1 ? 's have' : ' has'} been open for more than 7 days`}>
              <Link to="/admin/reports?severity=high&status=submitted,under_review,verified,assigned,in_progress&sort=oldest">Review them now</Link>
            </Alert>
          )}

          <div className="dash-grid">
            <section className="panel dash-grid__wide" aria-labelledby="trend-title">
              <div className="panel__head">
                <h2 id="trend-title">Reported and resolved per month</h2>
              </div>
              <PairedColumns
                label="Reports per month: reported and resolved"
                aLabel="Reported"
                bLabel="Resolved"
                data={s.monthly.map((m) => ({ key: m.month, label: monthLabel(m.month), a: m.reported, b: m.resolved }))}
              />
            </section>

            <section className="panel" aria-labelledby="sev-title">
              <div className="panel__head">
                <h2 id="sev-title">Open by severity</h2>
              </div>
              <BarList
                label="Open reports by severity"
                items={['high', 'medium', 'low'].map((k) => ({
                  key: k,
                  label: <SeverityBadge severity={k} />,
                  text: `${k[0].toUpperCase()}${k.slice(1)} severity`,
                  value: s.by_severity[k]?.open || 0,
                  href: `/admin/reports?severity=${k}&status=submitted,under_review,verified,assigned,in_progress`,
                }))}
              />
            </section>

            <section className="panel" aria-labelledby="status-title">
              <div className="panel__head">
                <h2 id="status-title">Reports by status</h2>
              </div>
              <BarList
                label="Reports by status"
                items={ALL_STATUSES.map((k) => ({ label: STATUS[k].label, value: s.by_status[k] || 0, href: `/admin/reports?status=${k}` }))}
              />
            </section>

            <section className="panel" aria-labelledby="brgy-title">
              <div className="panel__head">
                <h2 id="brgy-title">Open reports by barangay</h2>
              </div>
              <BarList
                label="Open reports by barangay"
                emptyText="No open reports."
                items={s.top_barangays.map((b) => ({
                  label: b.barangay,
                  value: b.open,
                  href: b.barangay === 'Unspecified' ? undefined : `/admin/reports?barangay=${encodeURIComponent(b.barangay)}`,
                }))}
              />
            </section>

            <section className="panel" aria-labelledby="team-title">
              <div className="panel__head">
                <h2 id="team-title">Maintenance teams</h2>
                <Link to="/admin/teams">Manage</Link>
              </div>
              {s.teams.length ? (
                <table className="table table--compact">
                  <thead>
                    <tr>
                      <th scope="col">Team</th>
                      <th scope="col">Active</th>
                      <th scope="col">Completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.teams.map((t) => (
                      <tr key={t.id}>
                        <td>
                          <Link to={`/admin/reports?team_id=${t.id}`}>{t.name}</Link>
                        </td>
                        <td className="numeral">{t.active_tasks}</td>
                        <td className="numeral">{t.completed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted small">
                  No teams yet. <Link to="/admin/teams">Create a maintenance team</Link> to start assigning repairs.
                </p>
              )}
              <p className="feedback-line">
                <LuStar aria-hidden /> Reporter feedback:{' '}
                {s.feedback.count ? (
                  <>
                    <strong>{s.feedback.average}/5</strong> average from {s.feedback.count} rating{s.feedback.count > 1 ? 's' : ''}
                  </>
                ) : (
                  'no ratings yet'
                )}
              </p>
            </section>

            <section className="panel panel--flush dash-grid__wide" aria-labelledby="map-title">
              <div className="panel__head panel__head--pad">
                <h2 id="map-title">Open potholes</h2>
                <Link to="/admin/map">Open map</Link>
              </div>
              <MapView markers={open?.items || []} fitToMarkers={(open?.items?.length || 0) > 1} height={320} label="Map of open pothole reports" />
              <div style={{ padding: '0 16px' }}>
                <MapLegend />
              </div>
            </section>

            <section className="panel dash-grid__wide" aria-labelledby="act-title">
              <div className="panel__head">
                <h2 id="act-title">Recent activity</h2>
              </div>
              {s.recent_activity.length ? (
                <ul className="activity">
                  {s.recent_activity.map((a) => (
                    <li key={a.id}>
                      <Link to={`/admin/reports/${a.report_id}`} className="numeral">
                        {a.code}
                      </Link>
                      <span className="activity__what">
                        {a.event_type === 'created'
                          ? 'New report submitted'
                          : a.event_type === 'repair_completed'
                            ? 'Repair submitted for checking'
                            : a.event_type === 'feedback'
                              ? a.message
                              : a.event_type === 'reassigned'
                                ? a.message
                                : <>Moved to <StatusBadge status={a.to_status} /></>}
                      </span>
                      <span className="activity__who">
                        {a.actor_name || 'System'}, {timeAgo(a.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No activity yet.</p>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
