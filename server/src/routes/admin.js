// Administrator / LGU personnel endpoints: report management and workflow
// actions, dashboard statistics, users, teams, agencies and settings.
import { z } from 'zod';
import { Router, readJson, badRequest, conflict, notFound, HttpError } from '../lib/http.js';
import { sql } from '../db/index.js';
import { requireRole } from '../middleware/auth.js';
import {
  text,
  optionalText,
  email,
  password,
  phone,
  severity,
  roadType,
  parseId,
  pagination,
  dateOnly,
} from '../lib/validation.js';
import { hashPassword } from '../lib/security.js';
import { audit } from '../services/audit.js';
import { getSettings, updateSettings, settingsSchema } from '../services/settings.js';
import { destroyUserSessions, userColumns } from '../services/sessions.js';
import { adminFilters, possibleDuplicatesExpr, SORTS, recordEvent, loadReportRow } from '../services/reports.js';
import * as workflow from '../services/workflow.js';
import { computeStats } from '../services/stats.js';
import { notifyUsers } from '../services/notifications.js';

export const adminRoutes = new Router('/api/admin');
const admin = requireRole('admin');
const adminOrStaff = requireRole('admin', 'staff');

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
adminRoutes.get('/reports', adminOrStaff, async (ctx) => {
  const { page, pageSize, offset } = pagination(ctx.query, { defaultSize: 20, maxSize: 100 });
  const s = await getSettings(sql, ctx.user.lgu_id);
  const where = adminFilters(ctx.query, (ctx.user.accessible_lgu_ids || [ctx.user.lgu_id]));
  const order = (SORTS[ctx.query.sort] || SORTS.priority)();
  const dupExpr = possibleDuplicatesExpr(s.duplicate_radius_m, s.duplicate_window_days);
  const dupFilter = ctx.query.has_duplicates === 'true' ? sql`AND ${dupExpr} > 0` : sql``;
  const rows = await sql`
    SELECT r.id, r.code, r.status, r.severity, r.reported_severity, r.road_name, r.barangay, r.city, r.landmark,
           r.created_at, r.updated_at, r.work_completed_at, r.latitude, r.longitude, r.is_demo,
           ag.name AS agency_name, t.name AS team_name,
           ${dupExpr} AS possible_duplicates,
           (SELECT count(*)::int FROM report_photos p WHERE p.report_id = r.id AND p.kind = 'report') AS photo_count,
           count(*) OVER()::int AS total
    FROM reports r
    LEFT JOIN agencies ag ON ag.id = r.agency_id
    LEFT JOIN assignments a ON a.report_id = r.id AND a.is_active
    LEFT JOIN maintenance_teams t ON t.id = a.team_id
    WHERE ${where} ${dupFilter}
    ORDER BY ${order}
    LIMIT ${pageSize} OFFSET ${offset}`;
  ctx.json(200, {
    items: rows.map(({ total, ...r }) => r),
    total: rows[0]?.total ?? 0,
    page,
    pageSize,
  });
});

// All matching reports for the admin map (no pagination, capped).
adminRoutes.get('/map', adminOrStaff, async (ctx) => {
  const where = adminFilters(ctx.query, (ctx.user.accessible_lgu_ids || [ctx.user.lgu_id]));
  const rows = await sql`
    SELECT r.id, r.code, r.status, r.severity, r.road_name, r.barangay, r.landmark, r.latitude, r.longitude,
           r.created_at, r.work_completed_at, r.is_demo
    FROM reports r WHERE ${where}
    ORDER BY r.created_at DESC
    LIMIT 5000`;
  ctx.json(200, { items: rows });
});

adminRoutes.get('/barangays', adminOrStaff, async (ctx) => {
  const rows = await sql`
    SELECT barangay, count(*)::int AS n FROM reports
    WHERE lgu_id = ANY(${(ctx.user.accessible_lgu_ids || [ctx.user.lgu_id])}) AND barangay IS NOT NULL AND barangay <> ''
    GROUP BY barangay ORDER BY barangay`;
  ctx.json(200, { items: rows });
});

