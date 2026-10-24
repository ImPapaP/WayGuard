// Road maintenance personnel endpoints: assigned tasks, progress updates
// with before/progress photos, and completion with after photos.
import { z } from 'zod';
import { Router, readJson, readMultipart } from '../lib/http.js';
import { sql } from '../db/index.js';
import { requireRole } from '../middleware/auth.js';
import { text, optionalText, parseId, pagination } from '../lib/validation.js';
import { config } from '../config.js';
import { validateFileList, storePhotos, removePhotoFiles } from '../services/photos.js';
import * as workflow from '../services/workflow.js';

export const maintenanceRoutes = new Router('/api/maintenance');
const crew = requireRole('maintenance');

const MAX_REPAIR_PHOTOS = 6;

maintenanceRoutes.get('/tasks', crew, async (ctx) => {
  const { page, pageSize, offset } = pagination(ctx.query, { defaultSize: 50 });
  const scope = ctx.query.scope === 'history' ? 'history' : 'active';
  const teamId = ctx.user.team_id || 0;
  const where =
    scope === 'active'
      ? sql`a.team_id = ${teamId} AND a.is_active`
      : sql`a.team_id = ${teamId} AND NOT a.is_active`;
  const rows = await sql`
    SELECT r.id, r.code, r.status, r.severity, r.road_name, r.barangay, r.landmark, r.description,
           r.latitude, r.longitude, r.work_completed_at, r.resolved_at, r.is_demo,
           a.assigned_at, a.due_date, a.instructions, a.ended_at, a.end_reason,
           (SELECT p.id FROM report_photos p WHERE p.report_id = r.id AND p.kind = 'report' ORDER BY p.id LIMIT 1) AS photo_id,
           count(*) OVER()::int AS total
    FROM assignments a JOIN reports r ON r.id = a.report_id
    WHERE ${where}
    ORDER BY ${
      scope === 'active'
        ? sql`(r.work_completed_at IS NOT NULL), a.due_date NULLS LAST,
              CASE r.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, a.assigned_at`
        : sql`a.ended_at DESC`
    }
    LIMIT ${pageSize} OFFSET ${offset}`;
  const [counts] = await sql`
    SELECT count(*) FILTER (WHERE r.status = 'assigned')::int AS assigned,
           count(*) FILTER (WHERE r.status = 'in_progress' AND r.work_completed_at IS NULL)::int AS in_progress,
           count(*) FILTER (WHERE r.work_completed_at IS NOT NULL)::int AS awaiting_verification
    FROM assignments a JOIN reports r ON r.id = a.report_id
    WHERE a.team_id = ${teamId} AND a.is_active`;
  ctx.json(200, {
    team: { id: ctx.user.team_id, name: ctx.user.team_name },
    scope,
    counts,
    items: rows.map(({ total, photo_id, ...r }) => ({
      ...r,
      photo: photo_id ? { url: `/api/photos/${photo_id}`, thumb_url: `/api/photos/${photo_id}?size=thumb` } : null,
    })),
    total: rows[0]?.total ?? 0,
    page,
    pageSize,
  });
});

maintenanceRoutes.post('/tasks/:id/start', crew, async (ctx) => {
  const id = parseId(ctx.params.id, 'task id');
  const body = await readJson(ctx, z.object({ note: optionalText(1000, 'Note') }));
  ctx.json(200, { ok: true, ...(await workflow.startWork(id, ctx.user, body)) });
});

const updateFields = z.object({
  note: text(3, 2000, 'Note'),
  photo_kind: z.enum(['before', 'progress']).default('progress'),
});
const completeFields = z.object({ note: text(3, 2000, 'Repair notes') });

async function handleRepairUpload(ctx, type) {
  const id = parseId(ctx.params.id, 'task id');
  const { fields, files } = await readMultipart(ctx, {
    limit: MAX_REPAIR_PHOTOS * (config.maxPhotoBytes + 64 * 1024) + 256 * 1024,
  });
  let photos;
  let kind;
  let note;
  if (type === 'completion') {
    ({ note } = completeFields.parse(fields));
    kind = 'after';
    // A completion must include at least one "after" photo as evidence.
    photos = validateFileList(files.photos, { min: 1, max: MAX_REPAIR_PHOTOS, label: 'after photos' });
  } else {
    const parsed = updateFields.parse(fields);
    note = parsed.note;
    kind = parsed.photo_kind;
    photos = validateFileList(files.photos, { min: 0, max: MAX_REPAIR_PHOTOS });
  }
  const stored = await storePhotos(photos);
  try {
    const result = await workflow.addRepairUpdate(id, ctx.user, {
      type,
      note,
      photos: stored.map((p) => ({ ...p, kind })),
    });
    ctx.json(201, { ok: true, ...result });
  } catch (err) {
    await removePhotoFiles(stored.map((p) => p.storage_key));
    throw err;
  }
}

maintenanceRoutes.post('/tasks/:id/updates', crew, (ctx) => handleRepairUpload(ctx, 'progress'));
maintenanceRoutes.post('/tasks/:id/complete', crew, (ctx) => handleRepairUpload(ctx, 'completion'));
