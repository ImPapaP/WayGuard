// Platform-level LGU provisioning. Only platform administrators can create
// LGU tenants; each tenant is created together with its first LGU administrator.
import { z } from 'zod';
import { Router, readJson, parseId, notFound, conflict, badRequest } from '../lib/http.js';
import { sql } from '../db/index.js';
import { requireRole } from '../middleware/auth.js';
import { text, email, password, phone } from '../lib/validation.js';
import { hashPassword } from '../lib/security.js';
import { audit } from '../services/audit.js';
import { destroyUserSessions } from '../services/sessions.js';
import { DEFAULT_SETTINGS } from '../services/settings.js';

export const platformRoutes = new Router('/api/platform');
const platformAdmin = requireRole('platform_admin');

const createLguSchema = z.object({
  name: text(2, 120, 'LGU name'),
  slug: z.string().trim().toLowerCase().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use letters, numbers and hyphens for the LGU slug.').optional(),
  city: text(2, 100, 'City / municipality'),
  province: text(2, 100, 'Province'),
  map_latitude: z.union([z.literal(''), z.null(), z.undefined(), z.coerce.number().min(-90).max(90)])
    .transform((v) => (v === '' || v === null ? null : v)),
  map_longitude: z.union([z.literal(''), z.null(), z.undefined(), z.coerce.number().min(-180).max(180)])
    .transform((v) => (v === '' || v === null ? null : v)),
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
    SELECT l.id, l.name, l.slug, l.city, l.province, l.is_active, l.created_at,
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
  const [emailExists] = await sql`SELECT 1 FROM users WHERE lower(email) = ${body.admin_email}`;
  if (emailExists) throw conflict('An account with this administrator e-mail already exists.');
  const [slugExists] = await sql`SELECT 1 FROM lgus WHERE slug = ${slug}`;
  if (slugExists) throw conflict('That LGU slug is already in use. Choose a different slug.');

  const passwordHash = await hashPassword(body.temporary_password);
  const created = await sql.begin(async (tx) => {
    const [lgu] = await tx`
      INSERT INTO lgus (name, slug, city, province)
      VALUES (${body.name}, ${slug}, ${body.city}, ${body.province})
      RETURNING id, name, slug, city, province, is_active, created_at`;

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
      details: { name: lgu.name, slug: lgu.slug, city: lgu.city, province: lgu.province, admin_email: admin.email },
      ip: ctx.ip,
    });
    return { lgu, admin };
  });
  ctx.json(201, { ...created, message: 'LGU created. Share the temporary password with its administrator; they must change it at first sign-in.' });
});

platformRoutes.patch('/lgus/:id', platformAdmin, async (ctx) => {
  const id = parseId(ctx.params.id, 'LGU id');
  const body = await readJson(ctx, z.object({ is_active: z.boolean() }));
  const [lgu] = await sql`
    UPDATE lgus SET is_active = ${body.is_active}, updated_at = now()
    WHERE id = ${id}
    RETURNING id, name, slug, city, province, is_active, created_at`;
  if (!lgu) throw notFound('LGU not found.');
  if (!body.is_active) {
    await sql`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE lgu_id = ${id})`;
  }
  await audit(sql, { actorId: ctx.user.id, action: 'lgu.update', targetType: 'lgu', targetId: id, details: { is_active: body.is_active }, ip: ctx.ip });
  ctx.json(200, { lgu });
});
