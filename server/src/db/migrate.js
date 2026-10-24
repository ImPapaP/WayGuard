// Applies SQL files in ./migrations in filename order. Each file runs once,
// inside its own transaction, and is recorded in `schema_migrations`.
// Usage: npm run db:migrate
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSql, closeSql } from './index.js';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrate({ log = console.log } = {}) {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  const applied = new Set((await sql`SELECT filename FROM schema_migrations`).map((r) => r.filename));
  const files = (await fs.readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const text = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`INSERT INTO schema_migrations (filename) VALUES (${file})`;
    });
    log(`  applied ${file}`);
    count += 1;
  }
  log(count ? `Migrations complete (${count} applied).` : 'Database is already up to date.');
  return count;
}

// Run directly from the command line
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  migrate()
    .then(() => closeSql())
    .catch(async (err) => {
      console.error('Migration failed:', err.message);
      await closeSql();
      process.exit(1);
    });
}
