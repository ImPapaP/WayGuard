// System settings stored in the `settings` table (key -> JSON value).
import { z } from 'zod';
import { sql } from '../db/index.js';

export const DEFAULT_SETTINGS = {
  lgu_name: 'Local Government Unit',
  duplicate_radius_m: 30,
  duplicate_window_days: 90,
  max_photos_per_report: 5,
  map_center: { lat: 14.8433, lng: 120.8114, zoom: 14 },
  road_type_agency: {},
  public_resolved_days: 90,
};

export const settingsSchema = z
  .object({
    lgu_name: z.string().trim().min(2).max(120),
    duplicate_radius_m: z.number().int().min(5).max(500),
    duplicate_window_days: z.number().int().min(1).max(730),
    max_photos_per_report: z.number().int().min(1).max(10),
    map_center: z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      zoom: z.number().int().min(3).max(19),
    }),
    road_type_agency: z.record(
      z.enum(['national', 'provincial', 'city_municipal', 'barangay', 'private', 'unknown']),
      z.number().int().positive().nullable(),
    ),
    public_resolved_days: z.number().int().min(0).max(3650),
  })
  .partial();

const cache = new Map();
const CACHE_MS = 5000;

export async function getSettings(db = sql, lguId = 1) {
  const cacheKey = String(lguId);
  if (cache.has(cacheKey) && Date.now() - cache.get(cacheKey).at < CACHE_MS && db === sql) {
    return cache.get(cacheKey).value;
  }
  const rows = await db`SELECT key, value FROM settings WHERE lgu_id = ${lguId}`;
  const out = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (row.key in DEFAULT_SETTINGS) out[row.key] = row.value;
  }
  if (db === sql) cache.set(cacheKey, { value: out, at: Date.now() });
  return out;
}

export function invalidateSettingsCache(lguId = null) {
  if (lguId === null || lguId === undefined) cache.clear();
  else cache.delete(String(lguId));
}

export async function updateSettings(changes, actorId, db = sql, lguId = 1) {
  for (const [key, value] of Object.entries(changes)) {
    await db`
      INSERT INTO settings (lgu_id, key, value, updated_at, updated_by)
      VALUES (${lguId}, ${key}, ${db.json(value)}, now(), ${actorId})
      ON CONFLICT (lgu_id, key) DO UPDATE
      SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`;
  }
  invalidateSettingsCache(lguId);
  return getSettings(db, lguId);
}
