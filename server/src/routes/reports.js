// Report endpoints used by citizens (and shared report-detail access for
// staff): submit, list own reports, view details, nearby check, feedback.
import { z } from 'zod';
import { Router, readJson, readMultipart, HttpError, conflict } from '../lib/http.js';
import { sql } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  text,
  optionalText,
  severity,
  roadType,
  latitude,
  longitude,
  parseId,
  pagination,
  HAZARDS,
  STATUSES,
} from '../lib/validation.js';
import { RateLimiter } from '../lib/security.js';
import { config } from '../config.js';
import { getSettings } from '../services/settings.js';
import { validateFileList, storePhotos, removePhotoFiles } from '../services/photos.js';
import {
  nextReportCode,
  recordEvent,
  findDuplicateCandidates,
  getReportDetail,
  photoUrls,
  OPEN_STATUSES,
} from '../services/reports.js';
import { notifyUsers, adminIds } from '../services/notifications.js';

const submitLimiter = new RateLimiter({ windowMs: 60 * 60 * 1000, max: 10, name: 'reports submitted' });

const hazardsField = z
  .union([z.string(), z.array(z.string()), z.undefined()])
  .transform((v) => {
    if (v === undefined) return [];
    if (Array.isArray(v)) return v;
    const s = v.trim();
    if (!s) return [];
    if (s.startsWith('[')) {
      try {
        return JSON.parse(s);
      } catch {
        return ['__invalid__'];
      }
    }
    return s.split(',').map((x) => x.trim());
  })
  .pipe(z.array(z.enum(HAZARDS, { errorMap: () => ({ message: 'Unknown hazard selected.' }) })).max(HAZARDS.length))
  .transform((arr) => [...new Set(arr)]);

const createSchema = z.object({
  description: text(10, 2000, 'Description'),
  road_name: text(2, 150, 'Road or street name'),
  barangay: optionalText(100, 'Barangay'),
  city: optionalText(100, 'City / municipality'),
  landmark: optionalText(200, 'Landmark'),
  hazards: hazardsField,
  road_type: roadType.default('unknown'),
  severity,
  latitude,
  longitude,
  location_source: z.enum(['gps', 'map', 'address'], {
    errorMap: () => ({ message: 'Set the pothole location using GPS, the map or an address.' }),
  }),
  location_accuracy_m: z
    .union([z.literal(''), z.undefined(), z.coerce.number().min(0).max(100000)])
    .transform((v) => (v === '' || v === undefined ? null : Math.round(v * 10) / 10)),
});

const feedbackSchema = z.object({
  rating: z.number().int().min(1, 'Choose a rating from 1 to 5.').max(5, 'Choose a rating from 1 to 5.'),
  comment: optionalText(1000, 'Comment'),
});

export const reportRoutes = new Router('/api/reports');

