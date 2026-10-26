// Platform-level LGU provisioning. Only platform administrators can create
// LGU tenants; each tenant is created together with its first LGU administrator.
import { z } from 'zod';
import { Router, readJson, notFound, conflict, badRequest } from '../lib/http.js';
import { sql } from '../db/index.js';
import { requireRole } from '../middleware/auth.js';
import { text, email, password, phone, parseId } from '../lib/validation.js';
import { hashPassword } from '../lib/security.js';
import { audit } from '../services/audit.js';
import { DEFAULT_SETTINGS } from '../services/settings.js';

export const platformRoutes = new Router('/api/platform');
const platformAdmin = requireRole('platform_admin');

const JURISDICTION_ORDER = {
  island_group: 0,
  region: 1,
  province: 2,
  independent_city: 2,
  city: 3,
  municipality: 3,
  barangay: 4,
};

function validParentLevel(childLevel, parentLevel) {
  if (!parentLevel) return childLevel === 'island_group' || childLevel === 'region';
  const child = JURISDICTION_ORDER[childLevel];
  const parent = JURISDICTION_ORDER[parentLevel];
  return Number.isInteger(child) && Number.isInteger(parent) && parent < child;
}

async function assertValidParent(db, { lguId = null, parentId, level }) {
  if (parentId == null) return;
  if (lguId != null && Number(parentId) === Number(lguId)) throw badRequest('A jurisdiction cannot be its own parent.');
  const [parent] = await db`SELECT id, jurisdiction_level FROM lgus WHERE id = ${parentId}`;
  if (!parent) throw badRequest('Choose an existing parent jurisdiction.');
  if (!validParentLevel(level, parent.jurisdiction_level)) {
    throw badRequest('The parent jurisdiction must be higher in the geographic hierarchy.');
  }
  if (lguId != null) {
    const [cycle] = await db`
      WITH RECURSIVE descendants(id) AS (
        SELECT id FROM lgus WHERE parent_lgu_id = ${lguId}
        UNION ALL
        SELECT l.id FROM lgus l JOIN descendants d ON l.parent_lgu_id = d.id
      )
      SELECT id FROM descendants WHERE id = ${parentId} LIMIT 1`;
    if (cycle) throw badRequest('A jurisdiction cannot be moved beneath one of its descendants.');
  }
}

function validBoundary(value) {
  if (value == null) return true;
  const feature = value.type === 'Feature' ? value.geometry : value;
  if (!feature || !['Polygon', 'MultiPolygon'].includes(feature.type) || !Array.isArray(feature.coordinates)) return false;
  const polygons = feature.type === 'Polygon' ? [feature.coordinates] : feature.coordinates;
  if (!polygons.length) return false;
  return polygons.every((polygon) => Array.isArray(polygon) && polygon.length > 0 &&
    polygon.every((ring) => Array.isArray(ring) && ring.length >= 4 &&
      ring.every((point) => Array.isArray(point) && point.length >= 2 &&
        Number.isFinite(point[0]) && Number.isFinite(point[1]) &&
        point[0] >= -180 && point[0] <= 180 && point[1] >= -90 && point[1] <= 90) &&
      JSON.stringify(ring[0]) === JSON.stringify(ring[ring.length - 1])));
}


const createLguSchema = z.object({
  name: text(2, 120, 'LGU name'),
  slug: z.string().trim().toLowerCase().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use letters, numbers and hyphens for the LGU slug.').optional(),
  city: text(2, 100, 'City / municipality'),
  province: text(2, 100, 'Province'),
  jurisdiction_level: z.enum(['island_group', 'region', 'province', 'independent_city', 'city', 'municipality', 'barangay']).default('municipality'),
  parent_lgu_id: z.union([z.literal(''), z.null(), z.undefined(), z.coerce.number().int().positive()]).transform((v) => (v === '' || v === null || v === undefined ? null : v)),
  map_latitude: z.union([z.literal(''), z.null(), z.undefined(), z.coerce.number().min(-90).max(90)])
    .transform((v) => (v === '' || v === null || v === undefined ? null : v)),
  map_longitude: z.union([z.literal(''), z.null(), z.undefined(), z.coerce.number().min(-180).max(180)])
    .transform((v) => (v === '' || v === null || v === undefined ? null : v)),
  jurisdiction_boundary: z.union([z.record(z.any()), z.null(), z.undefined()]).optional()
    .refine(validBoundary, 'Enter a valid GeoJSON Polygon or MultiPolygon with closed coordinate rings.'),
  admin_name: text(2, 100, 'Administrator name'),
  admin_email: email,
  admin_phone: phone,
  temporary_password: password,
}).refine(
  (v) => (v.map_latitude === null && v.map_longitude === null) ||
    (typeof v.map_latitude === 'number' && typeof v.map_longitude === 'number'),
  { message: 'Enter both map coordinates or leave both blank.', path: ['map_latitude'] },
);

