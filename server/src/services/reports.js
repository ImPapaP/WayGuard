// Pothole report data access: creation, duplicate detection, permission
// checks and the role-specific shapes returned by the API.
import { isLguManager } from '../middleware/auth.js';
import { sql } from '../db/index.js';
import { forbidden, notFound } from '../lib/http.js';
import { getSettings } from './settings.js';

export const OPEN_STATUSES = ['submitted', 'under_review', 'verified', 'assigned', 'in_progress'];
export const PUBLIC_STATUSES = ['verified', 'assigned', 'in_progress', 'resolved'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function photoUrls(id) {
  return { url: `/api/photos/${id}`, thumb_url: `/api/photos/${id}?size=thumb` };
}

export async function nextReportCode(db) {
  const [{ n }] = await db`SELECT nextval('report_code_seq')::int AS n`;
  return `WG-${new Date().getFullYear()}-${String(n).padStart(5, '0')}`;
}

export async function recordEvent(db, { reportId, actorId = null, type, from = null, to = null, message = null, isPublic = true, meta = {} }) {
  await db`
    INSERT INTO report_events (report_id, actor_id, event_type, from_status, to_status, message, is_public, meta)
    VALUES (${reportId}, ${actorId}, ${type}, ${from}, ${to}, ${message}, ${isPublic}, ${db.json(meta)})`;
}

export function escapeLike(s) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// Rough metres -> degrees conversion used for a bounding-box pre-filter
// before the exact haversine distance is computed.
function degreeBox(lat, metres) {
  const dLat = metres / 111_320;
  const dLng = metres / (111_320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return { dLat, dLng };
}

// Generic road-type words carry no identifying information ("Rizal St." and
// "Rizal Street" are the same road), so they are ignored when comparing.
const ROAD_WORDS = new Set(['st', 'street', 'ave', 'avenue', 'rd', 'road', 'hwy', 'highway', 'blvd', 'boulevard', 'dr', 'drive', 'ext', 'extension']);

function normalizeRoad(s) {
  const tokens = String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const meaningful = tokens.filter((t) => !ROAD_WORDS.has(t));
  return meaningful.length ? meaningful : tokens;
}

function tokenSimilarity(a, b) {
  const A = new Set(normalizeRoad(a));
  const B = new Set(normalizeRoad(b));
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const t of A) if (B.has(t)) common += 1;
  return common / new Set([...A, ...B]).size;
}

// Scores how likely `candidate` describes the same pothole as `subject`,
// using proximity, road name, barangay and time between reports.
export function duplicateScore(subject, candidate, radiusM, windowDays) {
  // Quadratic fall-off: reports within half the radius score close to 1.
  const distanceScore = Math.max(0, 1 - (candidate.distance_m / radiusM) ** 2);
  const roadScore = tokenSimilarity(subject.road_name, candidate.road_name);
  const brgyScore =
    subject.barangay && candidate.barangay && subject.barangay.toLowerCase() === candidate.barangay.toLowerCase() ? 1 : 0;
  const days = Math.abs(new Date(subject.created_at || Date.now()) - new Date(candidate.created_at)) / 86_400_000;
  const timeScore = Math.max(0, 1 - days / windowDays);
  const score = 0.6 * distanceScore + 0.25 * roadScore + 0.1 * brgyScore + 0.05 * timeScore;
  return Math.round(score * 100) / 100;
}

export function likelihood(score) {
  if (score >= 0.7) return 'high';
  if (score >= 0.45) return 'medium';
  return 'low';
}

// Finds open (not rejected/duplicate/resolved) reports near a point.
export async function findDuplicateCandidates(db, { lat, lng, roadName, barangay, createdAt = null, excludeId = null, radiusM, windowDays, limit = 10, lguId = null }) {
  const { dLat, dLng } = degreeBox(lat, radiusM);
  const rows = await db`
    SELECT * FROM (
      SELECT r.id, r.code, r.status, r.severity, r.road_name, r.barangay, r.landmark, r.created_at,
             r.latitude, r.longitude,
             wg_distance_m(${lat}, ${lng}, r.latitude, r.longitude) AS distance_m
      FROM reports r
      WHERE (${lguId}::int IS NULL OR r.lgu_id = ${lguId})
        AND r.latitude BETWEEN ${lat - dLat} AND ${lat + dLat}
        AND r.longitude BETWEEN ${lng - dLng} AND ${lng + dLng}
        AND r.status NOT IN ('rejected', 'duplicate', 'resolved')
        AND (${excludeId}::int IS NULL OR r.id <> ${excludeId}::int)
        AND r.created_at >= COALESCE(${createdAt}::timestamptz, now()) - make_interval(days => ${windowDays})
        AND r.created_at <= COALESCE(${createdAt}::timestamptz, now()) + make_interval(days => ${windowDays})
    ) c
    WHERE c.distance_m <= ${radiusM}
    ORDER BY c.distance_m
    LIMIT ${limit}`;
  const subject = { road_name: roadName, barangay, created_at: createdAt };
  return rows
    .map((c) => {
      const score = duplicateScore(subject, c, radiusM, windowDays);
      return { ...c, distance_m: Math.round(c.distance_m * 10) / 10, score, likelihood: likelihood(score) };
    })
    .sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------
export async function loadReportRow(db, id, { lock = false } = {}) {
  const rows = lock
    ? await db`SELECT * FROM reports WHERE id = ${id} FOR UPDATE`
    : await db`SELECT * FROM reports WHERE id = ${id}`;
  if (!rows.length) throw notFound('Report not found.');
  return rows[0];
}

// Maintenance staff may see reports that are (or were) assigned to their team.
export async function teamHasAssignment(db, reportId, teamId, { activeOnly = false } = {}) {
  if (!teamId) return false;
  const rows = activeOnly
    ? await db`SELECT 1 FROM assignments WHERE report_id = ${reportId} AND team_id = ${teamId} AND is_active`
    : await db`SELECT 1 FROM assignments WHERE report_id = ${reportId} AND team_id = ${teamId}`;
  return rows.length > 0;
}

export async function assertCanView(db, user, report) {
  // Check the live server-resolved jurisdiction scope before role-specific
  // access. An assigned parent jurisdiction may view descendants, but never
  // an unrelated tenant's private data.
  const allowed = user.role === 'platform_admin' ||
    (Array.isArray(user.accessible_lgu_ids)
      ? user.accessible_lgu_ids.includes(report.lgu_id)
      : user.lgu_id === report.lgu_id);
  if (!allowed) throw notFound('Report not found.');
  if (isLguManager(user)) return;
  if (user.role === 'citizen' && report.reporter_id === user.id) return;
  if (user.role === 'maintenance' && (await teamHasAssignment(db, report.id, user.team_id))) return;
  // Respond with 404 rather than 403 so report IDs cannot be probed.
  throw notFound('Report not found.');
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------
function baseShape(r) {
  return {
    id: r.id,
    code: r.code,
    status: r.status,
    severity: r.severity,
    reported_severity: r.reported_severity,
    description: r.description,
    road_name: r.road_name,
    barangay: r.barangay,
    city: r.city,
    landmark: r.landmark,
    hazards: r.hazards,
    road_type: r.road_type,
    latitude: r.latitude,
    longitude: r.longitude,
    location_source: r.location_source,
    location_accuracy_m: r.location_accuracy_m,
    rejection_reason: r.rejection_reason,
    work_completed_at: r.work_completed_at,
    verified_at: r.verified_at,
    resolved_at: r.resolved_at,
    is_demo: r.is_demo,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export function publicShape(r) {
  return {
    id: r.id,
    code: r.code,
    status: r.status,
    severity: r.severity,
    description: r.description,
    road_name: r.road_name,
    barangay: r.barangay,
    city: r.city,
    landmark: r.landmark,
    latitude: r.latitude,
    longitude: r.longitude,
    created_at: r.created_at,
    updated_at: r.updated_at,
    resolved_at: r.resolved_at,
    is_demo: r.is_demo,
  };
}

export async function getReportDetail(db, id, user) {
  const r = await loadReportRow(db, id);
  await assertCanView(db, user, r);
  const isAdmin = isLguManager(user) &&
    (Array.isArray(user.accessible_lgu_ids) ? user.accessible_lgu_ids.includes(r.lgu_id) : user.lgu_id === r.lgu_id);
  const isStaff = isAdmin || user.role === 'maintenance';

  const [agency] = r.agency_id
    ? await db`SELECT id, name, jurisdiction, contact_email, contact_phone FROM agencies WHERE id = ${r.agency_id}`
    : [];
  const [duplicateOf] = r.duplicate_of_id
    ? await db`SELECT id, code, status FROM reports WHERE id = ${r.duplicate_of_id}`
    : [];

  const photos = (
    await db`
      SELECT id, kind, repair_update_id, width, height, created_at
      FROM report_photos WHERE report_id = ${r.id} ORDER BY created_at, id`
  ).map((p) => ({ ...p, ...photoUrls(p.id) }));

  const events = await db`
    SELECT e.id, e.event_type, e.from_status, e.to_status, e.message, e.is_public, e.meta, e.created_at,
           CASE WHEN ${isStaff} THEN u.full_name ELSE NULL END AS actor_name,
           u.role AS actor_role
    FROM report_events e
    LEFT JOIN users u ON u.id = e.actor_id
    WHERE e.report_id = ${r.id} AND (${isStaff} OR e.is_public)
    ORDER BY e.created_at, e.id`;

  const assignments = await db`
    SELECT a.id, a.team_id, t.name AS team_name, a.instructions, a.due_date, a.is_active,
           a.assigned_at, a.ended_at, a.end_reason, ub.full_name AS assigned_by_name
    FROM assignments a
    JOIN maintenance_teams t ON t.id = a.team_id
    LEFT JOIN users ub ON ub.id = a.assigned_by
    WHERE a.report_id = ${r.id}
    ORDER BY a.assigned_at DESC`;
  const active = assignments.find((a) => a.is_active) || null;

  const [feedback] = await db`
    SELECT rating, comment, created_at FROM feedback WHERE report_id = ${r.id}`;

  const detail = {
    ...baseShape(r),
    agency: agency || null,
    duplicate_of: duplicateOf || null,
    photos,
    events,
    active_assignment: active
      ? { team_id: active.team_id, team_name: active.team_name, due_date: active.due_date, assigned_at: active.assigned_at }
      : null,
    feedback: feedback || null,
    can_give_feedback: user.role === 'citizen' && r.reporter_id === user.id && r.status === 'resolved' && !feedback,
  };

  if (isStaff) {
    detail.assignments = assignments;
    if (active) detail.active_assignment.instructions = active.instructions;
    detail.repair_updates = (
      await db`
        SELECT ru.id, ru.update_type, ru.note, ru.created_at, u.full_name AS author_name
        FROM repair_updates ru LEFT JOIN users u ON u.id = ru.author_id
        WHERE ru.report_id = ${r.id}
        ORDER BY ru.created_at, ru.id`
    ).map((u) => ({ ...u, photos: photos.filter((p) => p.repair_update_id === u.id) }));
  }

  if (isAdmin) {
    const [reporter] = await db`
      SELECT id, full_name, email, phone, created_at,
             (SELECT count(*)::int FROM reports WHERE reporter_id = users.id) AS report_count
      FROM users WHERE id = ${r.reporter_id}`;
    detail.reporter = reporter;
    detail.agency_id = r.agency_id;
    const settings = await getSettings(db, r.lgu_id);
    detail.duplicate_candidates = await findDuplicateCandidates(db, {
      lat: r.latitude,
      lng: r.longitude,
      roadName: r.road_name,
      barangay: r.barangay,
      createdAt: r.created_at,
      excludeId: r.id,
      radiusM: settings.duplicate_radius_m,
      windowDays: settings.duplicate_window_days,
      lguId: r.lgu_id,
    });
    detail.duplicates_of_this = await db`
      SELECT id, code, status, created_at FROM reports WHERE duplicate_of_id = ${r.id} ORDER BY created_at`;
  }

  if (user.role === 'maintenance') {
    detail.is_active_for_my_team = await teamHasAssignment(db, r.id, user.team_id, { activeOnly: true });
  }
  return detail;
}

// Admin list filters shared by the reports table, the map and exports.
export function adminFilters(query, lguId = null) {
  const conds = [];
  if (Array.isArray(lguId)) conds.push(sql`r.lgu_id = ANY(${lguId})`);
  else if (lguId !== null && lguId !== undefined) conds.push(sql`r.lgu_id = ${lguId}`);
  const list = (v, allowed) =>
    String(v || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => allowed.includes(s));
  const statuses = list(query.status, ['submitted', 'under_review', 'verified', 'assigned', 'in_progress', 'resolved', 'rejected', 'duplicate']);
  if (statuses.length) conds.push(sql`r.status = ANY(${statuses})`);
  const severities = list(query.severity, ['low', 'medium', 'high']);
  if (severities.length) conds.push(sql`r.severity = ANY(${severities})`);
  if (query.q && String(query.q).trim()) {
    const like = `%${escapeLike(String(query.q).trim().slice(0, 100))}%`;
    conds.push(sql`(r.code ILIKE ${like} OR r.road_name ILIKE ${like} OR r.barangay ILIKE ${like}
                    OR r.landmark ILIKE ${like} OR r.description ILIKE ${like})`);
  }
  if (query.barangay && String(query.barangay).trim()) {
    conds.push(sql`lower(r.barangay) = ${String(query.barangay).trim().toLowerCase().slice(0, 100)}`);
  }
  const teamId = Number(query.team_id);
  if (Number.isInteger(teamId) && teamId > 0) {
    conds.push(sql`EXISTS (SELECT 1 FROM assignments a WHERE a.report_id = r.id AND a.is_active AND a.team_id = ${teamId})`);
  }
  const agencyId = Number(query.agency_id);
  if (Number.isInteger(agencyId) && agencyId > 0) conds.push(sql`r.agency_id = ${agencyId}`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.from || '')) conds.push(sql`r.created_at >= ${query.from}::date`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.to || '')) conds.push(sql`r.created_at < (${query.to}::date + 1)`);
  if (query.awaiting_completion === 'true') {
    conds.push(sql`(r.status = 'in_progress' AND r.work_completed_at IS NOT NULL)`);
  }
  return conds.reduce((acc, c) => sql`${acc} AND ${c}`, sql`TRUE`);
}

// Number of other open reports close to each report (duplicate flag).
export function possibleDuplicatesExpr(radiusM, windowDays) {
  const dLat = radiusM / 111_320;
  return sql`(
    SELECT count(*)::int FROM reports o
    WHERE o.id <> r.id
      AND o.lgu_id = r.lgu_id
      AND o.status NOT IN ('rejected', 'duplicate', 'resolved')
      AND o.latitude BETWEEN r.latitude - ${dLat} AND r.latitude + ${dLat}
      AND o.longitude BETWEEN r.longitude - ${dLat} / greatest(0.2, cos(radians(r.latitude)))
                          AND r.longitude + ${dLat} / greatest(0.2, cos(radians(r.latitude)))
      AND abs(extract(epoch FROM (o.created_at - r.created_at))) <= ${windowDays} * 86400
      AND wg_distance_m(r.latitude, r.longitude, o.latitude, o.longitude) <= ${radiusM}
  )`;
}

export const SORTS = {
  newest: () => sql`r.created_at DESC, r.id DESC`,
  oldest: () => sql`r.created_at ASC, r.id ASC`,
  updated: () => sql`r.updated_at DESC, r.id DESC`,
  severity: () => sql`CASE r.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, r.created_at ASC`,
  priority: () => sql`CASE r.status WHEN 'submitted' THEN 0 WHEN 'under_review' THEN 1 WHEN 'verified' THEN 2
                         WHEN 'in_progress' THEN 3 WHEN 'assigned' THEN 4 ELSE 5 END,
                    CASE r.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, r.created_at ASC`,
};

export function forbidUnlessRole(user, ...roles) {
  if (!roles.includes(user.role)) throw forbidden();
}