const noteSchema = z.object({ note: optionalText(1000, 'Note') });
const verifySchema = z.object({
  severity: severity.optional(),
  agency_id: z.number().int().positive().nullable().optional(),
  note: optionalText(1000, 'Note'),
});
const rejectSchema = z.object({ reason: text(5, 500, 'Reason') });
const duplicateSchema = z.object({
  duplicate_of_id: z.number({ required_error: 'Choose the original report.' }).int().positive(),
  note: optionalText(1000, 'Note'),
});
const assignSchema = z.object({
  team_id: z.number({ required_error: 'Choose a maintenance team.' }).int().positive(),
  instructions: optionalText(1000, 'Instructions'),
  due_date: dateOnly.nullable().optional(),
});
const returnSchema = z.object({ reason: text(5, 1000, 'Reason') });
const editSchema = z
  .object({
    severity,
    agency_id: z.number().int().positive().nullable(),
    road_type: roadType,
    road_name: text(2, 150, 'Road name'),
    barangay: optionalText(100, 'Barangay'),
    landmark: optionalText(200, 'Landmark'),
  })
  .partial();
const commentSchema = z.object({
  message: text(2, 1000, 'Note'),
  is_public: z.boolean().default(false),
});

const action = (fn) => async (ctx) => {
  const id = parseId(ctx.params.id, 'report id');
  const [ownedReport] = await sql`SELECT id FROM reports WHERE id = ${id} AND lgu_id = ANY(${(ctx.user.accessible_lgu_ids || [ctx.user.lgu_id])})`;
  if (!ownedReport) throw notFound('Report not found.');
  const result = await fn(ctx, id);
  ctx.json(200, { ok: true, ...result });
};

adminRoutes.post(
  '/reports/:id/review',
  adminOrStaff,
  action(async (ctx, id) => workflow.startReview(id, ctx.user, await readJson(ctx, noteSchema))),
);
adminRoutes.post(
  '/reports/:id/verify',
  adminOrStaff,
  action(async (ctx, id) => {
    const b = await readJson(ctx, verifySchema);
    return workflow.verifyReport(id, ctx.user, { severity: b.severity, agencyId: b.agency_id, note: b.note });
  }),
);
adminRoutes.post(
  '/reports/:id/reject',
  adminOrStaff,
  action(async (ctx, id) => workflow.rejectReport(id, ctx.user, await readJson(ctx, rejectSchema))),
);
adminRoutes.post(
  '/reports/:id/duplicate',
  adminOrStaff,
  action(async (ctx, id) => {
    const b = await readJson(ctx, duplicateSchema);
    return workflow.markDuplicate(id, ctx.user, { duplicateOfId: b.duplicate_of_id, note: b.note });
  }),
);
adminRoutes.post(
  '/reports/:id/assign',
  adminOrStaff,
  action(async (ctx, id) => {
    const b = await readJson(ctx, assignSchema);
    return workflow.assignReport(id, ctx.user, { teamId: b.team_id, instructions: b.instructions, dueDate: b.due_date });
  }),
);
adminRoutes.post(
  '/reports/:id/unassign',
  adminOrStaff,
  action(async (ctx, id) => workflow.unassignReport(id, ctx.user, await readJson(ctx, noteSchema))),
);
adminRoutes.post(
  '/reports/:id/approve-completion',
  adminOrStaff,
  action(async (ctx, id) => workflow.approveCompletion(id, ctx.user, await readJson(ctx, noteSchema))),
);
adminRoutes.post(
  '/reports/:id/return-completion',
  adminOrStaff,
  action(async (ctx, id) => workflow.returnCompletion(id, ctx.user, await readJson(ctx, returnSchema))),
);

