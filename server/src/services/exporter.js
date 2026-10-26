// CSV and PDF exports for authorized personnel. Exports leave out reporter
// identity and contact details (data minimisation); staff can see those in
// the app when they need to contact a reporter.
import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { sql } from '../db/index.js';
import { ROOT_DIR, config } from '../config.js';
import { adminFilters } from './reports.js';
import { STATUS_LABELS } from './notifications.js';

const NAVY = rgb(10 / 255, 34 / 255, 68 / 255);
const AMBER = rgb(250 / 255, 174 / 255, 11 / 255);
const CLOUD = rgb(245 / 255, 247 / 255, 250 / 255);
const INK = rgb(6 / 255, 20 / 255, 41 / 255);
const MUTED = rgb(74 / 255, 85 / 255, 104 / 255);
const LINE = rgb(219 / 255, 225 / 255, 234 / 255);
const MID_NAVY = rgb(43 / 255, 79 / 255, 138 / 255);
const WHITE = rgb(1, 1, 1);

const SEVERITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High' };

function fmtDate(d) {
  if (!d) return '';
  return new Intl.DateTimeFormat('en-PH', { timeZone: config.timezone, year: 'numeric', month: 'short', day: '2-digit' }).format(new Date(d));
}
function fmtDateTime(d) {
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: config.timezone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(d));
}

export async function loadExportRows(query, limit, lguId = null) {
  const where = adminFilters(query, lguId);
  return sql`
    SELECT r.code, r.status, r.severity, r.reported_severity, r.road_name, r.barangay, r.city, r.landmark,
           r.road_type, r.hazards, r.latitude, r.longitude, r.location_source, r.created_at, r.verified_at,
           r.work_completed_at, r.resolved_at, r.is_demo, ag.name AS agency_name, t.name AS team_name,
           f.rating AS feedback_rating, d.code AS duplicate_of
    FROM reports r
    LEFT JOIN agencies ag ON ag.id = r.agency_id
    LEFT JOIN assignments a ON a.report_id = r.id AND a.is_active
    LEFT JOIN maintenance_teams t ON t.id = a.team_id
    LEFT JOIN feedback f ON f.report_id = r.id
    LEFT JOIN reports d ON d.id = r.duplicate_of_id
    WHERE ${where}
    ORDER BY r.created_at DESC
    LIMIT ${limit}`;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = Array.isArray(value) ? value.join('; ') : value instanceof Date ? value.toISOString() : String(value);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows) {
  const columns = [
    ['code', 'Report code'],
    ['status', 'Status'],
    ['severity', 'Severity'],
    ['reported_severity', 'Reported severity'],
    ['road_name', 'Road'],
    ['barangay', 'Barangay'],
    ['city', 'City/Municipality'],
    ['landmark', 'Landmark'],
    ['road_type', 'Road type'],
    ['hazards', 'Hazards'],
    ['latitude', 'Latitude'],
    ['longitude', 'Longitude'],
    ['location_source', 'Location source'],
    ['agency_name', 'Responsible agency'],
    ['team_name', 'Assigned team'],
    ['duplicate_of', 'Duplicate of'],
    ['created_at', 'Reported at (UTC)'],
    ['verified_at', 'Verified at (UTC)'],
    ['work_completed_at', 'Work completed at (UTC)'],
    ['resolved_at', 'Resolved at (UTC)'],
    ['feedback_rating', 'Feedback rating'],
    ['is_demo', 'Demo record'],
  ];
  const lines = [columns.map(([, label]) => csvCell(label)).join(',')];
  for (const r of rows) {
    lines.push(
      columns
        .map(([key]) => {
          if (key === 'status') return csvCell(STATUS_LABELS[r.status]);
          if (key === 'is_demo') return csvCell(r.is_demo ? 'yes' : 'no');
          return csvCell(r[key]);
        })
        .join(','),
    );
  }
  // BOM so Excel opens UTF-8 (e.g. "Santo Niño") correctly.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// PDF helpers
// ---------------------------------------------------------------------------
let logoBytes = null;
async function logo() {
  if (!logoBytes) {
    logoBytes = await fs.readFile(path.join(ROOT_DIR, 'client', 'public', 'brand', 'wayguard-logotype-wmark-color.png'));
  }
  return logoBytes;
}

// Standard PDF fonts only cover WinAnsi; replace anything else.
function makeSafe(font) {
  const supported = new Set(font.getCharacterSet());
  return (value) =>
    Array.from(String(value ?? ''))
      .map((ch) => (supported.has(ch.codePointAt(0)) ? ch : ch === '—' || ch === '–' ? '-' : '?'))
      .join('');
}

function fit(text, font, size, width) {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > width) t = t.slice(0, -1);
  return `${t}...`;
}

