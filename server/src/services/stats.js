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
  const reportScope = lguId === null || lguId === undefined
    ? sql`TRUE`
    : Array.isArray(lguId)
      ? sql`r.lgu_id = ANY(${lguId})`
      : sql`r.lgu_id = ${lguId}`;
  const teamScope = lguId === null || lguId === undefined
    ? sql`TRUE`
    : Array.isArray(lguId)
      ? sql`t.lgu_id = ANY(${lguId})`
      : sql`t.lgu_id = ${lguId}`;
  const inRange = sql`${reportScope} AND ${rangeCondition(query)}`;

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
        WHERE ${reportScope}
          AND date_trunc('month', r.created_at AT TIME ZONE ${tz}) = m) AS reported,
      (SELECT count(*)::int FROM reports r
        WHERE r.status = 'resolved' AND ${reportScope}
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
    WHERE t.is_active AND ${teamScope}
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
      AND ${reportScope}
    ORDER BY e.created_at DESC, e.id DESC LIMIT 8`;

  // ---- Extra dashboard figures ---------------------------------------------
  const OPEN = sql`r.status IN ('submitted', 'under_review', 'verified', 'assigned', 'in_progress')`;
  const [extra] = await sql`
    SELECT
      count(*) FILTER (WHERE ${OPEN})::int AS open,
      count(*) FILTER (WHERE r.created_at >= now() - interval '7 days')::int AS new_7d,
      count(*) FILTER (WHERE r.created_at >= now() - interval '14 days' AND r.created_at < now() - interval '7 days')::int AS new_prev_7d,
      count(*) FILTER (WHERE r.status = 'resolved' AND r.resolved_at >= now() - interval '30 days')::int AS resolved_30d,
      round((percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (r.resolved_at - r.created_at)) / 86400)
             FILTER (WHERE r.status = 'resolved'))::numeric, 1)::float AS median_resolution_days
    FROM reports r WHERE ${inRange}`;
  const [response] = await sql`
    SELECT round((avg(EXTRACT(EPOCH FROM (first_action - r.created_at)) / 3600))::numeric, 1)::float AS avg_first_response_hours,
           count(*)::int AS responded
    FROM reports r
    JOIN LATERAL (
      SELECT min(e.created_at) AS first_action FROM report_events e
      WHERE e.report_id = r.id AND e.event_type = 'status_changed'
    ) fa ON fa.first_action IS NOT NULL
    WHERE ${inRange}`;
  const [overdue] = await sql`
    SELECT count(*)::int AS n FROM assignments a JOIN reports r ON r.id = a.report_id
    WHERE a.is_active AND a.due_date IS NOT NULL AND a.due_date < (now() AT TIME ZONE ${tz})::date AND ${reportScope}`;

  // Last 30 days, one row per local day.
  const daily = await sql`
    WITH days AS (
      SELECT generate_series((now() AT TIME ZONE ${tz})::date - 29, (now() AT TIME ZONE ${tz})::date, interval '1 day')::date AS d
    )
    SELECT to_char(d, 'YYYY-MM-DD') AS day,
      (SELECT count(*)::int FROM reports r WHERE ${reportScope} AND (r.created_at AT TIME ZONE ${tz})::date = d) AS reported,
      (SELECT count(*)::int FROM reports r WHERE ${reportScope} AND r.status = 'resolved' AND (r.resolved_at AT TIME ZONE ${tz})::date = d) AS resolved
    FROM days ORDER BY d`;

  const repairTimes = await sql`
    SELECT bucket, count(*)::int AS n FROM (
      SELECT CASE
        WHEN d < 3 THEN 0 WHEN d < 7 THEN 1 WHEN d < 14 THEN 2 WHEN d < 30 THEN 3 ELSE 4 END AS bucket
      FROM (SELECT EXTRACT(EPOCH FROM (r.resolved_at - r.created_at)) / 86400 AS d
            FROM reports r WHERE r.status = 'resolved' AND r.resolved_at IS NOT NULL AND ${inRange}) x
    ) y GROUP BY bucket ORDER BY bucket`;

  const byRoadType = await sql`
    SELECT r.road_type, count(*)::int AS total, count(*) FILTER (WHERE ${OPEN})::int AS open
    FROM reports r WHERE ${inRange} GROUP BY r.road_type ORDER BY total DESC`;

  const hazards = await sql`
    SELECT h AS hazard, count(*)::int AS n
    FROM reports r, unnest(r.hazards) AS h WHERE ${inRange}
    GROUP BY h ORDER BY n DESC, h LIMIT 8`;

  const topRoads = await sql`
    SELECT r.road_name, count(*)::int AS total, count(*) FILTER (WHERE ${OPEN})::int AS open,
           count(*) FILTER (WHERE ${OPEN} AND r.severity = 'high')::int AS open_high
    FROM reports r WHERE ${inRange} AND coalesce(r.road_name, '') <> ''
    GROUP BY r.road_name ORDER BY open DESC, total DESC, r.road_name LIMIT 8`;

  const whenReported = await sql`
    SELECT EXTRACT(ISODOW FROM r.created_at AT TIME ZONE ${tz})::int AS dow,
           (EXTRACT(HOUR FROM r.created_at AT TIME ZONE ${tz})::int / 3) AS slot,
           count(*)::int AS n
    FROM reports r WHERE ${inRange} GROUP BY 1, 2`;

  const ratings = await sql`
    SELECT f.rating, count(*)::int AS n
    FROM feedback f JOIN reports r ON r.id = f.report_id WHERE ${inRange}
    GROUP BY f.rating ORDER BY f.rating DESC`;

  const teamPerformance = await sql`
    SELECT t.id,
      (SELECT count(*)::int FROM assignments a WHERE a.team_id = t.id AND a.is_active
         AND a.due_date IS NOT NULL AND a.due_date < (now() AT TIME ZONE ${tz})::date) AS overdue,
      (SELECT round(avg(EXTRACT(EPOCH FROM (a.ended_at - a.assigned_at)) / 86400)::numeric, 1)::float
         FROM assignments a JOIN reports r ON r.id = a.report_id
         WHERE a.team_id = t.id AND a.end_reason = 'completed' AND a.ended_at IS NOT NULL AND ${inRange}) AS avg_repair_days
    FROM maintenance_teams t WHERE t.is_active AND ${teamScope}`;
  const perf = new Map(teamPerformance.map((t) => [t.id, t]));

  // Only meaningful when the account covers more than one LGU.
  const multiLgu = Array.isArray(lguId) ? lguId.length > 1 : lguId == null;
  const byLgu = multiLgu
    ? await sql`
        SELECT l.id, l.name, l.province, count(*)::int AS total,
               count(*) FILTER (WHERE ${OPEN})::int AS open,
               count(*) FILTER (WHERE r.status = 'resolved')::int AS resolved
        FROM reports r JOIN lgus l ON l.id = r.lgu_id
        WHERE ${inRange}
        GROUP BY l.id, l.name, l.province ORDER BY total DESC, l.name LIMIT 10`
    : [];

  const [demo] = await sql`
    SELECT count(*)::int AS n FROM reports r
    WHERE r.is_demo AND ${reportScope}`;

  return {
    generated_at: new Date().toISOString(),
    range: { from: query.from || null, to: query.to || null },
    totals: {
      ...totals,
      ...extra,
      avg_first_response_hours: response.avg_first_response_hours,
      overdue_tasks: overdue.n,
      resolution_rate: totals.total - totals.closed_invalid > 0
        ? Math.round((totals.resolved / (totals.total - totals.closed_invalid)) * 100)
        : null,
    },
    by_status: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
    by_severity: Object.fromEntries(bySeverity.map((r) => [r.severity, { total: r.total, open: r.open }])),
    monthly,
    top_barangays: topBarangays,
    teams: teams.map((t) => ({ ...t, overdue: perf.get(t.id)?.overdue ?? 0, avg_repair_days: perf.get(t.id)?.avg_repair_days ?? null })),
    daily,
    repair_times: [0, 1, 2, 3, 4].map((b) => ({ bucket: b, n: repairTimes.find((x) => x.bucket === b)?.n ?? 0 })),
    by_road_type: byRoadType,
    hazards,
    top_roads: topRoads,
    when_reported: whenReported,
    ratings: [5, 4, 3, 2, 1].map((n) => ({ rating: n, n: ratings.find((x) => x.rating === n)?.n ?? 0 })),
    by_lgu: byLgu,
    feedback,
    recent_activity: recent,
    demo_reports: demo.n,
  };
}
