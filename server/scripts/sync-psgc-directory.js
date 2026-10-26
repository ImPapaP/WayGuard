// Sync the bundled PSGC reference directory into Wayguard's jurisdiction tree.
// The data is committed for deterministic deployments and does not require an
// external API token at runtime.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSql, closeSql } from '../src/db/index.js';

const DATA_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/psgc-jurisdictions-2026-09-30.json');

function normalize(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function aliases(name) {
  const value = normalize(name);
  const candidates = new Set([value]);
  candidates.add(value.replace(/^(city|municipality|municipal town|town) of /, ''));
  candidates.add(value.replace(/ city$/, ''));
  candidates.add(value.replace(/ municipality$/, ''));
  candidates.add(value.replace(/ town$/, ''));
  return candidates;
}

function matchesLocation(row, node) {
  if (!['city', 'independent_city', 'municipality'].includes(node.level)) return false;
  const names = aliases(node.name);
  if (normalize(row.city) && names.has(normalize(row.city))) {
    if (node.province) return normalize(row.province) === normalize(node.province);
    return !row.province;
  }
  return false;
}

function buildAssignments(nodes, existingRows) {
  const byCode = new Map(existingRows.filter((row) => row.psgc_code).map((row) => [row.psgc_code, row]));
  const used = new Set();
  const nodeIds = new Map();
  const rowsByName = new Map();
  for (const row of existingRows) {
    const key = normalize(row.name);
    if (!rowsByName.has(key)) rowsByName.set(key, []);
    rowsByName.get(key).push(row);
  }
  for (const node of nodes) {
    const coded = byCode.get(node.code);
    if (coded && !used.has(coded.id)) {
      nodeIds.set(node.code, coded.id);
      used.add(coded.id);
      continue;
    }
    const parentId = node.parent_code ? nodeIds.get(node.parent_code) : null;
    let candidate = existingRows.find((row) => !used.has(row.id) && !row.psgc_code && matchesLocation(row, node));
    if (!candidate) {
      const sameName = rowsByName.get(normalize(node.name)) || [];
      candidate = sameName.find((row) => !used.has(row.id) && !row.psgc_code &&
        (parentId == null || row.parent_lgu_id === parentId));
    }
    if (!candidate) {
      const sameName = (rowsByName.get(normalize(node.name)) || []).filter((row) => !used.has(row.id) && !row.psgc_code);
      const duplicatesInSource = nodes.filter((other) => normalize(other.name) === normalize(node.name)).length > 1;
      if (!duplicatesInSource) candidate = sameName[0];
    }
    if (candidate) {
      nodeIds.set(node.code, candidate.id);
      used.add(candidate.id);
    }
  }
  return nodeIds;
}

export async function syncPsgcDirectory({ db = getSql(), log = console.log } = {}) {
  const file = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
  const nodes = file.nodes || [];
  const release = file.metadata?.sourceSnapshot || 'unknown';
  if (!nodes.length) throw new Error('The PSGC directory contains no geographic records.');
  if (nodes.length !== new Set(nodes.map((node) => node.code)).size) throw new Error('The PSGC directory contains duplicate geographic codes.');
  const knownCodes = new Set(nodes.map((node) => node.code));
  const missingParent = nodes.find((node) => node.parent_code && !knownCodes.has(node.parent_code));
  if (missingParent) throw new Error('Missing PSGC parent record for ' + missingParent.name + '.');

  return db.begin(async (tx) => {
    const existingRows = await tx.unsafe(
      'SELECT id, name, slug, city, province, psgc_code, jurisdiction_level, parent_lgu_id FROM lgus FOR UPDATE'
    );
    const assignments = buildAssignments(nodes, existingRows);
    const records = nodes.map((node) => ({
      ...node,
      id: assignments.get(node.code) ?? null,
      staged_name: assignments.has(node.code) ? node.name : node.name + ' [PSGC ' + node.code + ']',
    }));
    const matched = records.filter((node) => node.id !== null);
    const missing = records.filter((node) => node.id === null);

    if (matched.length) {
      await tx.unsafe([
        'UPDATE lgus AS l SET',
        '  psgc_code = d.code,',
        '  psgc_release = $2,',
        '  is_directory_node = TRUE,',
        '  jurisdiction_level = d.level,',
        '  city = d.city,',
        '  province = d.province,',
        '  parent_lgu_id = NULL,',
        '  updated_at = now()',
        'FROM jsonb_to_recordset($1::jsonb) AS d(id integer, code text, level text, city text, province text)',
        'WHERE l.id = d.id AND (l.psgc_code IS NULL OR l.psgc_code = d.code)'
      ].join('\n'), [JSON.stringify(matched), release]);
    }

    if (missing.length) {
      await tx.unsafe([
        'INSERT INTO lgus (name, slug, city, province, is_active, jurisdiction_level, parent_lgu_id, psgc_code, psgc_release, is_directory_node)',
        'SELECT d.staged_name, d.slug, d.city, d.province, TRUE, d.level, NULL, d.code, $2, TRUE',
        'FROM jsonb_to_recordset($1::jsonb) AS d(code text, name text, staged_name text, slug text, city text, province text, level text)',
        'ON CONFLICT (psgc_code) WHERE psgc_code IS NOT NULL DO NOTHING'
      ].join('\n'), [JSON.stringify(missing), release]);
    }

    const parentRows = nodes.filter((node) => node.parent_code);
    if (parentRows.length) {
      await tx.unsafe([
        'UPDATE lgus AS child SET parent_lgu_id = parent.id, updated_at = now()',
        'FROM jsonb_to_recordset($1::jsonb) AS d(code text, parent_code text)',
        'JOIN lgus AS parent ON parent.psgc_code = d.parent_code',
        'WHERE child.psgc_code = d.code AND child.parent_lgu_id IS DISTINCT FROM parent.id'
      ].join('\n'), [JSON.stringify(parentRows)]);
    }
    const rootCodes = nodes.filter((node) => !node.parent_code).map((node) => node.code);
    if (rootCodes.length) {
      await tx.unsafe(
        'UPDATE lgus SET parent_lgu_id = NULL WHERE psgc_code = ANY($1::text[]) AND parent_lgu_id IS NOT NULL',
        [rootCodes]
      );
    }

    await tx.unsafe([
      'UPDATE lgus AS l SET',
      '  name = d.name,',
      '  city = d.city,',
      '  province = d.province,',
      '  jurisdiction_level = d.level,',
      '  psgc_release = $2,',
      '  is_directory_node = TRUE,',
      '  updated_at = now()',
      'FROM jsonb_to_recordset($1::jsonb) AS d(code text, name text, city text, province text, level text)',
      'WHERE l.psgc_code = d.code AND (',
      '  l.name IS DISTINCT FROM d.name OR l.city IS DISTINCT FROM d.city OR',
      '  l.province IS DISTINCT FROM d.province OR l.jurisdiction_level IS DISTINCT FROM d.level OR',
      '  l.is_directory_node IS DISTINCT FROM TRUE',
      ')'
    ].join('\n'), [JSON.stringify(nodes), release]);

    await tx.unsafe([
      "INSERT INTO settings (lgu_id, key, value)",
      "SELECT l.id, 'lgu_name', to_jsonb(l.name)",
      'FROM lgus l WHERE l.psgc_code = ANY($1::text[])',
      'ON CONFLICT (lgu_id, key) DO NOTHING'
    ].join('\n'), [nodes.map((node) => node.code)]);

    const countResult = await tx.unsafe([
      'SELECT count(*)::int AS total,',
      "count(*) FILTER (WHERE jurisdiction_level = 'island_group')::int AS island_groups,",
      "count(*) FILTER (WHERE jurisdiction_level = 'region')::int AS regions,",
      "count(*) FILTER (WHERE jurisdiction_level = 'province')::int AS provinces,",
      "count(*) FILTER (WHERE jurisdiction_level = 'independent_city')::int AS independent_cities,",
      "count(*) FILTER (WHERE jurisdiction_level = 'city')::int AS component_cities,",
      "count(*) FILTER (WHERE jurisdiction_level = 'municipality')::int AS municipalities",
      'FROM lgus WHERE is_directory_node'
    ].join('\n'));
    const counts = countResult[0];
    const result = { ...counts, matched: matched.length, inserted: missing.length, source: file.metadata };
    log('PSGC directory ready: ' + result.total + ' nodes (' + result.inserted + ' added, ' + result.matched + ' existing tenants matched).');
    return result;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  syncPsgcDirectory()
    .then(() => closeSql())
    .catch(async (err) => {
      console.error('PSGC directory sync failed:', err.message);
      await closeSql();
      process.exit(1);
    });
}