async function newDoc(title) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor('Wayguard');
  doc.setCreator('Wayguard — Road Pothole Reporting and Monitoring System');
  doc.setProducer('Wayguard (pdf-lib)');
  doc.setCreationDate(new Date());
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const logoImage = await doc.embedPng(await logo());
  return { doc, fonts, logoImage };
}

// Draws the branded page header and returns the y position below it.
function drawHeader(page, { fonts, logoImage }, { title, subtitle, lguName }) {
  const { width, height } = page.getSize();
  const margin = 36;
  // Full-colour logotype on a white page. Width keeps it above the brand
  // sheet's 160 px minimum; the surrounding space respects the clear zone.
  const logoW = 150;
  const logoH = (logoImage.height / logoImage.width) * logoW;
  page.drawImage(logoImage, { x: margin, y: height - margin - logoH, width: logoW, height: logoH });
  const safe = makeSafe(fonts.bold);
  const safeR = makeSafe(fonts.regular);
  page.drawText(safe(title), {
    x: width - margin - fonts.bold.widthOfTextAtSize(safe(title), 16),
    y: height - margin - 16,
    size: 16,
    font: fonts.bold,
    color: NAVY,
  });
  const lgu = safeR(lguName);
  page.drawText(lgu, {
    x: width - margin - fonts.regular.widthOfTextAtSize(lgu, 9),
    y: height - margin - 30,
    size: 9,
    font: fonts.regular,
    color: MUTED,
  });
  const sub = safeR(subtitle);
  page.drawText(sub, {
    x: width - margin - fonts.regular.widthOfTextAtSize(sub, 8),
    y: height - margin - 42,
    size: 8,
    font: fonts.regular,
    color: MUTED,
  });
  const ruleY = height - margin - Math.max(logoH, 46) - 10;
  page.drawRectangle({ x: margin, y: ruleY, width: 60, height: 3, color: AMBER });
  page.drawLine({ start: { x: margin + 64, y: ruleY + 1.5 }, end: { x: width - margin, y: ruleY + 1.5 }, thickness: 0.5, color: LINE });
  return ruleY - 16;
}

function drawFooters(doc, fonts) {
  const pages = doc.getPages();
  pages.forEach((page, i) => {
    const { width } = page.getSize();
    const left = 'Generated by Wayguard - for authorized LGU personnel only';
    const right = `Page ${i + 1} of ${pages.length}`;
    page.drawText(left, { x: 36, y: 20, size: 7.5, font: fonts.regular, color: MUTED });
    page.drawText(right, {
      x: width - 36 - fonts.regular.widthOfTextAtSize(right, 7.5),
      y: 20,
      size: 7.5,
      font: fonts.regular,
      color: MUTED,
    });
  });
}

function describeFilters(query) {
  const parts = [];
  if (query.status) parts.push(`status: ${query.status.split(',').map((s) => STATUS_LABELS[s] || s).join(', ')}`);
  if (query.severity) parts.push(`severity: ${query.severity}`);
  if (query.barangay) parts.push(`barangay: ${query.barangay}`);
  if (query.q) parts.push(`search: "${String(query.q).slice(0, 40)}"`);
  if (query.from || query.to) parts.push(`reported ${query.from || '...'} to ${query.to || '...'}`);
  return parts.length ? `Filters - ${parts.join('; ')}` : 'All reports';
}

