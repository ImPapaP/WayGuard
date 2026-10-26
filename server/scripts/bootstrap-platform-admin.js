// One-time production bootstrap for the platform administrator.
// Configure PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_NAME and PLATFORM_ADMIN_PASSWORD
// in the hosting environment. If all are absent this script safely does nothing.
// Existing platform-admin accounts are left untouched; passwords are never logged.
import { getSql, closeSql } from '../src/db/index.js';
import { hashPassword } from '../src/lib/security.js';
import { email as emailSchema, password as passwordSchema, text } from '../src/lib/validation.js';

const configured = (value) => typeof value === 'string' && value.length > 0;

async function main() {
  const rawEmail = process.env.PLATFORM_ADMIN_EMAIL;
  const rawName = process.env.PLATFORM_ADMIN_NAME;
  const rawPassword = process.env.PLATFORM_ADMIN_PASSWORD;
  const anyConfigured = [rawEmail, rawName, rawPassword].some(configured);

  if (!anyConfigured) {
    console.log('Platform-admin bootstrap skipped; no platform-admin environment values are configured.');
    return;
  }
  if (![rawEmail, rawName, rawPassword].every(configured)) {
    throw new Error('Set PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_NAME and PLATFORM_ADMIN_PASSWORD together.');
  }

  const email = emailSchema.parse(rawEmail);
  const fullName = text(2, 100, 'Full name').parse(rawName);
  const password = passwordSchema.parse(rawPassword);
  const sql = getSql();

  const [existing] = await sql`
    SELECT id, role FROM users WHERE lower(email) = ${email} LIMIT 1
  `;
  if (existing) {
    if (existing.role === 'platform_admin') {
      console.log('The configured platform administrator already exists; no account changes were made.');
      return;
    }
    throw new Error('The configured e-mail already belongs to a non-platform account. Choose a different e-mail.');
  }

  const passwordHash = await hashPassword(password);
  const user = await sql.begin(async (tx) => {
    const [created] = await tx`
      INSERT INTO users (email, password_hash, full_name, role, lgu_id, is_active, must_change_password)
      VALUES (${email}, ${passwordHash}, ${fullName}, 'platform_admin', NULL, TRUE, TRUE)
      RETURNING id, email
    `;
    await tx`
      INSERT INTO audit_logs (lgu_id, actor_id, action, target_type, target_id, details)
      VALUES (NULL, ${created.id}, 'platform_admin.create_env_bootstrap', 'user', ${String(created.id)},
        ${tx.json({ email: created.email, bootstrap: 'environment' })})
    `;
    return created;
  });

  console.log('Platform administrator created: ' + user.email + '. Change the temporary password at first sign-in.');
}

main()
  .catch((error) => {
    const message = error.issues ? error.issues.map((issue) => issue.message).join(' ') : error.message;
    console.error('Platform-admin bootstrap failed: ' + message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeSql();
  });
