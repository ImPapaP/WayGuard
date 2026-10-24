// Server-side sessions. The browser holds a random token in an HttpOnly
// cookie; the database holds only its SHA-256 hash.
import { sql } from '../db/index.js';
import { config } from '../config.js';
import { randomToken, sha256 } from '../lib/security.js';
import { serializeCookie } from '../lib/http.js';

// The __Host- prefix makes browsers refuse the cookie unless it is Secure,
// host-only and scoped to "/" — only usable when cookies are secure.
export const SESSION_COOKIE = config.cookieSecure ? '__Host-wg_sid' : 'wg_sid';
const TTL_MS = config.sessionTtlDays * 24 * 60 * 60 * 1000;
const REFRESH_AFTER_MS = 10 * 60 * 1000;

function cookieFor(token, maxAgeSeconds) {
  return serializeCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'Lax',
    path: '/',
    maxAge: maxAgeSeconds,
  });
}

export async function createSession(ctx, userId, db = sql) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + TTL_MS);
  await db`
    INSERT INTO sessions (id, user_id, expires_at, ip, user_agent)
    VALUES (${sha256(token)}, ${userId}, ${expiresAt}, ${ctx.ip || null},
            ${String(ctx.req.headers['user-agent'] || '').slice(0, 300) || null})`;
  ctx.appendCookie(cookieFor(token, TTL_MS / 1000));
  return token;
}

export async function destroySession(ctx) {
  const token = ctx.cookies[SESSION_COOKIE];
  if (token) await sql`DELETE FROM sessions WHERE id = ${sha256(token)}`;
  ctx.appendCookie(cookieFor('', 0));
}

export async function destroyUserSessions(userId, exceptSessionId = null, db = sql) {
  if (exceptSessionId) {
    await db`DELETE FROM sessions WHERE user_id = ${userId} AND id <> ${exceptSessionId}`;
  } else {
    await db`DELETE FROM sessions WHERE user_id = ${userId}`;
  }
}

// Column list shared by every query that loads a user (alias u = users,
// t = maintenance_teams). Returned as a fresh fragment for each query.
export const userColumns = () => sql`
  u.id, u.email, u.full_name, u.phone, u.role, u.team_id, u.is_active,
  u.email_notifications, u.must_change_password, u.last_login_at, u.created_at,
  t.name AS team_name`;

// Middleware: attaches ctx.user / ctx.session when a valid cookie is present.
export function loadSession() {
  return async function sessionMiddleware(ctx, next) {
    const token = ctx.cookies[SESSION_COOKIE];
    if (token && token.length <= 128) {
      const id = sha256(token);
      const rows = await sql`
        SELECT s.id AS session_id, s.last_seen_at, ${userColumns()}
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        LEFT JOIN maintenance_teams t ON t.id = u.team_id
        WHERE s.id = ${id} AND s.expires_at > now() AND u.is_active`;
      if (rows.length) {
        const { session_id, last_seen_at, ...user } = rows[0];
        ctx.user = user;
        ctx.session = { id: session_id };
        // Sliding expiry, written at most every 10 minutes.
        if (Date.now() - new Date(last_seen_at).getTime() > REFRESH_AFTER_MS) {
          const expiresAt = new Date(Date.now() + TTL_MS);
          await sql`UPDATE sessions SET last_seen_at = now(), expires_at = ${expiresAt} WHERE id = ${id}`;
          ctx.appendCookie(cookieFor(token, TTL_MS / 1000));
        }
      } else {
        // Stale cookie: clear it.
        ctx.appendCookie(cookieFor('', 0));
      }
    }
    await next();
  };
}

export async function purgeExpiredSessions() {
  await sql`DELETE FROM sessions WHERE expires_at < now()`;
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    phone: user.phone,
    role: user.role,
    team_id: user.team_id,
    team_name: user.team_name || null,
    email_notifications: user.email_notifications,
    must_change_password: user.must_change_password,
    created_at: user.created_at,
  };
}