// Edit classification details (severity, agency, road info) with history.
adminRoutes.patch('/reports/:id', adminOrStaff, async (ctx) => {
  const id = parseId(ctx.params.id, 'report id');
  const body = await readJson(ctx, editSchema);
  await sql.begin(async (tx) => {
    const r = await loadReportRow(tx, id, { lock: true });
    if (!(ctx.user.accessible_lgu_ids || [ctx.user.lgu_id]).includes(r.lgu_id)) throw notFound('Report not found.');
    if (['resolved', 'rejected', 'duplicate'].includes(r.status)) {
      throw conflict('Closed reports cannot be edited. Reopen the report first.');
    }
    const changes = {};
    const labels = [];
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined || value === r[key]) continue;
      changes[key] = value;
      labels.push(key.replace('_id', '').replace('_', ' '));
    }
    if (changes.agency_id) {
      const [a] = await tx`SELECT name FROM agencies WHERE id = ${changes.agency_id} AND lgu_id = ANY(${(ctx.user.accessible_lgu_ids || [ctx.user.lgu_id])}) AND is_active`;
      if (!a) throw badRequest('Choose an active agency.');
    }
    if (!labels.length) return;
    await tx`UPDATE reports SET ${tx(changes)}, updated_at = now() WHERE id = ${id}`;
    await recordEvent(tx, {
      reportId: id,
      actorId: ctx.user.id,
      type: 'details_updated',
      message: `Updated ${labels.join(', ')}.`,
      isPublic: Boolean(changes.severity),
      meta: { changes: Object.fromEntries(Object.keys(changes).map((k) => [k, { from: r[k], to: changes[k] }])) },
    });
  });
  ctx.json(200, { ok: true });
});

adminRoutes.post('/reports/:id/notes', adminOrStaff, async (ctx) => {
  const id = parseId(ctx.params.id, 'report id');
  const body = await readJson(ctx, commentSchema);
  const [ownedReport] = await sql`SELECT id FROM reports WHERE id = ${id} AND lgu_id = ANY(${(ctx.user.accessible_lgu_ids || [ctx.user.lgu_id])})`;
  if (!ownedReport) throw notFound('Report not found.');
  await recordEvent(sql, {
    reportId: id,
    actorId: ctx.user.id,
    type: body.is_public ? 'public_note' : 'internal_note',
    message: body.message,
    isPublic: body.is_public,
  });
  if (body.is_public) {
    const [r] = await sql`SELECT code, reporter_id FROM reports WHERE id = ${id}`;
    await notifyUsers(sql, {
      userIds: [r.reporter_id],
      reportId: id,
      type: 'report_update',
      title: `${r.code}: update from the LGU`,
      body: body.message.slice(0, 300),
    });
  }
  ctx.json(201, { ok: true });
});

// ---------------------------------------------------------------------------
// Dashboard statistics
// ---------------------------------------------------------------------------
adminRoutes.get('/stats', adminOrStaff, async (ctx) => {
  ctx.json(200, await computeStats(ctx.query, (ctx.user.accessible_lgu_ids || [ctx.user.lgu_id])));
});

