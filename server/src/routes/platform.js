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
