// Endpoints that need no sign-in: app configuration, the public pothole map
// and headline numbers. They only ever return verified, non-personal data:
// no reporter identity, no photos, no internal notes.
import { Router } from '../lib/http.js';
import { sql } from '../db/index.js';
import { config } from '../config.js';
import { getSettings } from '../services/settings.js';
import { publicShape, PUBLIC_STATUSES } from '../services/reports.js';

export const publicRoutes = new Router('/api/public');

publicRoutes.get('/config', async (ctx) => {
  const lguId = ctx.user?.role === 'platform_admin' ? 1 : (ctx.user?.lgu_id || 1);
  const s = await getSettings(sql, lguId);
  ctx.json(200, {
    lgu_name: s.lgu_name,
    lgus: await sql`SELECT id, name, slug, city, province FROM lgus WHERE is_active ORDER BY name`,
    jurisdiction_boundary: ctx.user?.lgu_id ? (await sql`SELECT jurisdiction_boundary FROM lgus WHERE id = ${ctx.user.lgu_id}`)[0]?.jurisdiction_boundary ?? null : null,
    map_center: s.map_center,
    max_photos_per_report: s.max_photos_per_report,
    max_photo_mb: Math.round(config.maxPhotoBytes / 1048576),
    duplicate_radius_m: s.duplicate_radius_m,
    tiles: config.tiles,
    // Only the browser Maps JavaScript API key is shared (it is public by
    // design and must be restricted to this site's address in Google Cloud).
    map: {
      provider: config.maps.provider,
      ...(config.maps.provider === 'google'
        ? { google_api_key: config.maps.googleApiKey, google_map_id: config.maps.googleMapId }
        : {}),
      ...(config.maps.provider === 'vector' ? { vector: config.maps.vector } : {}),
    },
    geocoder_enabled: config.geocoder.enabled,
  });
});

// Verified reports for the public map. Resolved reports stay visible for a
// configurable number of days. Optional bbox=minLng,minLat,maxLng,maxLat.
publicRoutes.get('/reports', async (ctx) => {
  const s = await getSettings();
  const conds = [sql`r.status = ANY(${PUBLIC_STATUSES})`];
  conds.push(
    sql`(r.status <> 'resolved' OR r.resolved_at >= now() - make_interval(days => ${s.public_resolved_days}))`,
  );
  const bbox = String(ctx.query.bbox || '')
    .split(',')
    .map(Number);
  if (bbox.length === 4 && bbox.every(Number.isFinite)) {
    const [minLng, minLat, maxLng, maxLat] = bbox;
    conds.push(sql`r.latitude BETWEEN ${minLat} AND ${maxLat} AND r.longitude BETWEEN ${minLng} AND ${maxLng}`);
  }
  const severities = String(ctx.query.severity || '')
    .split(',')
    .filter((x) => ['low', 'medium', 'high'].includes(x));
  if (severities.length) conds.push(sql`r.severity = ANY(${severities})`);
  const statuses = String(ctx.query.status || '')
    .split(',')
    .filter((x) => PUBLIC_STATUSES.includes(x));
  if (statuses.length) conds.push(sql`r.status = ANY(${statuses})`);
  const where = conds.reduce((acc, c) => sql`${acc} AND ${c}`, sql`TRUE`);
  const rows = await sql`
    SELECT r.* FROM reports r WHERE ${where}
    ORDER BY r.created_at DESC
    LIMIT 2000`;
  ctx.json(200, { items: rows.map(publicShape) });
});

publicRoutes.get('/stats', async (ctx) => {
  const [row] = await sql`
    SELECT
      count(*)::int AS total_reports,
      count(*) FILTER (WHERE status = 'resolved')::int AS resolved,
      count(*) FILTER (WHERE status IN ('verified', 'assigned', 'in_progress'))::int AS in_repair_pipeline,
      round(avg(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 86400) FILTER (WHERE status = 'resolved')::numeric, 1)::float AS avg_days_to_resolve
    FROM reports`;
  ctx.json(200, row);
});