// Jurisdiction choices are derived from the server-authenticated scope, never from client claims.
adminRoutes.get('/jurisdictions', adminOrStaff, async (ctx) => {
  const ids = ctx.user.accessible_lgu_ids || [ctx.user.lgu_id];
  const items = await sql`
    SELECT l.id, l.name, l.city, l.province, l.jurisdiction_level, l.parent_lgu_id, l.is_active
    FROM lgus l
    WHERE l.id = ANY(${ids}) AND l.is_active
    ORDER BY l.jurisdiction_level, l.name`;
  ctx.json(200, { items });
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
const createUserSchema = z
  .object({
    full_name: text(2, 100, 'Full name'),
    email,
    phone,
    role: z.enum(['citizen', 'admin', 'staff', 'maintenance']),
    lgu_id: z.number().int().positive().optional(),
    team_id: z.number().int().positive().nullable().optional(),
    temporary_password: password,
  })
  .refine((u) => u.role !== 'maintenance' || u.team_id, {
    message: 'Maintenance personnel must belong to a team.',
    path: ['team_id'],
  });

const updateUserSchema = z
  .object({
    full_name: text(2, 100, 'Full name'),
    phone,
    role: z.enum(['citizen', 'admin', 'staff', 'maintenance']),
    team_id: z.number().int().positive().nullable(),
    is_active: z.boolean(),
  })
  .partial();

const resetSchema = z.object({ temporary_password: password });

async function loadUserForAdmin(db, id, lguIds) {
  const [u] = await db`
    SELECT ${userColumns()},
           (SELECT count(*)::int FROM reports WHERE reporter_id = u.id) AS report_count
    FROM users u
    LEFT JOIN maintenance_teams t ON t.id = u.team_id AND t.lgu_id = u.lgu_id
    LEFT JOIN lgus l ON l.id = u.lgu_id
    WHERE u.id = ${id} AND u.lgu_id = ANY(${Array.isArray(lguIds) ? lguIds : [lguIds]})`;
  if (!u) throw notFound('User not found.');
  return u;
}

adminRoutes.get('/users', admin, async (ctx) => {
  const { page, pageSize, offset } = pagination(ctx.query, { defaultSize: 20 });
  const conds = [sql`u.lgu_id = ANY(${(ctx.user.accessible_lgu_ids || [ctx.user.lgu_id])})`];
  if (['citizen', 'admin', 'staff', 'maintenance'].includes(ctx.query.role)) conds.push(sql`u.role = ${ctx.query.role}`);
  if (ctx.query.status === 'active') conds.push(sql`u.is_active`);
  if (ctx.query.status === 'inactive') conds.push(sql`NOT u.is_active`);
  if (ctx.query.q && String(ctx.query.q).trim()) {
    const like = `%${String(ctx.query.q).trim().slice(0, 100).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(sql`(u.full_name ILIKE ${like} OR u.email ILIKE ${like})`);
  }
  const where = conds.reduce((acc, c) => sql`${acc} AND ${c}`, sql`TRUE`);
  const rows = await sql`
    SELECT ${userColumns()},
           (SELECT count(*)::int FROM reports WHERE reporter_id = u.id) AS report_count,
           count(*) OVER()::int AS total
    FROM users u
    LEFT JOIN maintenance_teams t ON t.id = u.team_id AND t.lgu_id = u.lgu_id
    LEFT JOIN lgus l ON l.id = u.lgu_id
    WHERE ${where}
    ORDER BY u.created_at DESC, u.id DESC
    LIMIT ${pageSize} OFFSET ${offset}`;
  ctx.json(200, { items: rows.map(({ total, ...u }) => u), total: rows[0]?.total ?? 0, page, pageSize });
});

adminRoutes.post('/users', admin, async (ctx) => {
  const body = await readJson(ctx, createUserSchema);
  const scope = ctx.user.accessible_lgu_ids || [ctx.user.lgu_id];
  let lguId = body.lgu_id ?? ctx.user.lgu_id;
  const teamId = body.role === 'maintenance' ? body.team_id : null;
  if (body.role === 'maintenance' && !teamId) throw badRequest('Maintenance personnel must belong to a team.');
  if (teamId) {
    const [team] = await sql`SELECT id, lgu_id FROM maintenance_teams WHERE id = ${teamId} AND lgu_id = ANY(${scope}) AND is_active`;
    if (!team) throw badRequest('Choose an active team within your assigned jurisdiction.');
    if (body.lgu_id !== undefined && body.lgu_id !== team.lgu_id) throw badRequest('The selected team and account jurisdiction must match.');
    if (body.lgu_id === undefined) lguId = team.lgu_id;
  }
  if (!scope.includes(lguId)) throw badRequest('Choose a jurisdiction within your assigned scope.');
  const [activeLgu] = await sql`SELECT id FROM lgus WHERE id = ${lguId} AND is_active`;
  if (!activeLgu) throw badRequest('Choose an active jurisdiction.');
  const [exists] = await sql`SELECT 1 FROM users WHERE lower(email) = ${body.email}`;
  if (exists) throw conflict('An account with this e-mail already exists.');
  const hash = await hashPassword(body.temporary_password);
  const [u] = await sql`
    INSERT INTO users (email, password_hash, full_name, phone, role, lgu_id, team_id, must_change_password)
    VALUES (${body.email}, ${hash}, ${body.full_name}, ${body.phone}, ${body.role}, ${lguId}, ${teamId}, TRUE)
    RETURNING id`;
  if (body.role === 'admin') {
    await sql`INSERT INTO admin_jurisdiction_assignments (user_id, lgu_id, assigned_by)
      VALUES (${u.id}, ${lguId}, ${ctx.user.id}) ON CONFLICT (user_id, lgu_id) DO NOTHING`;
    await sql`INSERT INTO admin_jurisdiction_assignment_history (user_id, lgu_id, action, changed_by, details)
      VALUES (${u.id}, ${lguId}, 'assigned', ${ctx.user.id}, ${sql.json({ source: 'local_admin_creation' })})`;
  }
  await audit(sql, {
    actorId: ctx.user.id,
    action: 'user.create',
    targetType: 'user',
    targetId: u.id,
    details: { email: body.email, role: body.role, team_id: teamId },
    ip: ctx.ip,
  });
  ctx.json(201, { user: await loadUserForAdmin(sql, u.id, ctx.user.accessible_lgu_ids || [ctx.user.lgu_id, lguId]) });
});

adminRoutes.patch('/users/:id', admin, async (ctx) => {
  const id = parseId(ctx.params.id, 'user id');
  const body = await readJson(ctx, updateUserSchema);
  const result = await sql.begin(async (tx) => {
    const [current] = await tx`SELECT * FROM users WHERE id = ${id} AND lgu_id = ANY(${(ctx.user.accessible_lgu_ids || [ctx.user.lgu_id])}) FOR UPDATE`;
    if (!current) throw notFound('User not found.');
    const next = { ...current, ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) };
    if (next.role !== 'maintenance') next.team_id = null;
    if (next.role === 'maintenance' && !next.team_id) {
      throw badRequest('Maintenance personnel must belong to a team.', { fields: { team_id: 'Choose a team.' } });
    }
    if (next.team_id && next.team_id !== current.team_id) {
      const [t] = await tx`SELECT 1 FROM maintenance_teams WHERE id = ${next.team_id} AND lgu_id = ${current.lgu_id} AND is_active`;
      if (!t) throw badRequest('Choose an active team.');
    }
    if (id === ctx.user.id && (next.role !== 'admin' || !next.is_active)) {
      throw new HttpError(409, 'You cannot remove your own administrator access.', undefined, 'self_lockout');
    }
    if (current.role === 'admin' && current.is_active && (next.role !== 'admin' || !next.is_active)) {
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND lgu_id = ${current.lgu_id} AND is_active AND id <> ${id}`;
      if (n === 0) throw conflict('At least one active administrator is required.');
    }
    const changes = {};
    for (const key of ['full_name', 'phone', 'role', 'team_id', 'is_active']) {
      if (next[key] !== current[key]) changes[key] = next[key];
    }
    if (!Object.keys(changes).length) return { changed: false };
    if (current.role !== 'admin' && next.role === 'admin') {
      const [assignment] = await tx`
        INSERT INTO admin_jurisdiction_assignments (user_id, lgu_id, assigned_by)
        VALUES (${id}, ${current.lgu_id}, ${ctx.user.id})
        ON CONFLICT (user_id, lgu_id) DO NOTHING RETURNING lgu_id`;
      if (assignment) await tx`
        INSERT INTO admin_jurisdiction_assignment_history (user_id, lgu_id, action, changed_by, details)
        VALUES (${id}, ${current.lgu_id}, 'assigned', ${ctx.user.id}, ${tx.json({ source: 'local_role_change' })})`;
    }
    if (current.role === 'admin' && next.role !== 'admin') {
      const assignments = await tx`DELETE FROM admin_jurisdiction_assignments WHERE user_id = ${id} RETURNING lgu_id`;
      for (const assignment of assignments) await tx`
        INSERT INTO admin_jurisdiction_assignment_history (user_id, lgu_id, action, changed_by, details)
        VALUES (${id}, ${assignment.lgu_id}, 'revoked', ${ctx.user.id}, ${tx.json({ source: 'local_role_change' })})`;
    }
    await tx`UPDATE users SET ${tx(changes)}, updated_at = now() WHERE id = ${id}`;
    // Role or access changes take effect immediately.
    if ('role' in changes || 'is_active' in changes || 'team_id' in changes) await destroyUserSessions(id, null, tx);
    await audit(tx, {
      actorId: ctx.user.id,
      action: 'user.update',
      targetType: 'user',
      targetId: id,
      details: Object.fromEntries(Object.keys(changes).map((k) => [k, { from: current[k], to: changes[k] }])),
      ip: ctx.ip,
    });
    return { changed: true };
  });
  ctx.json(200, { ...result, user: await loadUserForAdmin(sql, id, ctx.user.accessible_lgu_ids || [ctx.user.lgu_id]) });
});

