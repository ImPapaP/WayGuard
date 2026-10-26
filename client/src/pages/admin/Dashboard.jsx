// Administrator dashboard (FR-14): headline figures, the work queues, trends,
// where and when potholes are reported, how fast they are fixed, and how each
// crew is doing. Every number links to the matching filtered list where one
// exists. Platform administrators see every LGU.
import { useState } from 'react';
import {
  LuDownload,
  LuTriangleAlert,
  LuStar,
  LuInbox,
  LuTrendingUp,
  LuGauge,
  LuTimer,
  LuMessageSquareReply,
  LuCalendarClock,
  LuCircleCheck,
  LuActivity,
} from 'react-icons/lu';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { qs } from '../../lib/api.js';
import { Link } from '../../lib/router.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { Alert, ErrorState, Loading, StatusBadge, SeverityBadge } from '../../components/ui.jsx';
import { BarList, PairedColumns, LineTrend, Columns, Heatmap, StatTile, SplitBar } from '../../components/Charts.jsx';
import MapView, { MapLegend } from '../../components/MapView.jsx';
import { STATUS, ALL_STATUSES, HAZARDS, ROAD_TYPES, timeAgo } from '../../lib/format.js';

const OPEN = 'submitted,under_review,verified,assigned,in_progress';
const QUEUE = [
  { key: 'pending_review', label: 'To review', hint: 'Submitted or under review', href: '/admin/reports?status=submitted,under_review' },
  { key: 'awaiting_assignment', label: 'To assign', hint: 'Verified, no team yet', href: '/admin/reports?status=verified' },
  { key: 'active_repairs', label: 'Being repaired', hint: 'Assigned or in progress', href: '/admin/reports?status=assigned,in_progress' },
  { key: 'awaiting_verification', label: 'To check', hint: 'Crew says it is fixed', href: '/admin/reports?awaiting_completion=true' },
  { key: 'resolved', label: 'Resolved', hint: 'Repair verified', href: '/admin/reports?status=resolved' },
];
const REPAIR_BUCKETS = [
  { label: '< 3 days', hint: 'Fixed in under 3 days' },
  { label: '3–7', hint: 'Fixed in 3 to 7 days' },
  { label: '7–14', hint: 'Fixed in 7 to 14 days' },
  { label: '14–30', hint: 'Fixed in 14 to 30 days' },
  { label: '30+', hint: 'Took 30 days or more' },
];
const PRESETS = [
  { key: '7', label: '7 days', days: 7 },
  { key: '30', label: '30 days', days: 30 },
  { key: '90', label: '90 days', days: 90 },
  { key: 'all', label: 'All time', days: null },
];

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-PH', { month: 'short' });
}
function dayLabels(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return {
    label: date.toLocaleString('en-PH', { month: 'short', day: 'numeric' }),
    long: date.toLocaleString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' }),
  };
}
function isoDay(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
function rangeFor(days) {
  if (!days) return { from: '', to: '' };
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));
  return { from: isoDay(from), to: isoDay(to) };
}
function pct(part, whole) {
  return whole ? Math.round((part / whole) * 100) : 0;
}

