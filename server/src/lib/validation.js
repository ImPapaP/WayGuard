// Shared validation rules (zod). All request input is validated at the API
// boundary before it reaches the database.
import { z } from 'zod';
import { badRequest } from './http.js';

// Strip ASCII control characters (except tab/newline) from free text.
const clean = (s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();

export const text = (min, max, label = 'This field') =>
  z
    .string({ required_error: `${label} is required.`, invalid_type_error: `${label} must be text.` })
    .transform(clean)
    .pipe(
      z
        .string()
        .min(min, min <= 1 ? `${label} is required.` : `${label} must be at least ${min} characters.`)
        .max(max, `${label} must be at most ${max} characters.`),
    );

export const optionalText = (max, label = 'This field') =>
  z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => (typeof v === 'string' ? clean(v) : ''))
    .pipe(z.string().max(max, `${label} must be at most ${max} characters.`))
    .transform((v) => (v === '' ? null : v));

export const email = z
  .string({ required_error: 'E-mail is required.' })
  .trim()
  .toLowerCase()
  .max(254, 'E-mail is too long.')
  .email('Enter a valid e-mail address.');

export const password = z
  .string({ required_error: 'Password is required.' })
  .min(8, 'Password must be at least 8 characters.')
  .max(128, 'Password must be at most 128 characters.')
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain at least one letter and one number.');

export const phone = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (typeof v === 'string' ? v.trim() : ''))
  .refine((v) => v === '' || /^\+?[0-9 ()-]{7,20}$/.test(v), 'Enter a valid phone number.')
  .transform((v) => (v === '' ? null : v));

export const severity = z.enum(['low', 'medium', 'high'], {
  errorMap: () => ({ message: 'Choose a severity: low, medium or high.' }),
});

export const roadType = z.enum(['national', 'provincial', 'city_municipal', 'barangay', 'private', 'unknown']);

export const STATUSES = [
  'submitted',
  'under_review',
  'verified',
  'assigned',
  'in_progress',
  'resolved',
  'rejected',
  'duplicate',
];
export const status = z.enum(STATUSES);

export const HAZARDS = [
  'deep',
  'wide',
  'water_filled',
  'causes_swerving',
  'near_school_or_crossing',
  'poor_lighting',
  'motorcycle_risk',
  'damaged_vehicles',
];

export const latitude = z.coerce
  .number({ invalid_type_error: 'Latitude must be a number.' })
  .min(-90, 'Latitude is out of range.')
  .max(90, 'Latitude is out of range.');
export const longitude = z.coerce
  .number({ invalid_type_error: 'Longitude must be a number.' })
  .min(-180, 'Longitude is out of range.')
  .max(180, 'Longitude is out of range.');

export function parseId(value, label = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 2147483647) throw badRequest(`Invalid ${label}.`);
  return n;
}

export function pagination(query, { defaultSize = 20, maxSize = 100 } = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, Number.parseInt(query.pageSize, 10) || defaultSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD.')
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Enter a valid date.');
