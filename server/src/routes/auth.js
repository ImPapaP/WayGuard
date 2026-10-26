// Registration, sign-in/out and the signed-in user's own account.
import { z } from 'zod';
import { Router, readJson, HttpError, conflict } from '../lib/http.js';
import { sql } from '../db/index.js';
import { email, password, phone, text } from '../lib/validation.js';
import { hashPassword, verifyPassword, dummyHash, RateLimiter } from '../lib/security.js';
import {
  createSession,
  destroySession,
  destroyUserSessions,
  publicUser,
  userColumns,
} from '../services/sessions.js';
import { requireAuth } from '../middleware/auth.js';

const loginLimiterIp = new RateLimiter({ windowMs: 15 * 60 * 1000, max: 30, name: 'sign-in attempts' });
const loginLimiterAccount = new RateLimiter({ windowMs: 15 * 60 * 1000, max: 8, name: 'sign-in attempts' });
const registerLimiter = new RateLimiter({ windowMs: 60 * 60 * 1000, max: 10, name: 'registrations' });
const passwordLimiter = new RateLimiter({ windowMs: 15 * 60 * 1000, max: 10, name: 'password attempts' });

const registerSchema = z.object({
  full_name: text(2, 100, 'Full name'),
  email,
  phone,
  password,
  // The public registration screen selects an active LGU. Optional here for
  // backward compatibility with older clients; absent values use LGU 1.
  lgu_id: z.coerce.number().int().positive().optional(),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254),
  password: z.string().max(128),
});

const profileSchema = z
  .object({
    full_name: text(2, 100, 'Full name'),
    phone,
    email_notifications: z.boolean(),
  })
  .partial();

const changePasswordSchema = z.object({
  current_password: z.string().max(128),
  new_password: password,
});

async function loadUser(id) {
  const rows = await sql`
    SELECT ${userColumns()} FROM users u
    LEFT JOIN maintenance_teams t ON t.id = u.team_id AND t.lgu_id = u.lgu_id
    LEFT JOIN lgus l ON l.id = u.lgu_id
    WHERE u.id = ${id}`;
  return rows[0] || null;
}

export const authRoutes = new Router('/api/auth');

authRoutes.post('/register', async (ctx) => {
  registerLimiter.consume(`ip:${ctx.ip}`, ctx);
  const body = await readJson(ctx, registerSchema);
  const existing = await sql`SELECT 1 FROM users WHERE lower(email) = ${body.email}`;
  if (existing.length) throw conflict('An account with this e-mail already exists. Try signing in.');
  const [tenant] = body.lgu_id
    ? await sql`SELECT id FROM lgus WHERE id = ${body.lgu_id} AND is_active
      AND ((is_directory_node AND jurisdiction_level IN ('independent_city', 'city', 'municipality'))
        OR (NOT is_directory_node AND city IS NOT NULL))`
    : await sql`SELECT id FROM lgus WHERE is_active
      AND ((is_directory_node AND jurisdiction_level IN ('independent_city', 'city', 'municipality'))
        OR (NOT is_directory_node AND city IS NOT NULL))
      ORDER BY name LIMIT 1`;
  if (!tenant) throw new HttpError(400, 'Choose an active LGU to create your account.', undefined, 'invalid_lgu');
  const passwordHash = await hashPassword(body.password);
  // Public registration always creates a citizen account. Staff accounts are
  // created by an administrator.
  const [user] = await sql`
    INSERT INTO users (email, password_hash, full_name, phone, role, lgu_id)
    VALUES (${body.email}, ${passwordHash}, ${body.full_name}, ${body.phone}, 'citizen', ${tenant.id})
    RETURNING id`;
  await createSession(ctx, user.id);
  await sql`UPDATE users SET last_login_at = now() WHERE id = ${user.id}`;
  ctx.json(201, { user: publicUser(await loadUser(user.id)) });
});

authRoutes.post('/login', async (ctx) => {
  loginLimiterIp.consume(`ip:${ctx.ip}`, ctx);
  const body = await readJson(ctx, loginSchema);
  loginLimiterAccount.consume(`acct:${body.email}`, ctx);
  const rows = await sql`
    SELECT u.id, u.password_hash, u.is_active, u.role,
           (u.role = 'platform_admin' OR l.is_active) AS tenant_active
    FROM users u LEFT JOIN lgus l ON l.id = u.lgu_id
    WHERE lower(u.email) = ${body.email}`;
  const row = rows[0];
  const ok = await verifyPassword(body.password, row ? row.password_hash : await dummyHash());
  if (!row || !ok) {
    throw new HttpError(401, 'Incorrect e-mail or password.', undefined, 'invalid_credentials');
  }
  if (!row.is_active || !row.tenant_active) {
    throw new HttpError(403, 'This account or its LGU has been deactivated. Contact your platform administrator.', undefined, 'inactive');
  }
  loginLimiterAccount.reset(`acct:${body.email}`);
  await createSession(ctx, row.id);
  await sql`UPDATE users SET last_login_at = now() WHERE id = ${row.id}`;
  ctx.json(200, { user: publicUser(await loadUser(row.id)) });
});

authRoutes.post('/logout', async (ctx) => {
  await destroySession(ctx);
  ctx.json(200, { ok: true });
});

authRoutes.get('/me', async (ctx) => {
  ctx.json(200, { user: publicUser(ctx.user) });
});

authRoutes.patch('/profile', requireAuth(), async (ctx) => {
  const body = await readJson(ctx, profileSchema);
  await sql`
    UPDATE users SET
      full_name = COALESCE(${body.full_name ?? null}, full_name),
      phone = ${body.phone === undefined ? sql`phone` : body.phone},
      email_notifications = COALESCE(${body.email_notifications ?? null}, email_notifications),
      updated_at = now()
    WHERE id = ${ctx.user.id}`;
  ctx.json(200, { user: publicUser(await loadUser(ctx.user.id)) });
});

authRoutes.post('/change-password', requireAuth(), async (ctx) => {
  passwordLimiter.consume(`user:${ctx.user.id}`, ctx);
  const body = await readJson(ctx, changePasswordSchema);
  const [row] = await sql`SELECT password_hash FROM users WHERE id = ${ctx.user.id}`;
  if (!(await verifyPassword(body.current_password, row.password_hash))) {
    throw new HttpError(400, 'Your current password is incorrect.', undefined, 'invalid_password');
  }
  if (body.current_password === body.new_password) {
    throw new HttpError(400, 'Choose a new password that is different from the current one.');
  }
  const hash = await hashPassword(body.new_password);
  await sql`
    UPDATE users SET password_hash = ${hash}, must_change_password = FALSE, updated_at = now()
    WHERE id = ${ctx.user.id}`;
  // Sign out every other device that used the old password.
  await destroyUserSessions(ctx.user.id, ctx.session.id);
  ctx.json(200, { user: publicUser(await loadUser(ctx.user.id)) });
});
