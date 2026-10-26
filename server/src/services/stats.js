// Dashboard statistics. Every figure is computed live from the database;
// see docs/04-api.md for the definition of each metric.
import { sql } from '../db/index.js';
import { config } from '../config.js';

function rangeCondition(query, column = sql`r.created_at`) {
  const conds = [];
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.from || '')) conds.push(sql`${column} >= ${query.from}::date`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.to || '')) conds.push(sql`${column} < (${query.to}::date + 1)`);
  return conds.reduce((acc, c) => sql`${acc} AND ${c}`, sql`TRUE`);
}

export async function computeStats(query = {}, lguId = null) {
  const tz = config.timezone;
  const inRange = sql`${lguId === null || lguId === undefined ? sql`TRUE` : sql`r.lgu_id = ${lguId}`} AND ${rangeCondition(query)}`;

  const [totals] = await sql`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE status IN ('submitted', 'under_review'))::int AS pending_review,
      count(*) FILTER (WHERE status = 'verified')::int AS awaiting_assignment,
      count(*) FILTER (WHERE status IN ('assigned', 'in_progress'))::int AS active_repairs,
      count(*) FILTER (WHERE status = 'in_progress' AND work_completed_at IS NOT NULL)::int AS awaiting_verification,
      count(*) FILTER (WHERE status = 'resolved')::int AS resolved,
      count(*) FILTER (WHERE status IN ('rejected', 'duplicate'))::int AS closed_invalid,
      count(*) FILTER (WHERE status IN ('submitted', 'under_review', 'verified', 'assigned', 'in_progress')
                         AND severity = 'high' AND created_at < now() - interval '7 days')::int AS high_open_over_7_days,
      round((avg(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 86400)
             FILTER (WHERE status = 'resolved'))::numeric, 1)::float AS avg_resolution_days
    FROM reports r WHERE ${inRange}`;

  const byStatus = await sql`
    SELECT status, count(*)::int AS n FROM reports r WHERE ${inRange} GROUP BY status`;
  const bySeverity = await sql`
    SELECT severity,
           count(*)::int AS total,
           count(*) FILTER (WHERE status IN ('submitted', 'under_review', 'verified', 'assigned', 'in_progress'))::int AS open
    FROM reports r WHERE ${inRange} GROUP BY severity`;

  // Six calendar months (local time) ending with the current month.
  const monthly = await sql`
    WITH months AS (
      SELECT generate_series(
        date_trunc('month', (now() AT TIME ZONE ${tz})) - interval '5 months',
        date_trunc('month', (now() AT TIME ZONE ${tz})),
        interval '1 month') AS m
    )
    SELECT to_char(m, 'YYYY-MM') AS month,
      (SELECT count(*)::int FROM reports r
        WHERE (${lguId}::int IS NULL OR r.lgu_id = ${lguId})
          AND date_trunc('month', r.created_at AT TIME ZONE ${tz}) = m) AS reported,
      (SELECT count(*)::int FROM reports r
        WHERE r.status = 'resolved' AND (${lguId}::int IS NULL OR r.lgu_id = ${lguId})
          AND date_trunc('month', r.resolved_at AT TIME ZONE ${tz}) = m) AS resolved
    FROM months ORDER BY m`;

  const topBarangays = await sql`
    SELECT COALESCE(NULLIF(barangay, ''), 'Unspecified') AS barangay,
           count(*)::int AS open
    FROM reports r
    WHERE status IN ('submitted', 'under_review', 'verified', 'assigned', 'in_progress') AND ${inRange}
    GROUP BY 1 ORDER BY open DESC, barangay LIMIT 8`;

  const teams = await sql`
    SELECT t.id, t.name,
      (SELECT count(*)::int FROM assignments a WHERE a.team_id = t.id AND a.is_active) AS active_tasks,
      (SELECT count(*)::int FROM assignments a JOIN reports r ON r.id = a.report_id
        WHERE a.team_id = t.id AND a.end_reason = 'completed' AND ${inRange}) AS completed
    FROM maintenance_teams t
    WHERE t.is_active AND (${lguId}::int IS NULL OR t.lgu_id = ${lguId})
    ORDER BY t.name`;

  const [feedback] = await sql`
    SELECT count(*)::int AS count, round(avg(f.rating)::numeric, 2)::float AS average
    FROM feedback f JOIN reports r ON r.id = f.report_id WHERE ${inRange}`;

  const recent = await sql`
    SELECT e.id, e.event_type, e.to_status, e.message, e.created_at, r.id AS report_id, r.code,
           u.full_name AS actor_name
    FROM report_events e
    JOIN reports r ON r.id = e.report_id
    LEFT JOIN users u ON u.id = e.actor_id
    WHERE e.event_type IN ('created', 'status_changed', 'repair_completed', 'reassigned', 'feedback')
      AND (${lguId}::int IS NULL OR r.lgu_id = ${lguId})
    ORDER BY e.created_at DESC, e.id DESC LIMIT 8`;

  const [demo] = await sql`
    SELECT count(*)::int AS n FROM reports
    WHERE is_demo AND (${lguId}::int IS NULL OR lgu_id = ${lguId})`;

  return {
    generated_at: new Date().toISOString(),
    range: { from: query.from || null, to: query.to || null },
    totals,
    by_status: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
    by_severity: Object.fromEntries(bySeverity.map((r) => [r.severity, { total: r.total, open: r.open }])),
    monthly,
    top_barangays: topBarangays,
    teams,
    feedback,
    recent_activity: recent,
    demo_reports: demo.n,
  };
}
