// In-app notifications for the signed-in user.
import { Router } from '../lib/http.js';
import { sql } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { parseId, pagination } from '../lib/validation.js';

export const notificationRoutes = new Router('/api/notifications');

notificationRoutes.get('/', requireAuth(), async (ctx) => {
  const { page, pageSize, offset } = pagination(ctx.query, { defaultSize: 20, maxSize: 50 });
  const unreadOnly = ctx.query.unread === 'true';
  const rows = await sql`
    SELECT n.id, n.type, n.title, n.body, n.read_at, n.created_at, n.report_id, r.code AS report_code,
           count(*) OVER()::int AS total
    FROM notifications n
    LEFT JOIN reports r ON r.id = n.report_id
    WHERE n.user_id = ${ctx.user.id} ${unreadOnly ? sql`AND n.read_at IS NULL` : sql``}
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT ${pageSize} OFFSET ${offset}`;
  const [{ unread }] = await sql`
    SELECT count(*)::int AS unread FROM notifications WHERE user_id = ${ctx.user.id} AND read_at IS NULL`;
  ctx.json(200, {
    items: rows.map(({ total, ...n }) => n),
    total: rows[0]?.total ?? 0,
    unread,
    page,
    pageSize,
  });
});

notificationRoutes.get('/unread-count', requireAuth(), async (ctx) => {
  const [{ unread }] = await sql`
    SELECT count(*)::int AS unread FROM notifications WHERE user_id = ${ctx.user.id} AND read_at IS NULL`;
  ctx.json(200, { unread });
});

notificationRoutes.post('/read-all', requireAuth(), async (ctx) => {
  const rows = await sql`
    UPDATE notifications SET read_at = now() WHERE user_id = ${ctx.user.id} AND read_at IS NULL RETURNING id`;
  ctx.json(200, { updated: rows.length });
});

notificationRoutes.post('/:id/read', requireAuth(), async (ctx) => {
  const id = parseId(ctx.params.id, 'notification id');
  // The user_id condition makes it impossible to touch someone else's rows.
  await sql`
    UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = ${id} AND user_id = ${ctx.user.id}`;
  ctx.json(200, { ok: true });
});
