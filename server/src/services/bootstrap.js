// One-time creation of the first LGU administrator from environment
// variables (INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_PASSWORD, INITIAL_ADMIN_NAME),
// for hosting where no command line is available (e.g. Render's free plan).
// Nothing is hard-coded: the password is chosen by whoever deploys, must meet
// the password rules, and must be changed at first sign-in. Once any active
// administrator exists, these variables are ignored.
import { sql } from '../db/index.js';
import { config } from '../config.js';
import { hashPassword } from '../lib/security.js';
import { email as emailSchema, password as passwordSchema, text } from '../lib/validation.js';

export async function ensureInitialAdmin({ log = console } = {}) {
  const { email, password, name } = config.initialAdmin;
  if (!email && !password) return { created: false, reason: 'not configured' };
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND is_active`;
  if (n > 0) {
    log.log('Note: an administrator already exists, so INITIAL_ADMIN_* settings are ignored. You can remove them.');
    return { created: false, reason: 'admin exists' };
  }
  const issues = [];
  const e = emailSchema.safeParse(email);
  const p = passwordSchema.safeParse(password);
  const nm = text(2, 100, 'Full name').safeParse(name);
  if (!e.success) issues.push('INITIAL_ADMIN_EMAIL is not a valid e-mail address');
  if (!p.success) issues.push(`INITIAL_ADMIN_PASSWORD: ${p.error.issues.map((i) => i.message).join(' ')}`);
  if (!nm.success) issues.push('INITIAL_ADMIN_NAME must be 2-100 characters');
  if (issues.length) {
    log.error(`Could not create the first administrator: ${issues.join('; ')}.`);
    return { created: false, reason: 'invalid' };
  }
  const [taken] = await sql`SELECT role FROM users WHERE lower(email) = ${e.data}`;
  if (taken) {
    log.error(`Could not create the first administrator: ${e.data} is already used by a ${taken.role} account.`);
    return { created: false, reason: 'email taken' };
  }
  const hash = await hashPassword(p.data);
  await sql`
    INSERT INTO users (email, password_hash, full_name, role, must_change_password)
    VALUES (${e.data}, ${hash}, ${nm.data}, 'admin', true)`;
  await sql`INSERT INTO audit_logs (action, target_type, details) VALUES ('user.create_admin_env', 'user', ${sql.json({ email: e.data })})`;
  log.log(`First administrator ${e.data} created. Sign in and choose a new password; then remove INITIAL_ADMIN_PASSWORD from the settings.`);
  return { created: true };
}
