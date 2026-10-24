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

let cache = null;
let cacheAt = 0;

export async function getSettings(db = sql) {
  if (cache && Date.now() - cacheAt < 5000 && db === sql) return cache;
  const rows = await db`SELECT key, value FROM settings`;
  const out = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (row.key in DEFAULT_SETTINGS) out[row.key] = row.value;
  }
  if (db === sql) {
    cache = out;
    cacheAt = Date.now();
  }
  return out;
}

export function invalidateSettingsCache() {
  cache = null;
}

export async function updateSettings(changes, actorId, db = sql) {
  for (const [key, value] of Object.entries(changes)) {
    await db`
      INSERT INTO settings (key, value, updated_at, updated_by)
      VALUES (${key}, ${db.json(value)}, now(), ${actorId})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`;
  }
  invalidateSettingsCache();
  return getSettings(db);
}
