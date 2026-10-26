// Password reset by e-mail: a random one-time link valid for one hour.
// Only the SHA-256 hash of the token is stored.
import { sql } from '../db/index.js';
import { config } from '../config.js';
import { randomToken, sha256, hashPassword } from '../lib/security.js';
import { sendMail } from './smtp.js';
import { destroyUserSessions } from './sessions.js';

export const RESET_TTL_MINUTES = 60;

export function resetEmailAvailable() {
  return Boolean(config.smtp.host);
}

// Creates a reset token for an active user and returns the raw token.
export async function createPasswordReset(userId, ip = null) {
  const token = randomToken(32);
  await sql.begin(async (tx) => {
    // A new link replaces any earlier unused one.
    await tx`DELETE FROM password_reset_tokens WHERE user_id = ${userId} AND used_at IS NULL`;
    await tx`
      INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, requested_ip)
      VALUES (${sha256(token)}, ${userId}, now() + make_interval(mins => ${RESET_TTL_MINUTES}), ${ip})`;
  });
  return token;
}

export function resetLink(token) {
  return `${config.publicBaseUrl}/reset-password?token=${encodeURIComponent(token)}`;
}

// Looks up the user for a token that is unused and not expired.
export async function findValidReset(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 128) return null;
  const [row] = await sql`
    SELECT t.token_hash, t.user_id, u.full_name, u.email
    FROM password_reset_tokens t JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ${sha256(token)} AND t.used_at IS NULL AND t.expires_at > now() AND u.is_active`;
  return row || null;
}

export async function sendResetEmail(user, token, send = sendMail) {
  const link = resetLink(token);
  if (!resetEmailAvailable()) {
    // Local development only: show the link in the server console so the flow
    // can be tried without an e-mail account. Never in production.
    if (!config.isProduction && !config.isTest) console.log(`[password reset] ${user.email}: ${link}`);
    return false;
  }
  await send({
    ...config.smtp,
    to: `${user.full_name} <${user.email}>`,
    subject: '[Wayguard] Reset your password',
    text:
      `Hello ${user.full_name},\n\n` +
      `Someone asked to reset the password of your Wayguard account. To choose a new password, open this link within ${RESET_TTL_MINUTES} minutes:\n\n${link}\n\n` +
      'If you did not ask for this, you can ignore this e-mail; your password stays the same.\n\n— Wayguard',
  });
  return true;
}

// Sets the new password, uses up the token and signs out every device.
export async function completePasswordReset(token, newPassword) {
  const reset = await findValidReset(token);
  if (!reset) return null;
  const hash = await hashPassword(newPassword);
  const used = await sql.begin(async (tx) => {
    const [claimed] = await tx`
      UPDATE password_reset_tokens SET used_at = now()
      WHERE token_hash = ${reset.token_hash} AND used_at IS NULL AND expires_at > now()
      RETURNING user_id`;
    if (!claimed) return null;
    await tx`UPDATE users SET password_hash = ${hash}, must_change_password = FALSE, updated_at = now() WHERE id = ${claimed.user_id}`;
    await tx`DELETE FROM password_reset_tokens WHERE user_id = ${claimed.user_id} AND used_at IS NULL`;
    return claimed.user_id;
  });
  if (used) await destroyUserSessions(used);
  return used;
}
