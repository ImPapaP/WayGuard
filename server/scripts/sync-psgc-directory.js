// Sync the bundled PSGC reference directory into Wayguard's jurisdiction tree.
// The checked-in data makes deployments deterministic without a runtime API dependency.
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
  return new Set([
    value,
    value.replace(/^(city|municipality|municipal town|town) of /, ''),
    value.replace(/ city$/, ''),
    value.replace(/ municipality$/, ''),
    value.replace(/ town$/, ''),
  ]);
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
      const duplicateName = nodes.some((other) => other.code !== node.code && normalize(other.name) === normalize(node.name));
      if (!duplicateName) candidate = sameName[0];
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
      'SELECT id, name, slug, city, province, psgc_code, jurisdiction_level, parent_lgu_id FROM lgus FOR UPDATE',
      []
    );
    const assignments = buildAssignments(nodes, existingRows);
    const codeToId = new Map();
    const usedIds = new Set();

    // Nodes in the bundled file are ordered parent-first.
    // Existing records are matched and reused to preserve account/report foreign keys.
    for (const node of nodes) {
      const parentId = node.parent_code ? codeToId.get(node.parent_code) : null;
      let recordId = assignments.get(node.code);
      if (recordId !== undefined && usedIds.has(recordId)) recordId = undefined;

      if (recordId !== undefined) {
        const updated = await tx.unsafe(
          'UPDATE lgus SET name=$1, city=$2, province=$3, jurisdiction_level=$4, parent_lgu_id=$5, psgc_code=$6, psgc_release=$7, is_directory_node=TRUE, updated_at=now() WHERE id=$8 AND (psgc_code IS NULL OR psgc_code=$6) RETURNING id',
          [node.name, node.city, node.province, node.level, parentId ?? null, node.code, release, recordId]
        );
        if (updated.length) {
          codeToId.set(node.code, updated[0].id);
          usedIds.add(updated[0].id);
          continue;
        }
      }

      const sameName = await tx.unsafe(
        'SELECT id FROM lgus WHERE lower(name)=lower($1) AND parent_lgu_id IS NOT DISTINCT FROM $2::int AND psgc_code IS NULL ORDER BY id LIMIT 1',
        [node.name, parentId ?? null]
      );
      if (sameName.length && !usedIds.has(sameName[0].id)) {
        const updated = await tx.unsafe(
          'UPDATE lgus SET city=$1, province=$2, jurisdiction_level=$3, psgc_code=$4, psgc_release=$5, is_directory_node=TRUE, updated_at=now() WHERE id=$6 RETURNING id',
          [node.city, node.province, node.level, node.code, release, sameName[0].id]
        );
        codeToId.set(node.code, updated[0].id);
        usedIds.add(updated[0].id);
        continue;
      }

      const inserted = await tx.unsafe(
        'INSERT INTO lgus (name, slug, city, province, is_active, jurisdiction_level, parent_lgu_id, psgc_code, psgc_release, is_directory_node) VALUES ($1,$2,$3,$4,TRUE,$5,$6,$7,$8,TRUE) ON CONFLICT (psgc_code) WHERE psgc_code IS NOT NULL DO UPDATE SET name=EXCLUDED.name, city=EXCLUDED.city, province=EXCLUDED.province, jurisdiction_level=EXCLUDED.jurisdiction_level, parent_lgu_id=EXCLUDED.parent_lgu_id, psgc_release=EXCLUDED.psgc_release, is_directory_node=TRUE, updated_at=now() RETURNING id',
        [node.name, node.slug, node.city, node.province, node.level, parentId ?? null, node.code, release]
      );
      codeToId.set(node.code, inserted[0].id);
      usedIds.add(inserted[0].id);
    }

    await tx.unsafe(
      "INSERT INTO settings (lgu_id, key, value) SELECT l.id, 'lgu_name', to_jsonb(l.name) FROM lgus l WHERE l.psgc_code = ANY($1::text[]) ON CONFLICT (lgu_id, key) DO NOTHING",
      [nodes.map((node) => node.code)]
    );

    const countsResult = await tx.unsafe(
      "SELECT count(*)::int AS total, count(*) FILTER (WHERE jurisdiction_level='island_group')::int AS island_groups, count(*) FILTER (WHERE jurisdiction_level='region')::int AS regions, count(*) FILTER (WHERE jurisdiction_level='province')::int AS provinces, count(*) FILTER (WHERE jurisdiction_level='independent_city')::int AS independent_cities, count(*) FILTER (WHERE jurisdiction_level='city')::int AS component_cities, count(*) FILTER (WHERE jurisdiction_level='municipality')::int AS municipalities, count(*) FILTER (WHERE jurisdiction_level='special_area')::int AS special_areas FROM lgus WHERE is_directory_node",
      []
    );
    const counts = countsResult[0];
    const matched = [...assignments.keys()].length;
    const inserted = nodes.length - matched;
    const result = { ...counts, matched, inserted, source: file.metadata };
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