// ---------------------------------------------------------------------------
// Reports list PDF (A4 landscape)
// ---------------------------------------------------------------------------
export async function reportsPdf(rows, { query, lguName }) {
  const ctx = await newDoc('Wayguard pothole reports');
  const { doc, fonts } = ctx;
  const safe = makeSafe(fonts.regular);
  const columns = [
    { key: 'code', label: 'Code', w: 92 },
    { key: 'status', label: 'Status', w: 74 },
    { key: 'severity', label: 'Severity', w: 50 },
    { key: 'road', label: 'Road / Barangay', w: 176 },
    { key: 'landmark', label: 'Landmark', w: 120 },
    { key: 'created', label: 'Reported', w: 66 },
    { key: 'team', label: 'Team', w: 88 },
    { key: 'agency', label: 'Agency', w: 104 },
  ];
  const size = 8;
  const rowH = 16;
  const margin = 36;
  let page;
  let y;
  const subtitle = `${describeFilters(query)} | ${rows.length} report(s) | ${fmtDateTime(new Date())}`;

  const startPage = () => {
    page = doc.addPage([841.89, 595.28]);
    y = drawHeader(page, ctx, { title: 'Pothole Reports', subtitle, lguName });
    let x = margin;
    page.drawRectangle({ x: margin, y: y - 5, width: 841.89 - margin * 2, height: rowH, color: NAVY });
    for (const c of columns) {
      page.drawText(c.label, { x: x + 4, y: y, size, font: fonts.bold, color: WHITE });
      x += c.w;
    }
    y -= rowH;
  };
  startPage();
  if (!rows.length) {
    page.drawText('No reports match these filters.', { x: margin + 4, y, size: 10, font: fonts.regular, color: MUTED });
  }
  rows.forEach((r, i) => {
    if (y < 48) startPage();
    if (i % 2 === 0) page.drawRectangle({ x: margin, y: y - 5, width: 841.89 - margin * 2, height: rowH, color: CLOUD });
    const values = {
      code: r.code + (r.is_demo ? ' \u2020' : ''),
      status: STATUS_LABELS[r.status] + (r.status === 'in_progress' && r.work_completed_at ? '*' : ''),
      severity: SEVERITY_LABEL[r.severity],
      road: [r.road_name, r.barangay].filter(Boolean).join(', '),
      landmark: r.landmark || '',
      created: fmtDate(r.created_at),
      team: r.team_name || '',
      agency: r.agency_name || '',
    };
    let x = margin;
    for (const c of columns) {
      const font = c.key === 'code' ? fonts.bold : fonts.regular;
      const text = fit(safe(values[c.key]), font, size, c.w - 8);
      page.drawText(text, { x: x + 4, y, size, font, color: c.key === 'severity' && r.severity === 'high' ? rgb(0.62, 0.16, 0.1) : INK });
      x += c.w;
    }
    y -= rowH;
  });
  const notes = [];
  if (rows.some((r) => r.status === 'in_progress' && r.work_completed_at)) {
    notes.push('* Repair submitted as completed; awaiting LGU verification.');
  }
  if (rows.some((r) => r.is_demo)) notes.push('\u2020 Demonstration record created by the seed script.');
  for (const note of notes) {
    if (y < 48) startPage();
    page.drawText(safe(note), { x: margin, y: y - 6, size: 7.5, font: fonts.regular, color: MUTED });
    y -= 12;
  }
  drawFooters(doc, fonts);
  return Buffer.from(await doc.save());
}