// Submit a new pothole report (multipart form with photos).
reportRoutes.post('/', requireRole('citizen'), async (ctx) => {
  submitLimiter.consume(`user:${ctx.user.id}`, ctx);
  const settings = await getSettings(sql, ctx.user.lgu_id);
  const { fields, files } = await readMultipart(ctx, {
    limit: settings.max_photos_per_report * (config.maxPhotoBytes + 64 * 1024) + 256 * 1024,
  });
  const data = createSchema.parse(fields);
  const photos = validateFileList(files.photos, { min: 1, max: settings.max_photos_per_report });

  // Prevent the same person from filing the same pothole twice.
  const [recent] = await sql`
    SELECT code FROM reports
    WHERE reporter_id = ${ctx.user.id} AND lgu_id = ${ctx.user.lgu_id}
      AND status = ANY(${OPEN_STATUSES})
      AND created_at > now() - interval '24 hours'
      AND wg_distance_m(${data.latitude}, ${data.longitude}, latitude, longitude) <= 25
    LIMIT 1`;
  if (recent) {
    throw conflict(
      `You already reported a pothole at this spot today (${recent.code}). You can follow its progress in My Reports.`,
      { existing_code: recent.code },
    );
  }

  const stored = await storePhotos(photos);
  try {
    const result = await sql.begin(async (tx) => {
      const code = await nextReportCode(tx);
      const agencyId = settings.road_type_agency?.[data.road_type] ?? null;
      const [agency] = agencyId ? await tx`SELECT id FROM agencies WHERE id = ${agencyId} AND lgu_id = ${ctx.user.lgu_id} AND is_active` : [];
      const [report] = await tx`
        INSERT INTO reports (lgu_id, code, reporter_id, description, road_name, barangay, city, landmark, hazards,
                             road_type, reported_severity, severity, latitude, longitude, location_source,
                             location_accuracy_m, agency_id)
        VALUES (${ctx.user.lgu_id}, ${code}, ${ctx.user.id}, ${data.description}, ${data.road_name}, ${data.barangay}, ${data.city},
                ${data.landmark}, ${data.hazards}, ${data.road_type}, ${data.severity}, ${data.severity},
                ${data.latitude}, ${data.longitude}, ${data.location_source}, ${data.location_accuracy_m},
                ${agency ? agency.id : null})
        RETURNING id, code, status, created_at`;
      for (const p of stored) {
        await tx`
          INSERT INTO report_photos (report_id, uploaded_by, kind, storage_key, mime_type, width, height, size_bytes)
          VALUES (${report.id}, ${ctx.user.id}, 'report', ${p.storage_key}, ${p.mime_type}, ${p.width}, ${p.height}, ${p.size_bytes})`;
      }
      await recordEvent(tx, {
        reportId: report.id,
        actorId: ctx.user.id,
        type: 'created',
        to: 'submitted',
        message: 'Report submitted.',
        isPublic: true,
      });
      const candidates = await findDuplicateCandidates(tx, {
        lat: data.latitude,
        lng: data.longitude,
        roadName: data.road_name,
        barangay: data.barangay,
        createdAt: report.created_at,
        excludeId: report.id,
        radiusM: settings.duplicate_radius_m,
        windowDays: settings.duplicate_window_days,
        lguId: ctx.user.lgu_id,
      });
      if (candidates.length) {
        await recordEvent(tx, {
          reportId: report.id,
          type: 'duplicate_flagged',
          message: `System found ${candidates.length} possible duplicate${candidates.length > 1 ? 's' : ''}: ${candidates
            .slice(0, 5)
            .map((c) => `${c.code} (${Math.round(c.distance_m)} m)`)
            .join(', ')}.`,
          isPublic: false,
          meta: { candidates: candidates.map((c) => ({ id: c.id, code: c.code, distance_m: c.distance_m, score: c.score })) },
        });
      }
      await notifyUsers(tx, {
        userIds: await adminIds(tx, ctx.user.lgu_id),
        reportId: report.id,
        type: 'report_submitted',
        title: `New report ${code}`,
        body: `${data.severity[0].toUpperCase()}${data.severity.slice(1)} severity pothole on ${data.road_name}${
          candidates.length ? ` — ${candidates.length} possible duplicate(s) nearby` : ''
        }.`,
      });
      return { report, possibleDuplicates: candidates.length };
    });
    ctx.json(201, {
      report: result.report,
      possible_duplicates: result.possibleDuplicates,
    });
  } catch (err) {
    await removePhotoFiles(stored.map((s) => s.storage_key));
    throw err;
  }
});