platformRoutes.get('/lgus', platformAdmin, async (ctx) => {
  const rows = await sql`
    SELECT l.id, l.name, l.slug, l.city, l.province, l.jurisdiction_level, l.parent_lgu_id, l.is_active, l.created_at, l.jurisdiction_boundary,
      (SELECT count(*)::int FROM users u WHERE u.lgu_id = l.id AND u.role IN ('admin', 'staff', 'maintenance') AND u.is_active) AS staff_count,
      (SELECT count(*)::int FROM reports r WHERE r.lgu_id = l.id) AS report_count,
      (SELECT u.full_name FROM users u WHERE u.lgu_id = l.id AND u.role = 'admin' ORDER BY u.created_at, u.id LIMIT 1) AS administrator_name
    FROM lgus l
    ORDER BY l.name, l.id`;
  ctx.json(200, { items: rows });
});

// Central account directory and jurisdiction assignment APIs, for platform administrators.
const accountUpdateSchema = z.object({
  role: z.enum(['citizen', 'admin', 'staff', 'maintenance']).optional(),
  is_active: z.boolean().optional(),
}).refine((v) => v.role !== undefined || v.is_active !== undefined, 'Nothing to update.');
const jurisdictionAssignmentSchema = z.object({
  lgu_ids: z.array(z.number().int().positive()).min(1).max(100),
});

platformRoutes.get('/accounts', platformAdmin, async (ctx) => {
  const filters = [];
  if (['citizen', 'admin', 'staff', 'maintenance'].includes(ctx.query.role)) filters.push(sql`u.role = ${ctx.query.role}`);
  if (ctx.query.status === 'active') filters.push(sql`u.is_active`);
  if (ctx.query.status === 'inactive') filters.push(sql`NOT u.is_active`);
  if (ctx.query.q && String(ctx.query.q).trim()) {
    const q = `%${String(ctx.query.q).trim().slice(0, 100).replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    filters.push(sql`(u.full_name ILIKE ${q} OR u.email ILIKE ${q} OR l.name ILIKE ${q})`);
  }
  const where = filters.reduce((acc, filter) => sql`${acc} AND ${filter}`, sql`TRUE`);
  const items = await sql`
    SELECT u.id, u.email, u.full_name, u.phone, u.role, u.lgu_id, u.is_active,
           u.last_login_at, u.created_at, l.name AS lgu_name,
           COALESCE((SELECT array_agg(a.lgu_id ORDER BY a.lgu_id)
                      FROM admin_jurisdiction_assignments a WHERE a.user_id = u.id),
                    CASE WHEN u.role = 'admin' AND u.lgu_id IS NOT NULL THEN ARRAY[u.lgu_id]::int[] ELSE ARRAY[]::int[] END) AS jurisdiction_lgu_ids,
           COALESCE((SELECT json_agg(json_build_object('id', j.id, 'name', j.name, 'level', j.jurisdiction_level) ORDER BY j.name)
                     FROM admin_jurisdiction_assignments a JOIN lgus j ON j.id = a.lgu_id WHERE a.user_id = u.id), '[]'::json) AS jurisdictions
    FROM users u LEFT JOIN lgus l ON l.id = u.lgu_id
    WHERE u.role <> 'platform_admin' AND ${where}
    ORDER BY u.is_active DESC, u.full_name, u.id`;
  ctx.json(200, { items });
});

platformRoutes.patch('/accounts/:id', platformAdmin, async (ctx) => {
  const id = parseId(ctx.params.id, 'account id');
  const body = await readJson(ctx, accountUpdateSchema);
  const result = await sql.begin(async (tx) => {
    const [current] = await tx`SELECT id, role, lgu_id, is_active FROM users WHERE id = ${id} FOR UPDATE`;
    if (!current || current.role === 'platform_admin') throw notFound('Account not found.');
    const role = body.role ?? current.role;
    const isActive = body.is_active ?? current.is_active;
    if (role === current.role && isActive === current.is_active) return { changed: false, role, is_active: isActive };
    if (current.role === 'admin' && current.is_active && (role !== 'admin' || !isActive)) {
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM users
        WHERE role = 'admin' AND lgu_id = ${current.lgu_id} AND is_active AND id <> ${id}`;
      if (n === 0) throw conflict('This is the last active administrator for its LGU. Assign another active administrator before removing access.');
    }
    if (current.role !== 'admin' && role === 'admin') {
      const [newAssignment] = await tx`
        INSERT INTO admin_jurisdiction_assignments (user_id, lgu_id, assigned_by)
        VALUES (${id}, ${current.lgu_id}, ${ctx.user.id})
        ON CONFLICT (user_id, lgu_id) DO NOTHING RETURNING lgu_id`;
      if (newAssignment) await tx`
        INSERT INTO admin_jurisdiction_assignment_history (user_id, lgu_id, action, changed_by, details)
        VALUES (${id}, ${current.lgu_id}, 'assigned', ${ctx.user.id}, ${tx.json({ source: 'role_change' })})`;
    }
    if (current.role === 'admin' && role !== 'admin') {
      const removed = await tx`DELETE FROM admin_jurisdiction_assignments WHERE user_id = ${id} RETURNING lgu_id`;
      for (const row of removed) await tx`
        INSERT INTO admin_jurisdiction_assignment_history (user_id, lgu_id, action, changed_by, details)
        VALUES (${id}, ${row.lgu_id}, 'revoked', ${ctx.user.id}, ${tx.json({ source: 'role_change' })})`;
    }
    await tx`UPDATE users SET role = ${role}, is_active = ${isActive}, updated_at = now() WHERE id = ${id}`;
    await tx`DELETE FROM sessions WHERE user_id = ${id}`;
    await audit(tx, {
      actorId: ctx.user.id, action: 'platform.account.update', targetType: 'user', targetId: id,
      details: {
        ...(role !== current.role ? { role: { from: current.role, to: role } } : {}),
        ...(isActive !== current.is_active ? { is_active: { from: current.is_active, to: isActive } } : {}),
      }, ip: ctx.ip,
    });
    return { changed: true, role, is_active: isActive };
  });
  ctx.json(200, result);
});