// ---------------------------------------------------------------------------
// Summary statistics PDF (A4 portrait)
// ---------------------------------------------------------------------------
export async function summaryPdf(stats, { lguName }) {
  const ctx = await newDoc('Wayguard summary report');
  const { doc, fonts } = ctx;
  const safe = makeSafe(fonts.regular);
  const W = 595.28;
  const margin = 36;
  const page = doc.addPage([W, 841.89]);
  const range = stats.range.from || stats.range.to ? `Reported ${stats.range.from || '...'} to ${stats.range.to || '...'}` : 'All time';
  let y = drawHeader(page, ctx, {
    title: 'Summary Report',
    subtitle: `${range} | generated ${fmtDateTime(stats.generated_at)}`,
    lguName,
  });

  const t = stats.totals;
  const tiles = [
    ['Total reports', t.total],
    ['Pending review', t.pending_review],
    ['Awaiting assignment', t.awaiting_assignment],
    ['Active repairs', t.active_repairs],
    ['Resolved', t.resolved],
    ['Avg. days to resolve', t.avg_resolution_days ?? '-'],
  ];
  const tileW = (W - margin * 2 - 5 * 8) / 6;
  tiles.forEach(([label, value], i) => {
    const x = margin + i * (tileW + 8);
    page.drawRectangle({ x, y: y - 50, width: tileW, height: 54, color: CLOUD, borderColor: LINE, borderWidth: 0.5 });
    page.drawRectangle({ x, y: y + 2, width: tileW, height: 2, color: i === 4 ? AMBER : NAVY });
    page.drawText(String(value), { x: x + 8, y: y - 22, size: 18, font: fonts.bold, color: NAVY });
    page.drawText(safe(label), { x: x + 8, y: y - 40, size: 7, font: fonts.regular, color: MUTED });
  });
  y -= 78;

  const sectionTitle = (text) => {
    page.drawText(text, { x: margin, y, size: 11, font: fonts.bold, color: NAVY });
    y -= 16;
  };

  const barRows = (items, max, colour) => {
    const labelW = 130;
    const barMax = W - margin * 2 - labelW - 50;
    for (const [label, value] of items) {
      page.drawText(fit(safe(label), fonts.regular, 8.5, labelW - 8), { x: margin, y, size: 8.5, font: fonts.regular, color: INK });
      const bw = max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * barMax) : 0;
      page.drawRectangle({ x: margin + labelW, y: y - 2, width: barMax, height: 9, color: CLOUD });
      if (bw) page.drawRectangle({ x: margin + labelW, y: y - 2, width: bw, height: 9, color: colour });
      page.drawText(String(value), { x: margin + labelW + barMax + 8, y, size: 8.5, font: fonts.bold, color: INK });
      y -= 15;
    }
    y -= 8;
  };

  sectionTitle('Reports by status');
  const statusItems = Object.keys(STATUS_LABELS).map((s) => [STATUS_LABELS[s], stats.by_status[s] || 0]);
  barRows(statusItems, Math.max(1, ...statusItems.map(([, v]) => v)), NAVY);

  sectionTitle('Reports by severity (open / total)');
  for (const s of ['high', 'medium', 'low']) {
    const v = stats.by_severity[s] || { open: 0, total: 0 };
    page.drawText(`${SEVERITY_LABEL[s]}`, { x: margin, y, size: 8.5, font: fonts.regular, color: INK });
    page.drawText(`${v.open} open / ${v.total} total`, { x: margin + 130, y, size: 8.5, font: fonts.bold, color: INK });
    y -= 15;
  }
  y -= 8;

  sectionTitle('Monthly trend (reported vs. resolved)');
  const maxMonth = Math.max(1, ...stats.monthly.flatMap((m) => [m.reported, m.resolved]));
  const chartH = 90;
  const colW = (W - margin * 2) / stats.monthly.length;
  const baseY = y - chartH;
  page.drawLine({ start: { x: margin, y: baseY }, end: { x: W - margin, y: baseY }, thickness: 0.5, color: LINE });
  stats.monthly.forEach((m, i) => {
    const x0 = margin + i * colW + colW / 2 - 18;
    const h1 = (m.reported / maxMonth) * chartH;
    const h2 = (m.resolved / maxMonth) * chartH;
    page.drawRectangle({ x: x0, y: baseY, width: 16, height: h1, color: NAVY });
    page.drawRectangle({ x: x0 + 20, y: baseY, width: 16, height: h2, color: AMBER });
    page.drawText(String(m.reported), { x: x0 + 2, y: baseY + h1 + 3, size: 7, font: fonts.regular, color: INK });
    page.drawText(String(m.resolved), { x: x0 + 22, y: baseY + h2 + 3, size: 7, font: fonts.regular, color: INK });
    const [yy, mm] = m.month.split('-');
    const label = new Date(Number(yy), Number(mm) - 1, 1).toLocaleString('en-US', { month: 'short' }) + ` ${yy.slice(2)}`;
    page.drawText(label, { x: x0 + 4, y: baseY - 11, size: 7.5, font: fonts.regular, color: MUTED });
  });
  y = baseY - 26;
  page.drawRectangle({ x: margin, y: y, width: 8, height: 8, color: NAVY });
  page.drawText('Reported', { x: margin + 12, y: y + 1, size: 7.5, font: fonts.regular, color: INK });
  page.drawRectangle({ x: margin + 64, y: y, width: 8, height: 8, color: AMBER });
  page.drawText('Resolved', { x: margin + 76, y: y + 1, size: 7.5, font: fonts.regular, color: INK });
  y -= 24;

  sectionTitle('Open reports by barangay (top 8)');
  const brgy = stats.top_barangays.map((b) => [b.barangay, b.open]);
  if (brgy.length) barRows(brgy, Math.max(1, ...brgy.map(([, v]) => v)), MID_NAVY);
  else {
    page.drawText('No open reports.', { x: margin, y, size: 8.5, font: fonts.regular, color: MUTED });
    y -= 22;
  }

  if (y > 120) {
    sectionTitle('Maintenance teams');
    for (const team of stats.teams) {
      if (y < 60) break;
      page.drawText(fit(safe(team.name), fonts.regular, 8.5, 200), { x: margin, y, size: 8.5, font: fonts.regular, color: INK });
      page.drawText(`${team.active_tasks} active / ${team.completed} completed`, {
        x: margin + 210,
        y,
        size: 8.5,
        font: fonts.bold,
        color: INK,
      });
      y -= 15;
    }
    y -= 8;
  }
  if (y > 60) {
    const fb = stats.feedback;
    page.drawText(
      safe(
        `Reporter feedback: ${fb.count} response(s)${fb.average ? `, average rating ${fb.average}/5` : ''}.` +
          (stats.demo_reports ? ` Includes ${stats.demo_reports} demo record(s) created by the seed script.` : ''),
      ),
      { x: margin, y, size: 8, font: fonts.regular, color: MUTED },
    );
  }
  drawFooters(doc, fonts);
  return Buffer.from(await doc.save());
}