// The signed-in citizen's own reports.
reportRoutes.get('/mine', requireRole('citizen'), async (ctx) => {
  const { page, pageSize, offset } = pagination(ctx.query, { defaultSize: 20 });
  const statuses = String(ctx.query.status || '')
    .split(',')
    .filter((s) => STATUSES.includes(s));
  const filter = statuses.length ? sql`AND r.status = ANY(${statuses})` : sql``;
  const rows = await sql`
    SELECT r.id, r.code, r.status, r.severity, r.road_name, r.barangay, r.landmark, r.created_at, r.updated_at,
           r.resolved_at, r.work_completed_at, r.latitude, r.longitude, r.is_demo,
           (SELECT p.id FROM report_photos p WHERE p.report_id = r.id AND p.kind = 'report' ORDER BY p.id LIMIT 1) AS photo_id,
           EXISTS (SELECT 1 FROM feedback f WHERE f.report_id = r.id) AS has_feedback,
           count(*) OVER()::int AS total
    FROM reports r
    WHERE r.reporter_id = ${ctx.user.id} ${filter}
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT ${pageSize} OFFSET ${offset}`;
  const counts = await sql`
    SELECT status, count(*)::int AS n FROM reports WHERE reporter_id = ${ctx.user.id} GROUP BY status`;
  ctx.json(200, {
    items: rows.map(({ total, photo_id, ...r }) => ({ ...r, photo: photo_id ? photoUrls(photo_id) : null })),
    total: rows[0]?.total ?? 0,
    page,
    pageSize,
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
  });
});

// Open reports near a point — shown on the report form so people can see
// whether the pothole was already reported. Only public-safe fields.
reportRoutes.get('/nearby', requireAuth(), async (ctx) => {
  const lat = latitude.parse(ctx.query.lat);
  const lng = longitude.parse(ctx.query.lng);
  const settings = await getSettings(sql, ctx.user.lgu_id);
  const radius = Math.min(300, Math.max(settings.duplicate_radius_m, Number(ctx.query.radius) || 100));
  const items = await findDuplicateCandidates(sql, {
    lat,
    lng,
    roadName: String(ctx.query.road || ''),
    barangay: null,
    radiusM: radius,
    windowDays: settings.duplicate_window_days,
    lguId: ctx.user.lgu_id,
  });
  ctx.json(200, {
    radius_m: radius,
    items: items.map((c) => ({
      code: c.code,
      status: c.status,
      severity: c.severity,
      road_name: c.road_name,
      landmark: c.landmark,
      created_at: c.created_at,
      distance_m: Math.round(c.distance_m),
    })),
  });
});

// Report details, shaped for the viewer's role.
reportRoutes.get('/:id', requireAuth(), async (ctx) => {
  const id = parseId(ctx.params.id, 'report id');
  ctx.json(200, { report: await getReportDetail(sql, id, ctx.user) });
});

// Reporter feedback on a resolved report (one per report).
reportRoutes.post('/:id/feedback', requireRole('citizen'), async (ctx) => {
  const id = parseId(ctx.params.id, 'report id');
  const body = await readJson(ctx, feedbackSchema);
  await sql.begin(async (tx) => {
    const [r] = await tx`SELECT id, code, reporter_id, status, lgu_id FROM reports WHERE id = ${id} FOR UPDATE`;
    if (!r || r.reporter_id !== ctx.user.id) throw new HttpError(404, 'Report not found.', undefined, 'not_found');
    if (r.status !== 'resolved') throw conflict('Feedback can be given once the repair is resolved.');
    const [exists] = await tx`SELECT 1 FROM feedback WHERE report_id = ${id}`;
    if (exists) throw conflict('You already sent feedback for this report.');
    await tx`INSERT INTO feedback (report_id, user_id, rating, comment) VALUES (${id}, ${ctx.user.id}, ${body.rating}, ${body.comment})`;
    await recordEvent(tx, {
      reportId: id,
      actorId: ctx.user.id,
      type: 'feedback',
      message: `Reporter rated the repair ${body.rating}/5.`,
      isPublic: true,
      meta: { rating: body.rating },
    });
    await notifyUsers(tx, {
      userIds: await adminIds(tx, r.lgu_id),
      reportId: id,
      type: 'feedback_received',
      title: `${r.code}: feedback ${body.rating}/5`,
      body: body.comment ? body.comment.slice(0, 200) : 'The reporter rated the completed repair.',
    });
  });
  ctx.json(201, { ok: true });
});