platformRoutes.put('/accounts/:id/jurisdictions', platformAdmin, async (ctx) => {
  const id = parseId(ctx.params.id, 'account id');
  const body = await readJson(ctx, jurisdictionAssignmentSchema);
  const requested = [...new Set(body.lgu_ids)];
  if (requested.length !== body.lgu_ids.length) throw badRequest('Choose each jurisdiction only once.');
  const result = await sql.begin(async (tx) => {
    const [account] = await tx`SELECT id, role, lgu_id FROM users WHERE id = ${id} FOR UPDATE`;
    if (!account || account.role !== 'admin') throw conflict('Jurisdiction assignments are only available to LGU administrator accounts.');
    const valid = await tx`SELECT id FROM lgus WHERE id = ANY(${requested}) AND is_active`;
    if (valid.length !== requested.length) throw badRequest('Every assigned jurisdiction must exist and be active.');
    const current = await tx`SELECT lgu_id FROM admin_jurisdiction_assignments WHERE user_id = ${id}`;
    const existing = current.map((row) => row.lgu_id);
    const add = requested.filter((lguId) => !existing.includes(lguId));
    const remove = existing.filter((lguId) => !requested.includes(lguId));
    // Preserve the primary LGU whenever it remains selected. Do not change the
    // primary implicitly just because the UI lists jurisdiction IDs in sort order.
    const nextPrimaryLguId = requested.includes(account.lgu_id) ? account.lgu_id : requested[0];
    const changed = add.length > 0 || remove.length > 0 || account.lgu_id !== nextPrimaryLguId;
    if (!changed) return { changed: false, lgu_ids: requested };
    if (account.lgu_id !== nextPrimaryLguId) {
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM users
        WHERE id <> ${id} AND role = 'admin' AND is_active AND lgu_id = ${account.lgu_id}`;
      if (n === 0) throw conflict('This is the last active administrator for the current primary LGU. Add another administrator before moving the primary assignment.');
    }
    for (const lguId of add) {
      await tx`INSERT INTO admin_jurisdiction_assignments (user_id, lgu_id, assigned_by)
        VALUES (${id}, ${lguId}, ${ctx.user.id}) ON CONFLICT (user_id, lgu_id) DO NOTHING`;
      await tx`INSERT INTO admin_jurisdiction_assignment_history (user_id, lgu_id, action, changed_by, details)
        VALUES (${id}, ${lguId}, 'assigned', ${ctx.user.id},
          ${tx.json({ source: 'management_assignment', prior_lgu_ids: existing, requested_lgu_ids: requested })})`;
    }
    for (const lguId of remove) {
      await tx`DELETE FROM admin_jurisdiction_assignments WHERE user_id = ${id} AND lgu_id = ${lguId}`;
      await tx`INSERT INTO admin_jurisdiction_assignment_history (user_id, lgu_id, action, changed_by, details)
        VALUES (${id}, ${lguId}, 'revoked', ${ctx.user.id},
          ${tx.json({ source: 'management_reassignment', prior_lgu_ids: existing, requested_lgu_ids: requested })})`;
    }
    await tx`UPDATE users SET lgu_id = ${nextPrimaryLguId}, updated_at = now() WHERE id = ${id}`;
    await tx`DELETE FROM sessions WHERE user_id = ${id}`;
    await audit(tx, {
      actorId: ctx.user.id, action: 'platform.jurisdictions.update', targetType: 'user', targetId: id,
      details: { from: existing, to: requested, primary_lgu_id: { from: account.lgu_id, to: nextPrimaryLguId } }, ip: ctx.ip,
    });
    return { changed: true, lgu_ids: requested };
  });
  ctx.json(200, result);
});

platformRoutes.get('/accounts/:id/jurisdiction-history', platformAdmin, async (ctx) => {
  const id = parseId(ctx.params.id, 'account id');
  const [account] = await sql`SELECT id FROM users WHERE id = ${id} AND role <> 'platform_admin'`;
  if (!account) throw notFound('Account not found.');
  const items = await sql`
    SELECT h.id, h.lgu_id, l.name AS lgu_name, l.jurisdiction_level, h.action,
           h.changed_at, h.details, u.full_name AS changed_by_name
    FROM admin_jurisdiction_assignment_history h
    JOIN lgus l ON l.id = h.lgu_id
    LEFT JOIN users u ON u.id = h.changed_by
    WHERE h.user_id = ${id}
    ORDER BY h.changed_at DESC, h.id DESC LIMIT 100`;
  ctx.json(200, { items });
});

platformRoutes.post('/lgus', platformAdmin, async (ctx) => {
  const body = await readJson(ctx, createLguSchema);
  const slug = body.slug || body.name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (slug.length < 2) throw badRequest('Provide a longer LGU name or an explicit slug.');
  const [nameExists] = await sql`SELECT 1 FROM lgus WHERE lower(name) = lower(${body.name})`;
  if (nameExists) throw conflict('An LGU with this name already exists.');
  const [emailExists] = await sql`SELECT 1 FROM users WHERE lower(email) = ${body.admin_email}`;
  if (emailExists) throw conflict('An account with this administrator e-mail already exists.');
  const [slugExists] = await sql`SELECT 1 FROM lgus WHERE slug = ${slug}`;
  if (slugExists) throw conflict('That LGU slug is already in use. Choose a different slug.');

  await assertValidParent(sql, { parentId: body.parent_lgu_id, level: body.jurisdiction_level });
  const passwordHash = await hashPassword(body.temporary_password);
  const created = await sql.begin(async (tx) => {
    const [lgu] = await tx`
      INSERT INTO lgus (name, slug, city, province, jurisdiction_level, parent_lgu_id, jurisdiction_boundary)
      VALUES (${body.name}, ${slug}, ${body.city}, ${body.province}, ${body.jurisdiction_level}, ${body.parent_lgu_id}, ${body.jurisdiction_boundary ? tx.json(body.jurisdiction_boundary) : null})
      RETURNING id, name, slug, city, province, jurisdiction_level, parent_lgu_id, is_active, created_at, jurisdiction_boundary`;

    // Start from safe defaults, never copy another LGU's map centre or
    // agency ID mappings. Those belong to a specific jurisdiction.
    const initialSettings = {
      ...DEFAULT_SETTINGS,
      lgu_name: body.name,
      map_center: body.map_latitude !== null && body.map_longitude !== null
        ? { ...DEFAULT_SETTINGS.map_center, lat: body.map_latitude, lng: body.map_longitude }
        : DEFAULT_SETTINGS.map_center,
    };
    for (const [key, value] of Object.entries(initialSettings)) {
      await tx`
        INSERT INTO settings (lgu_id, key, value, updated_by)
        VALUES (${lgu.id}, ${key}, ${tx.json(value)}, ${ctx.user.id})
        ON CONFLICT (lgu_id, key) DO UPDATE
        SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`;
    }

    const [admin] = await tx`
      INSERT INTO users (email, password_hash, full_name, phone, role, lgu_id, must_change_password)
      VALUES (${body.admin_email}, ${passwordHash}, ${body.admin_name}, ${body.admin_phone || null}, 'admin', ${lgu.id}, TRUE)
      RETURNING id, email, full_name, role, lgu_id`;

    await tx`
      INSERT INTO admin_jurisdiction_assignments (user_id, lgu_id, assigned_by)
      VALUES (${admin.id}, ${lgu.id}, ${ctx.user.id})
      ON CONFLICT (user_id, lgu_id) DO NOTHING`;
    await tx`
      INSERT INTO admin_jurisdiction_assignment_history (user_id, lgu_id, action, changed_by, details)
      VALUES (${admin.id}, ${lgu.id}, 'assigned', ${ctx.user.id}, ${tx.json({ source: 'lgu_provisioning' })})`;

    await audit(tx, {
      actorId: ctx.user.id,
      action: 'lgu.create',
      targetType: 'lgu',
      targetId: lgu.id,
      details: { name: lgu.name, slug: lgu.slug, city: lgu.city, province: lgu.province, jurisdiction_level: lgu.jurisdiction_level, parent_lgu_id: lgu.parent_lgu_id, admin_email: admin.email },
      ip: ctx.ip,
    });
    return { lgu, admin };
  });
  ctx.json(201, { ...created, message: 'LGU created. Share the temporary password with its administrator; they must change it at first sign-in.' });
});

platformRoutes.patch('/lgus/:id', platformAdmin, async (ctx) => {
  const id = parseId(ctx.params.id, 'LGU id');
  const body = await readJson(ctx, z.object({
    is_active: z.boolean().optional(),
    jurisdiction_boundary: z.union([z.record(z.any()), z.null()]).optional().refine(validBoundary, 'Enter a valid GeoJSON Polygon or MultiPolygon with closed coordinate rings.'),
    jurisdiction_level: z.enum(['island_group', 'region', 'province', 'independent_city', 'city', 'municipality', 'barangay']).optional(),
    parent_lgu_id: z.number().int().positive().nullable().optional(),
  }).refine((v) => v.is_active !== undefined || v.jurisdiction_boundary !== undefined || v.jurisdiction_level !== undefined || v.parent_lgu_id !== undefined, 'Nothing to update.'));
  const [currentLgu] = await sql`SELECT id, jurisdiction_level, parent_lgu_id FROM lgus WHERE id = ${id}`;
  if (!currentLgu) throw notFound('LGU not found.');
  await assertValidParent(sql, { lguId: id, parentId: body.parent_lgu_id !== undefined ? body.parent_lgu_id : currentLgu.parent_lgu_id, level: body.jurisdiction_level || currentLgu.jurisdiction_level });
  const [lgu] = await sql`
    UPDATE lgus SET
      is_active = COALESCE(${body.is_active ?? null}, is_active),
      jurisdiction_boundary = CASE WHEN ${body.jurisdiction_boundary !== undefined} THEN ${body.jurisdiction_boundary === null ? null : sql.json(body.jurisdiction_boundary)} ELSE jurisdiction_boundary END,
      jurisdiction_level = COALESCE(${body.jurisdiction_level ?? null}, jurisdiction_level),
      parent_lgu_id = CASE WHEN ${body.parent_lgu_id !== undefined} THEN ${body.parent_lgu_id} ELSE parent_lgu_id END,
      updated_at = now()
    WHERE id = ${id}
    RETURNING id, name, slug, city, province, jurisdiction_level, parent_lgu_id, is_active, created_at, jurisdiction_boundary`;
  if (!lgu) throw notFound('LGU not found.');
  if (body.is_active === false) {
    await sql`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE lgu_id = ${id})`;
  }
  await audit(sql, { actorId: ctx.user.id, action: 'lgu.update', targetType: 'lgu', targetId: id, details: { ...(body.is_active !== undefined ? { is_active: body.is_active } : {}), ...(body.jurisdiction_boundary !== undefined ? { jurisdiction_boundary_updated: true } : {}), ...(body.jurisdiction_level !== undefined ? { jurisdiction_level: body.jurisdiction_level } : {}), ...(body.parent_lgu_id !== undefined ? { parent_lgu_id: body.parent_lgu_id } : {}) }, ip: ctx.ip });
  ctx.json(200, { lgu });
});