// ---------------------------------------------------------------------------
// Dashboard figures as CSV: one file with a section per table.
// ---------------------------------------------------------------------------
export function statsCsv(stats, { lguName }) {
  const rows = [];
  const add = (...cells) => rows.push(cells);
  const blank = () => rows.push([]);
  const t = stats.totals;
  add('Wayguard dashboard figures');
  add('LGU', lguName);
  add('Period', stats.range.from || stats.range.to ? `${stats.range.from || '...'} to ${stats.range.to || '...'}` : 'All time');
  add('Generated', fmtDateTime(stats.generated_at));
  blank();
  add('Measure', 'Value');
  [
    ['Total reports', t.total],
    ['Open now', t.open],
    ['To review', t.pending_review],
    ['To assign', t.awaiting_assignment],
    ['Being repaired', t.active_repairs],
    ['Crew says fixed, to check', t.awaiting_verification],
    ['Resolved', t.resolved],
    ['Rejected or duplicate', t.closed_invalid],
    ['Resolution rate (%)', t.resolution_rate],
    ['Median days to repair', t.median_resolution_days],
    ['Average days to repair', t.avg_resolution_days],
    ['Average hours to first response', t.avg_first_response_hours],
    ['Overdue repairs', t.overdue_tasks],
    ['New in last 7 days', t.new_7d],
    ['New in the 7 days before', t.new_prev_7d],
    ['Fixed in last 30 days', t.resolved_30d],
    ['High severity open over 7 days', t.high_open_over_7_days],
    ['Citizen rating (average of 5)', stats.feedback.average],
    ['Citizen ratings received', stats.feedback.count],
  ].forEach(([k, v]) => add(k, v ?? ''));
  blank();
  add('Month', 'Reported', 'Resolved');
  stats.monthly.forEach((m) => add(m.month, m.reported, m.resolved));
  blank();
  add('Status', 'Reports');
  Object.entries(stats.by_status).forEach(([k, v]) => add(STATUS_LABELS[k] || k, v));
  blank();
  add('Severity', 'Open', 'Total');
  ['high', 'medium', 'low'].forEach((k) => add(SEVERITY_LABEL[k], stats.by_severity[k]?.open ?? 0, stats.by_severity[k]?.total ?? 0));
  blank();
  add('Barangay', 'Open reports');
  stats.top_barangays.forEach((b) => add(b.barangay, b.open));
  blank();
  add('Road', 'Open', 'Open high severity', 'Total');
  (stats.top_roads || []).forEach((r) => add(r.road_name, r.open, r.open_high, r.total));
  blank();
  add('Road type', 'Open', 'Total');
  (stats.by_road_type || []).forEach((r) => add(r.road_type, r.open, r.total));
  blank();
  add('Hazard', 'Reports');
  (stats.hazards || []).forEach((h) => add(h.hazard, h.n));
  blank();
  add('Team', 'Active', 'Overdue', 'Completed', 'Average days per repair');
  stats.teams.forEach((tm) => add(tm.name, tm.active_tasks, tm.overdue ?? '', tm.completed, tm.avg_repair_days ?? ''));
  blank();
  add('Rating', 'Count');
  (stats.ratings || []).forEach((r) => add(`${r.rating} star`, r.n));
  if (stats.by_lgu?.length) {
    blank();
    add('LGU', 'Open', 'Resolved', 'Total');
    stats.by_lgu.forEach((l) => add(l.name, l.open, l.resolved, l.total));
  }
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // never let a spreadsheet run it as a formula
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Monthly accomplishment report for the mayor / council (A4 portrait).
// ---------------------------------------------------------------------------
export async function computeMonthly(month, lguIds) {
  const tz = config.timezone;
  const scope = lguIds == null ? sql`TRUE` : sql`r.lgu_id = ANY(${lguIds})`;
  const start = sql`(${month + '-01'}::date::timestamp AT TIME ZONE ${tz})`;
  const end = sql`((${month + '-01'}::date + interval '1 month')::timestamp AT TIME ZONE ${tz})`;
  const [s] = await sql`
    SELECT
      count(*) FILTER (WHERE r.created_at >= ${start} AND r.created_at < ${end})::int AS received,
      count(*) FILTER (WHERE r.verified_at >= ${start} AND r.verified_at < ${end})::int AS verified,
      count(*) FILTER (WHERE r.status = 'resolved' AND r.resolved_at >= ${start} AND r.resolved_at < ${end})::int AS resolved,
      count(*) FILTER (WHERE r.status IN ('rejected', 'duplicate') AND r.updated_at >= ${start} AND r.updated_at < ${end})::int AS closed_invalid,
      count(*) FILTER (WHERE r.created_at < ${end}
        AND NOT (r.status = 'resolved' AND r.resolved_at < ${end})
        AND NOT (r.status IN ('rejected', 'duplicate') AND r.updated_at < ${end}))::int AS open_at_end,
      round((avg(EXTRACT(EPOCH FROM (r.resolved_at - r.created_at)) / 86400)
        FILTER (WHERE r.status = 'resolved' AND r.resolved_at >= ${start} AND r.resolved_at < ${end}))::numeric, 1)::float AS avg_days,
      round((percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (r.resolved_at - r.created_at)) / 86400)
        FILTER (WHERE r.status = 'resolved' AND r.resolved_at >= ${start} AND r.resolved_at < ${end}))::numeric, 1)::float AS median_days
    FROM reports r WHERE ${scope}`;
  const resolvedList = await sql`
    SELECT r.code, r.road_name, r.barangay, r.severity, r.created_at, r.resolved_at,
      round((EXTRACT(EPOCH FROM (r.resolved_at - r.created_at)) / 86400)::numeric, 1)::float AS days,
      (SELECT t.name FROM assignments a JOIN maintenance_teams t ON t.id = a.team_id
        WHERE a.report_id = r.id ORDER BY a.assigned_at DESC LIMIT 1) AS team
    FROM reports r
    WHERE ${scope} AND r.status = 'resolved' AND r.resolved_at >= ${start} AND r.resolved_at < ${end}
    ORDER BY r.resolved_at`;
  const barangays = await sql`
    SELECT COALESCE(NULLIF(r.barangay, ''), 'Unspecified') AS barangay, count(*)::int AS received,
      count(*) FILTER (WHERE r.severity = 'high')::int AS high
    FROM reports r WHERE ${scope} AND r.created_at >= ${start} AND r.created_at < ${end}
    GROUP BY 1 ORDER BY received DESC, 1 LIMIT 12`;
  const teams = await sql`
    SELECT t.name,
      count(*) FILTER (WHERE a.end_reason = 'completed' AND a.ended_at >= ${start} AND a.ended_at < ${end})::int AS completed,
      count(*) FILTER (WHERE a.assigned_at >= ${start} AND a.assigned_at < ${end})::int AS assigned
    FROM assignments a JOIN maintenance_teams t ON t.id = a.team_id JOIN reports r ON r.id = a.report_id
    WHERE ${scope}
    GROUP BY t.name HAVING count(*) FILTER (WHERE (a.assigned_at >= ${start} AND a.assigned_at < ${end})
      OR (a.ended_at >= ${start} AND a.ended_at < ${end})) > 0
    ORDER BY completed DESC, t.name`;
  const [fb] = await sql`
    SELECT count(*)::int AS count, round(avg(f.rating)::numeric, 2)::float AS average
    FROM feedback f JOIN reports r ON r.id = f.report_id
    WHERE ${scope} AND f.created_at >= ${start} AND f.created_at < ${end}`;
  return { month, summary: s, resolved: resolvedList, barangays, teams, feedback: fb };
}

export async function monthlyPdf(data, { lguName }) {
  const ctx = await newDoc('Wayguard monthly accomplishment report');
  const { doc, fonts } = ctx;
  const safe = makeSafe(fonts.regular);
  const W = 595.28;
  const H = 841.89;
  const margin = 36;
  const [yy, mm] = data.month.split('-').map(Number);
  const monthName = new Date(yy, mm - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  let page = doc.addPage([W, H]);
  let y = drawHeader(page, ctx, { title: 'Monthly Accomplishment Report', subtitle: `${monthName} | generated ${fmtDateTime(new Date())}`, lguName });
  const need = (h) => {
    if (y - h < 60) {
      page = doc.addPage([W, H]);
      y = drawHeader(page, ctx, { title: 'Monthly Accomplishment Report', subtitle: `${monthName} (continued)`, lguName });
    }
  };
  const text = (s, x, size = 8.5, font = fonts.regular, color = INK) => page.drawText(safe(s), { x, y, size, font, color });
  const title = (s) => {
    need(40);
    y -= 6;
    text(s, margin, 11, fonts.bold, NAVY);
    y -= 16;
  };

  const s = data.summary;
  const tiles = [
    ['Reports received', s.received],
    ['Verified', s.verified],
    ['Potholes repaired', s.resolved],
    ['Not accepted', s.closed_invalid],
    ['Open at month end', s.open_at_end],
    ['Median days to repair', s.median_days ?? '-'],
  ];
  const tileW = (W - margin * 2 - 5 * 8) / 6;
  tiles.forEach(([label, value], i) => {
    const x = margin + i * (tileW + 8);
    page.drawRectangle({ x, y: y - 50, width: tileW, height: 54, color: CLOUD, borderColor: LINE, borderWidth: 0.5 });
    page.drawRectangle({ x, y: y + 2, width: tileW, height: 2, color: i === 2 ? AMBER : NAVY });
    page.drawText(String(value), { x: x + 8, y: y - 22, size: 18, font: fonts.bold, color: NAVY });
    page.drawText(fit(safe(label), fonts.regular, 7, tileW - 12), { x: x + 8, y: y - 40, size: 7, font: fonts.regular, color: MUTED });
  });
  y -= 76;

  const para = `In ${monthName}, the LGU received ${s.received} pothole report(s) through Wayguard, verified ${s.verified} and completed ${s.resolved} repair(s)` +
    (s.avg_days != null ? `, taking ${s.median_days} day(s) from report to verified repair at the median (average ${s.avg_days}).` : '.') +
    ` ${s.open_at_end} report(s) were still open at the end of the month.` +
    (data.feedback.count ? ` Residents rated ${data.feedback.count} repair(s), ${data.feedback.average} of 5 on average.` : '');
  const words = safe(para).split(' ');
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (fonts.regular.widthOfTextAtSize(next, 9.5) > W - margin * 2) {
      text(line, margin, 9.5);
      y -= 14;
      line = w;
    } else line = next;
  }
  if (line) {
    text(line, margin, 9.5);
    y -= 22;
  }

  const table = (cols, rows, empty) => {
    const rowH = 15;
    need(rowH * 2);
    let x = margin;
    page.drawRectangle({ x: margin, y: y - 4, width: W - margin * 2, height: rowH, color: NAVY });
    for (const c of cols) {
      page.drawText(safe(c.label), { x: x + 4, y: y, size: 7.5, font: fonts.bold, color: WHITE });
      x += c.w;
    }
    y -= rowH;
    if (!rows.length) {
      text(empty, margin + 4, 8.5, fonts.regular, MUTED);
      y -= rowH + 6;
      return;
    }
    rows.forEach((r, i) => {
      need(rowH);
      if (i % 2) page.drawRectangle({ x: margin, y: y - 4, width: W - margin * 2, height: rowH, color: CLOUD });
      let cx = margin;
      for (const c of cols) {
        page.drawText(fit(safe(r[c.key] ?? ''), fonts.regular, 8, c.w - 8), { x: cx + 4, y, size: 8, font: fonts.regular, color: INK });
        cx += c.w;
      }
      y -= rowH;
    });
    y -= 10;
  };

  title('Reports received by barangay');
  table(
    [{ key: 'barangay', label: 'Barangay', w: 300 }, { key: 'received', label: 'Received', w: 110 }, { key: 'high', label: 'High severity', w: 113 }],
    data.barangays.map((b) => ({ ...b, received: String(b.received), high: String(b.high) })),
    'No reports were received this month.',
  );
  title('Road crews');
  table(
    [{ key: 'name', label: 'Team', w: 300 }, { key: 'assigned', label: 'Repairs assigned', w: 110 }, { key: 'completed', label: 'Repairs completed', w: 113 }],
    data.teams.map((t) => ({ ...t, assigned: String(t.assigned), completed: String(t.completed) })),
    'No crew activity this month.',
  );
  title(`Potholes repaired (${data.resolved.length})`);
  table(
    [
      { key: 'code', label: 'Code', w: 82 },
      { key: 'road', label: 'Road / Barangay', w: 150 },
      { key: 'severity', label: 'Severity', w: 48 },
      { key: 'reported', label: 'Reported', w: 60 },
      { key: 'fixed', label: 'Verified', w: 60 },
      { key: 'days', label: 'Days', w: 32 },
      { key: 'team', label: 'Team', w: 91 },
    ],
    data.resolved.map((r) => ({
      code: r.code,
      road: [r.road_name, r.barangay].filter(Boolean).join(', '),
      severity: SEVERITY_LABEL[r.severity] || r.severity,
      reported: fmtDate(r.created_at),
      fixed: fmtDate(r.resolved_at),
      days: String(r.days),
      team: r.team || '',
    })),
    'No repairs were verified this month.',
  );

  need(90);
  y -= 20;
  const sig = (label, x) => {
    page.drawLine({ start: { x, y }, end: { x: x + 200, y }, thickness: 0.6, color: INK });
    page.drawText(label, { x, y: y - 12, size: 8, font: fonts.regular, color: MUTED });
  };
  sig('Prepared by (name, position, date)', margin);
  sig('Noted by (name, position, date)', W - margin - 200);
  drawFooters(doc, fonts);
  return Buffer.from(await doc.save());
}
