// Creates a platform-wide administrator used to provision LGU tenants.
// Run once after migrations: npm run create-platform-admin
// Non-interactive: PLATFORM_ADMIN_PASSWORD='...' npm run create-platform-admin -- --email platform@wayguard.example --name "WayGuard Platform Admin"
import readline from 'node:readline';
import { getSql, closeSql } from '../src/db/index.js';
import { hashPassword } from '../src/lib/security.js';
import { email as emailSchema, password as passwordSchema, text } from '../src/lib/validation.js';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function ask(rl, question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    if (hidden) {
      rl.stdoutMuted = true;
      rl._writeToOutput = (s) => {
        if (!rl.stdoutMuted || s.includes(question)) rl.output.write(s);
        else rl.output.write('*');
      };
    }
    rl.question(question, (answer) => {
      if (hidden) {
        rl.stdoutMuted = false;
        rl.output.write('\n');
      }
      resolve(answer.trim());
    });
  });
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  try {
    const email = emailSchema.parse(arg('email') || (await ask(rl, 'Platform administrator e-mail: ')));
    const name = text(2, 100, 'Full name').parse(arg('name') || (await ask(rl, 'Full name: ')));
    let password = process.env.PLATFORM_ADMIN_PASSWORD;
    if (!password) {
      password = await ask(rl, 'Password (min. 8 chars, letters and numbers): ', { hidden: true });
      const confirm = await ask(rl, 'Repeat password: ', { hidden: true });
      if (password !== confirm) throw new Error('The passwords do not match.');
    }
    passwordSchema.parse(password);
    const sql = getSql();
    const [exists] = await sql`SELECT 1 FROM users WHERE lower(email) = ${email}`;
    if (exists) throw new Error(`An account with ${email} already exists.`);
    const hash = await hashPassword(password);
    const [user] = await sql`
      INSERT INTO users (email, password_hash, full_name, role, lgu_id)
      VALUES (${email}, ${hash}, ${name}, 'platform_admin', NULL)
      RETURNING id`;
    await sql`
      INSERT INTO audit_logs (lgu_id, actor_id, action, target_type, target_id, details)
      VALUES (NULL, ${user.id}, 'platform_admin.create_cli', 'user', ${String(user.id)}, ${sql.json({ email })})`;
    console.log(`\nPlatform administrator ${email} created. Sign in at your Wayguard address to create LGU tenants.`);
  } catch (err) {
    const message = err.issues ? err.issues.map((i) => i.message).join(' ') : err.message;
    console.error(`\nCould not create the platform administrator: ${message}`);
    process.exitCode = 1;
  } finally {
    rl.close();
    await closeSql();
  }
}

main();