export default function Dashboard() {
  useDocumentTitle('Dashboard');
  const { user, config } = useAuth();
  const [preset, setPreset] = useState('all');
  const [range, setRange] = useState({ from: '', to: '' });
  const { data: s, error, loading, reload } = useApi(`/api/admin/stats${qs(range)}`);
  const { data: open } = useApi(`/api/admin/map?status=${OPEN}`);
  const isPlatform = user?.role === 'platform_admin';
  const filtered = Boolean(range.from || range.to);

  if (error) return <div className="container page"><ErrorState error={error} onRetry={reload} /></div>;

  const choosePreset = (p) => {
    setPreset(p.key);
    setRange(rangeFor(p.days));
  };
  const setDate = (k) => (e) => {
    setPreset('custom');
    setRange({ ...range, [k]: e.target.value });
  };

  // Older servers (and the browser-only preview) may not send every figure.
  if (s) {
    s.daily ||= [];
    s.repair_times ||= [];
    s.by_road_type ||= [];
    s.hazards ||= [];
    s.top_roads ||= [];
    s.when_reported ||= [];
    s.ratings ||= [];
    s.by_lgu ||= [];
  }
  const t = s?.totals;
  const weekDelta = t ? t.new_7d - t.new_prev_7d : 0;

  return (
    <div className="container page dash">
      <div className="page-head dash__head">
        <div>
          <p className="eyebrow">{isPlatform ? 'Platform administrator · every LGU' : user?.role === 'staff' ? 'LGU staff' : 'LGU administrator'}</p>
          <h1>Dashboard</h1>
          <p className="muted">{isPlatform ? 'All local government units on Wayguard' : user?.lgu_name || config?.lgu_name}</p>
        </div>
        <a className="btn btn--secondary btn--sm" href={`/api/admin/exports/summary.pdf${qs(range)}`} download>
          <LuDownload aria-hidden /> Summary PDF
        </a>
      </div>

      <div className="dash-filters" role="group" aria-label="Reporting period">
        <div className="segmented" role="radiogroup" aria-label="Quick period">
          {PRESETS.map((p) => (
            <button key={p.key} type="button" role="radio" aria-checked={preset === p.key} className={preset === p.key ? 'is-on' : ''} onClick={() => choosePreset(p)}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="dash-filters__dates">
          <input type="date" className="input input--sm" value={range.from} max={range.to || undefined} onChange={setDate('from')} aria-label="Reported from" />
          <span aria-hidden>to</span>
          <input type="date" className="input input--sm" value={range.to} min={range.from || undefined} onChange={setDate('to')} aria-label="Reported to" />
        </div>
        <span className="small muted dash-filters__note">
          {filtered ? 'Figures below cover reports made in this period.' : 'Showing all reports.'} Trends always show the latest 30 days and 6 months.
        </span>
      </div>

      {loading && !s ? (
        <Loading />
      ) : (
        <div className={`stack stack--lg${loading ? ' is-refreshing' : ''}`}>
          <section className="stat-tiles" aria-label="Headline figures">
            <StatTile icon={LuInbox} label="Open now" value={t.open} sub={`${t.total} reports in total`} href={`/admin/reports?status=${OPEN}`} />
            <StatTile
              icon={LuTrendingUp}
              label="New in the last 7 days"
              value={t.new_7d}
              sub={weekDelta === 0 ? 'Same as the week before' : `${weekDelta > 0 ? '▲' : '▼'} ${Math.abs(weekDelta)} vs the week before`}
              tone={weekDelta > 0 ? 'up' : weekDelta < 0 ? 'down' : undefined}
            />
            <StatTile icon={LuGauge} label="Resolution rate" value={t.resolution_rate} unit="%" sub={`${t.resolved} of ${t.total - t.closed_invalid} valid reports fixed`} />
            <StatTile icon={LuTimer} label="Typical repair time" value={t.median_resolution_days} unit=" days" sub={t.avg_resolution_days != null ? `Median · average ${t.avg_resolution_days} days` : 'No repairs yet'} />
            <StatTile icon={LuMessageSquareReply} label="First response" value={t.avg_first_response_hours} unit=" hrs" sub="Average time until the LGU acts" />
            <StatTile
              icon={LuCalendarClock}
              label="Overdue repairs"
              value={t.overdue_tasks}
              sub={t.overdue_tasks ? 'Past their due date' : 'All repairs on schedule'}
              tone={t.overdue_tasks ? 'warn' : 'good'}
              href={t.overdue_tasks ? '/admin/reports?status=assigned,in_progress&sort=oldest' : undefined}
            />
            <StatTile icon={LuCircleCheck} label="Fixed in the last 30 days" value={t.resolved_30d} sub="Repairs verified by the LGU" />
            <StatTile icon={LuStar} label="Citizen rating" value={s.feedback.average} unit="/5" sub={s.feedback.count ? `${s.feedback.count} rating${s.feedback.count > 1 ? 's' : ''}` : 'No ratings yet'} />
          </section>

          <section aria-label="Work queues">
            <ol className="queue">
              {QUEUE.map((q) => (
                <li key={q.key}>
                  <Link to={q.href} className={`queue__step ${q.key === 'pending_review' && t[q.key] ? 'queue__step--attention' : ''}`}>
                    <span className="queue__value numeral">{t[q.key]}</span>
                    <span className="queue__label">{q.label}</span>
                    <span className="queue__hint">{q.hint}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </section>

          {t.high_open_over_7_days > 0 && (
            <Alert type="warn" title={`${t.high_open_over_7_days} high-severity pothole${t.high_open_over_7_days > 1 ? 's have' : ' has'} been open for more than 7 days`}>
              <Link to={`/admin/reports?severity=high&status=${OPEN}&sort=oldest`}>Review them now</Link>
            </Alert>
          )}

          <div className="dash-grid">
            <section className="panel dash-grid__wide" aria-labelledby="daily-title">
              <div className="panel__head">
                <h2 id="daily-title">Last 30 days</h2>
                <span className="small muted">Reported and fixed each day</span>
              </div>
              <LineTrend
                label="Reports per day over the last 30 days: reported and resolved"
                aLabel="Reported"
                bLabel="Resolved"
                data={s.daily.map((d) => ({ key: d.day, ...dayLabels(d.day), a: d.reported, b: d.resolved }))}
              />
            </section>

            <section className="panel" aria-labelledby="trend-title">
              <div className="panel__head">
                <h2 id="trend-title">Per month</h2>
                <span className="small muted">Last 6 months</span>
              </div>
              <PairedColumns
                label="Reports per month: reported and resolved"
                aLabel="Reported"
                bLabel="Resolved"
                data={s.monthly.map((m) => ({ key: m.month, label: monthLabel(m.month), a: m.reported, b: m.resolved }))}
              />
            </section>

            <section className="panel" aria-labelledby="repair-title">
              <div className="panel__head">
                <h2 id="repair-title">How long repairs take</h2>
                <span className="small muted">From report to verified repair</span>
              </div>
              <Columns
                label="Resolved reports by time from report to verified repair"
                data={s.repair_times.map((b, i) => ({ key: b.bucket, label: REPAIR_BUCKETS[i]?.label, hint: REPAIR_BUCKETS[i]?.hint, value: b.n }))}
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
                  href: `/admin/reports?severity=${k}&status=${OPEN}`,
                }))}
              />
              <p className="small muted dash-note">
                {pct(s.by_severity.high?.open || 0, t.open)}% of open reports are high severity.
              </p>
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

            <section className="panel" aria-labelledby="road-title">
              <div className="panel__head">
                <h2 id="road-title">By road type</h2>
              </div>
              <BarList
                label="Reports by road type"
                items={s.by_road_type.map((r) => ({ key: r.road_type, label: ROAD_TYPES[r.road_type] || r.road_type, value: r.total }))}
              />
              <p className="small muted dash-note">Bar length is all reports; {s.by_road_type.reduce((n, r) => n + r.open, 0)} are still open.</p>
            </section>

            <section className="panel" aria-labelledby="hz-title">
              <div className="panel__head">
                <h2 id="hz-title">Most reported hazards</h2>
              </div>
              <BarList
                label="Hazards reported by citizens"
                emptyText="No hazards reported yet."
                items={s.hazards.map((h) => ({ key: h.hazard, label: HAZARDS[h.hazard] || h.hazard, value: h.n }))}
              />
            </section>

            <section className="panel dash-grid__span2" aria-labelledby="when-title">
              <div className="panel__head">
                <h2 id="when-title">When potholes are reported</h2>
                <span className="small muted">Day of the week and time of day</span>
              </div>
              <Heatmap label="Reports by day of week and time of day" cells={s.when_reported} />
            </section>

            <section className="panel" aria-labelledby="rating-title">
              <div className="panel__head">
                <h2 id="rating-title">Citizen ratings</h2>
              </div>
              <BarList
                label="Repair ratings from citizens"
                emptyText="No ratings yet."
                items={s.feedback.count ? s.ratings.map((r) => ({ key: r.rating, label: `${'★'.repeat(r.rating)}`, text: `${r.rating} star${r.rating > 1 ? 's' : ''}`, value: r.n })) : []}
              />
              <p className="feedback-line">
                <LuStar aria-hidden />{' '}
                {s.feedback.count ? <><strong>{s.feedback.average}/5</strong> average from {s.feedback.count} rating{s.feedback.count > 1 ? 's' : ''}</> : 'No ratings yet'}
              </p>
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

            <section className="panel dash-grid__span2" aria-labelledby="roads-title">
              <div className="panel__head">
                <h2 id="roads-title">Roads with the most potholes</h2>
                <span className="chart-legend chart-legend--inline" aria-hidden>
                  <span><i style={{ background: '#2B4F8A' }} /> Open</span>
                  <span><i style={{ background: '#B87800' }} /> Closed</span>
                </span>
              </div>
              {s.top_roads.length ? (
                <div className="table-wrap">
                  <table className="table table--compact dash-roads">
                    <thead>
                      <tr>
                        <th scope="col">Road</th>
                        <th scope="col" className="num">Open</th>
                        <th scope="col" className="num">High</th>
                        <th scope="col" className="num">Total</th>
                        <th scope="col"><span className="visually-hidden">Open and closed</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.top_roads.map((r) => (
                        <tr key={r.road_name}>
                          <td><Link to={`/admin/reports?q=${encodeURIComponent(r.road_name)}`}>{r.road_name}</Link></td>
                          <td className="num numeral">{r.open}</td>
                          <td className="num numeral">{r.open_high}</td>
                          <td className="num numeral">{r.total}</td>
                          <td className="dash-roads__bar"><SplitBar a={r.open} b={r.total - r.open} aLabel="open" bLabel="closed" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted small">No reports yet.</p>
              )}
            </section>

            <section className="panel dash-grid__wide" aria-labelledby="team-title">
              <div className="panel__head">
                <h2 id="team-title">Road crews</h2>
                <Link to="/admin/teams">Manage</Link>
              </div>
              {s.teams.length ? (
                <div className="table-wrap">
                  <table className="table table--compact">
                    <thead>
                      <tr>
                        <th scope="col">Team</th>
                        <th scope="col" className="num">Active</th>
                        <th scope="col" className="num">Overdue</th>
                        <th scope="col" className="num">Completed</th>
                        <th scope="col" className="num">Avg. days per repair</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.teams.map((tm) => (
                        <tr key={tm.id}>
                          <td><Link to={`/admin/reports?team_id=${tm.id}`}>{tm.name}</Link></td>
                          <td className="num numeral">{tm.active_tasks}</td>
                          <td className="num numeral">
                            {tm.overdue > 0 ? <span className="dash-overdue"><LuTriangleAlert aria-hidden /> {tm.overdue}</span> : 0}
                          </td>
                          <td className="num numeral">{tm.completed}</td>
                          <td className="num numeral">{tm.avg_repair_days ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted small">
                  No teams yet. <Link to="/admin/teams">Create a maintenance team</Link> to start assigning repairs.
                </p>
              )}
            </section>

            {s.by_lgu.length > 0 && (
              <section className="panel dash-grid__wide" aria-labelledby="lgu-title">
                <div className="panel__head">
                  <h2 id="lgu-title">Busiest LGUs</h2>
                  <span className="chart-legend chart-legend--inline" aria-hidden>
                    <span><i style={{ background: '#2B4F8A' }} /> Open</span>
                    <span><i style={{ background: '#B87800' }} /> Resolved, rejected or duplicate</span>
                  </span>
                </div>
                <div className="table-wrap">
                  <table className="table table--compact dash-roads">
                    <thead>
                      <tr>
                        <th scope="col">LGU</th>
                        <th scope="col" className="num">Open</th>
                        <th scope="col" className="num">Resolved</th>
                        <th scope="col" className="num">Total</th>
                        <th scope="col"><span className="visually-hidden">Open and closed</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.by_lgu.map((l) => (
                        <tr key={l.id}>
                          <td>{l.name}{l.province ? <span className="muted small"> · {l.province}</span> : null}</td>
                          <td className="num numeral">{l.open}</td>
                          <td className="num numeral">{l.resolved}</td>
                          <td className="num numeral">{l.total}</td>
                          <td className="dash-roads__bar"><SplitBar a={l.open} b={l.total - l.open} aLabel="open" bLabel="closed" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

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
                <h2 id="act-title"><LuActivity aria-hidden /> Recent activity</h2>
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
                            : a.event_type === 'feedback' || a.event_type === 'reassigned'
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