adminRoutes.post('/users/:id/reset-password', admin, async (ctx) => {
  const id = parseId(ctx.params.id, 'user id');
  const body = await readJson(ctx, resetSchema);
  if (id === ctx.user.id) throw badRequest('Use "Change password" on your profile to change your own password.');
  const hash = await hashPassword(body.temporary_password);
  const rows = await sql`
    UPDATE users SET password_hash = ${hash}, must_change_password = TRUE, updated_at = now()
    WHERE id = ${id} AND lgu_id = ANY(${(ctx.user.accessible_lgu_ids || [ctx.user.lgu_id])}) RETURNING id`;
  if (!rows.length) throw notFound('User not found.');
  await destroyUserSessions(id);
  await audit(sql, { actorId: ctx.user.id, action: 'user.reset_password', targetType: 'user', targetId: id, ip: ctx.ip });
  ctx.json(200, { ok: true });
});

// ---------------------------------------------------------------------------
// Teams and agencies
// ---------------------------------------------------------------------------
const teamSchema = z.object({
  lgu_id: z.number().int().positive().optional(),
  name: text(2, 120, 'Team name'),
  agency_id: z.number().int().positive().nullable().optional(),
  description: optionalText(500, 'Description'),
  is_active: z.boolean().optional(),
});
const agencySchema = z.object({
  lgu_id: z.number().int().positive().optional(),
  name: text(2, 120, 'Agency name'),
  jurisdiction: z.enum(['national', 'provincial', 'city_municipal', 'barangay', 'other']),
  contact_email: z.union([z.literal(''), z.null(), email]).optional().transform((v) => v || null),
  contact_phone: phone.optional(),
  is_active: z.boolean().optional(),
});

