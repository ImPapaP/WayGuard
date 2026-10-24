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

export async function loadExportRows(query, limit) {
  const where = adminFilters(query);
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
