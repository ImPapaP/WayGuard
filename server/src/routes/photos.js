// Photo delivery with access control. Files are never exposed as static
// paths; every request checks that the viewer may see the parent report.
import { Router, notFound } from '../lib/http.js';
import { sql } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { parseId } from '../lib/validation.js';
import { assertCanView } from '../services/reports.js';
import { readPhotoFile } from '../services/photos.js';

export const photoRoutes = new Router('/api/photos');

photoRoutes.get('/:id', requireAuth(), async (ctx) => {
  const id = parseId(ctx.params.id, 'photo id');
  const [photo] = await sql`
    SELECT p.id, p.storage_key, p.mime_type, r.id AS report_id, r.reporter_id
    FROM report_photos p JOIN reports r ON r.id = p.report_id
    WHERE p.id = ${id}`;
  if (!photo) throw notFound('Photo not found.');
  await assertCanView(sql, ctx.user, { id: photo.report_id, reporter_id: photo.reporter_id });
  const data = await readPhotoFile(photo.storage_key, ctx.query.size === 'thumb' ? '_thumb.jpg' : '.jpg');
  if (!data) throw notFound('Photo file is missing.');
  const res = ctx.res;
  res.statusCode = 200;
  res.setHeader('Content-Type', photo.mime_type);
  res.setHeader('Content-Length', data.length);
  // Private: browsers may cache it, shared caches may not.
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('Content-Disposition', `inline; filename="wayguard-photo-${photo.id}.jpg"`);
  res.end(ctx.method === 'HEAD' ? undefined : data);
});