adminRoutes.get('/teams', adminOrStaff, async (ctx) => {
  const rows = await sql`
    SELECT t.id, t.lgu_id, l.name AS lgu_name, t.name, t.description, t.is_active, t.agency_id, ag.name AS agency_name, t.created_at,
           (SELECT count(*)::int FROM users u WHERE u.team_id = t.id AND u.is_active) AS member_count,
           (SELECT count(*)::int FROM assignments a WHERE a.team_id = t.id AND a.is_active) AS active_tasks
    FROM maintenance_teams t LEFT JOIN agencies ag ON ag.id = t.agency_id AND ag.lgu_id = t.lgu_id
    WHERE t.lgu_id = ANY(${(ctx.user.accessible_lgu_ids || [ctx.user.lgu_id])})
    ORDER BY t.is_active DESC, t.name`;
  ctx.json(200, { items: rows });
});

adminRoutes.post('/teams', admin, async (ctx) => {
  const b = await readJson(ctx, teamSchema);
  const scope = ctx.user.accessible_lgu_ids || [ctx.user.lgu_id];
  let targetLguId = b.lgu_id ?? ctx.user.lgu_id;
  let selectedAgency = null;
  if (b.agency_id) {
    [selectedAgency] = await sql`SELECT id, lgu_id FROM agencies WHERE id = ${b.agency_id} AND lgu_id = ANY(${scope}) AND is_active`;
    if (!selectedAgency) throw badRequest('Choose an active agency within your assigned jurisdiction.');
    if (b.lgu_id !== undefined && b.lgu_id !== selectedAgency.lgu_id) throw badRequest('The team and agency must belong to the same jurisdiction.');
    if (b.lgu_id === undefined) targetLguId = selectedAgency.lgu_id;
  }
  if (!scope.includes(targetLguId)) throw badRequest('Choose a jurisdiction within your assigned scope.');
  const [targetLgu] = await sql`SELECT id FROM lgus WHERE id = ${targetLguId} AND is_active`;
  if (!targetLgu) throw badRequest('Choose an active jurisdiction.');
  if (selectedAgency && selectedAgency.lgu_id !== targetLguId) throw badRequest('The team and agency must belong to the same jurisdiction.');
  const [t] = await sql`
    INSERT INTO maintenance_teams (lgu_id, name, agency_id, description, is_active)
    VALUES (${targetLguId}, ${b.name}, ${b.agency_id ?? null}, ${b.description}, ${b.is_active ?? true}) RETURNING id`;
  await audit(sql, { actorId: ctx.user.id, action: 'team.create', targetType: 'team', targetId: t.id, details: b, ip: ctx.ip });
  ctx.json(201, { id: t.id });
});

