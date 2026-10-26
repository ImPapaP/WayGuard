// Report exports (CSV / PDF) and the printable summary report.
import { Router } from '../lib/http.js';
import { sql } from '../db/index.js';
import { requireRole } from '../middleware/auth.js';
import { RateLimiter } from '../lib/security.js';
import { audit } from '../services/audit.js';
import { getSettings } from '../services/settings.js';
import { computeStats } from '../services/stats.js';
import { loadExportRows, toCsv, reportsPdf, summaryPdf } from '../services/exporter.js';

export const exportRoutes = new Router('/api/admin/exports');
const admin = requireRole('admin', 'staff');
const limiter = new RateLimiter({ windowMs: 10 * 60 * 1000, max: 30, name: 'exports' });

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

function filterSummary(query) {
  const keys = ['q', 'status', 'severity', 'barangay', 'team_id', 'agency_id', 'from', 'to'];
  return Object.fromEntries(keys.filter((k) => query[k]).map((k) => [k, String(query[k]).slice(0, 100)]));
}

exportRoutes.get('/reports.csv', admin, async (ctx) => {
  limiter.consume(`user:${ctx.user.id}`, ctx);
  const rows = await loadExportRows(ctx.query, 10000, ctx.user.accessible_lgu_ids || [ctx.user.lgu_id]);
  await audit(sql, {
    actorId: ctx.user.id,
    action: 'export.csv',
    targetType: 'reports',
    details: { count: rows.length, filters: filterSummary(ctx.query) },
    ip: ctx.ip,
  });
  ctx.send(200, toCsv(rows), 'text/csv; charset=utf-8', {
    'Content-Disposition': `attachment; filename="wayguard-reports-${stamp()}.csv"`,
    'Cache-Control': 'no-store',
  });
});

exportRoutes.get('/reports.pdf', admin, async (ctx) => {
  limiter.consume(`user:${ctx.user.id}`, ctx);
  const rows = await loadExportRows(ctx.query, 2000, ctx.user.accessible_lgu_ids || [ctx.user.lgu_id]);
  const { lgu_name } = await getSettings(sql, ctx.user.lgu_id);
  const pdf = await reportsPdf(rows, { query: ctx.query, lguName: lgu_name });
  await audit(sql, {
    actorId: ctx.user.id,
    action: 'export.pdf',
    targetType: 'reports',
    details: { count: rows.length, filters: filterSummary(ctx.query) },
    ip: ctx.ip,
  });
  ctx.send(200, pdf, 'application/pdf', {
    'Content-Disposition': `attachment; filename="wayguard-reports-${stamp()}.pdf"`,
    'Cache-Control': 'no-store',
  });
});

exportRoutes.get('/summary.pdf', admin, async (ctx) => {
  limiter.consume(`user:${ctx.user.id}`, ctx);
  const stats = await computeStats(ctx.query, ctx.user.accessible_lgu_ids || [ctx.user.lgu_id]);
  const { lgu_name } = await getSettings(sql, ctx.user.lgu_id);
  const pdf = await summaryPdf(stats, { lguName: lgu_name });
  await audit(sql, {
    actorId: ctx.user.id,
    action: 'export.summary_pdf',
    targetType: 'reports',
    details: { range: stats.range },
    ip: ctx.ip,
  });
  ctx.send(200, pdf, 'application/pdf', {
    'Content-Disposition': `attachment; filename="wayguard-summary-${stamp()}.pdf"`,
    'Cache-Control': 'no-store',
  });
});