adminRoutes.patch('/teams/:id', admin, async (ctx) => {
  const id = parseId(ctx.params.id, 'team id');
  const b = await readJson(ctx, teamSchema.partial().omit({ lgu_id: true }));
  const scope = ctx.user.accessible_lgu_ids || [ctx.user.lgu_id];
  const [team] = await sql`SELECT id, lgu_id FROM maintenance_teams WHERE id = ${id} AND lgu_id = ANY(${scope})`;
  if (!team) throw notFound('Team not found.');
  if (b.is_active === false) {
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM assignments WHERE team_id = ${id} AND is_active`;
    if (n > 0) throw conflict(`This team still has ${n} active task(s). Reassign them first.`);
  }
  const changes = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
  if (!Object.keys(changes).length) throw badRequest('Nothing to update.');
  if (b.agency_id) {
    const [agency] = await sql`SELECT id FROM agencies WHERE id = ${b.agency_id} AND lgu_id = ${team.lgu_id} AND is_active`;
    if (!agency) throw badRequest('Choose an active agency from the team\'s jurisdiction.');
  }
  const rows = await sql`UPDATE maintenance_teams SET ${sql(changes)} WHERE id = ${id} AND lgu_id = ANY(${scope}) RETURNING id`;
  if (!rows.length) throw notFound('Team not found.');
  await audit(sql, { actorId: ctx.user.id, action: 'team.update', targetType: 'team', targetId: id, details: changes, ip: ctx.ip });
  ctx.json(200, { ok: true });
});

adminRoutes.get('/agencies', adminOrStaff, async (ctx) => {
  const rows = await sql`
    SELECT a.*, (SELECT count(*)::int FROM reports r WHERE r.agency_id = a.id) AS report_count
    FROM agencies a WHERE a.lgu_id = ANY(${(ctx.user.accessible_lgu_ids || [ctx.user.lgu_id])}) ORDER BY a.is_active DESC, a.name`;
  ctx.json(200, { items: rows });
});

adminRoutes.post('/agencies', admin, async (ctx) => {
  const b = await readJson(ctx, agencySchema);
  const targetLguId = b.lgu_id ?? ctx.user.lgu_id;
  if (!(ctx.user.accessible_lgu_ids || [ctx.user.lgu_id]).includes(targetLguId)) throw badRequest('Choose a jurisdiction within your assigned scope.');
  const [targetLgu] = await sql`SELECT id FROM lgus WHERE id = ${targetLguId} AND is_active`;
  if (!targetLgu) throw badRequest('Choose an active jurisdiction.');
  const [a] = await sql`
    INSERT INTO agencies (lgu_id, name, jurisdiction, contact_email, contact_phone, is_active)
    VALUES (${targetLguId}, ${b.name}, ${b.jurisdiction}, ${b.contact_email}, ${b.contact_phone ?? null}, ${b.is_active ?? true})
    RETURNING id`;
  await audit(sql, { actorId: ctx.user.id, action: 'agency.create', targetType: 'agency', targetId: a.id, details: b, ip: ctx.ip });
  ctx.json(201, { id: a.id });
});

adminRoutes.patch('/agencies/:id', admin, async (ctx) => {
  const id = parseId(ctx.params.id, 'agency id');
  const b = await readJson(ctx, agencySchema.partial().omit({ lgu_id: true }));
  const changes = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
  const rows = await sql`UPDATE agencies SET ${sql(changes)} WHERE id = ${id} AND lgu_id = ANY(${(ctx.user.accessible_lgu_ids || [ctx.user.lgu_id])}) RETURNING id`;
  if (!rows.length) throw notFound('Agency not found.');
  await audit(sql, { actorId: ctx.user.id, action: 'agency.update', targetType: 'agency', targetId: id, details: changes, ip: ctx.ip });
  ctx.json(200, { ok: true });
});

// ---------------------------------------------------------------------------
// Settings and audit log
// ---------------------------------------------------------------------------
adminRoutes.get('/settings', admin, async (ctx) => {
  ctx.json(200, { settings: await getSettings(sql, ctx.user.lgu_id) });
});

adminRoutes.put('/settings', admin, async (ctx) => {
  const body = await readJson(ctx, settingsSchema);
  if (body.road_type_agency) {
    const ids = Object.values(body.road_type_agency).filter(Boolean);
    if (ids.length) {
      const found = await sql`SELECT id FROM agencies WHERE id = ANY(${ids}) AND lgu_id = ${ctx.user.lgu_id} AND is_active`;
      if (found.length !== new Set(ids).size) throw badRequest('Every mapped agency must exist and be active.');
    }
  }
  const settings = await sql.begin(async (tx) => {
    if (body.lgu_name) {
      const [duplicateName] = await tx`
        SELECT id FROM lgus
        WHERE lower(name) = lower(${body.lgu_name}) AND id <> ${ctx.user.lgu_id}`;
      if (duplicateName) throw conflict('Another LGU already uses that name.');
    }
    const next = await updateSettings(body, ctx.user.id, tx, ctx.user.lgu_id);
    if (body.lgu_name) {
      await tx`UPDATE lgus SET name = ${body.lgu_name}, updated_at = now() WHERE id = ${ctx.user.lgu_id}`;
    }
    return next;
  });
  await audit(sql, { actorId: ctx.user.id, action: 'settings.update', targetType: 'settings', details: body, ip: ctx.ip });
  ctx.json(200, { settings });
});

adminRoutes.get('/audit', admin, async (ctx) => {
  const { page, pageSize, offset } = pagination(ctx.query, { defaultSize: 30 });
  const rows = await sql`
    SELECT l.id, l.action, l.target_type, l.target_id, l.details, l.ip, l.created_at, u.full_name AS actor_name,
           count(*) OVER()::int AS total
    FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id
    WHERE l.lgu_id = ANY(${(ctx.user.accessible_lgu_ids || [ctx.user.lgu_id])})
    ORDER BY l.created_at DESC, l.id DESC
    LIMIT ${pageSize} OFFSET ${offset}`;
  ctx.json(200, { items: rows.map(({ total, ...r }) => r), total: rows[0]?.total ?? 0, page, pageSize });
});
