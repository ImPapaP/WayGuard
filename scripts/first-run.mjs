// First-time setup on your own computer:  npm run first-run
// (after installing Node.js 22 and PostgreSQL, and running `npm install`).
//
// It asks a few questions, then:
//   1. creates the PostgreSQL user "wayguard" (with a random password) and the
//      databases "wayguard" and "wayguard_test",
//   2. writes your .env file from .env.example,
//   3. creates the tables and builds the web app,
//   4. loads the labelled demo data and/or creates your administrator.
// It can be run again safely; existing databases and data are kept.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = path.join(ROOT, '.env');
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error(`Wayguard needs Node.js 22.12 or newer (you have ${process.versions.node}). Install the LTS from https://nodejs.org`);
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
const lines = rl[Symbol.asyncIterator]();
async function ask(question, { hidden = false, fallback = '' } = {}) {
  const shown = fallback ? `${question} [${hidden ? 'press Enter to keep' : fallback}]: ` : `${question}: `;
  if (hidden && process.stdin.isTTY) {
    rl._writeToOutput = (s) => rl.output.write(s.includes(shown) ? s : s.replace(/[^\r\n]/g, '*'));
  }
  process.stdout.write(shown);
  const { value } = await lines.next();
  rl._writeToOutput = (s) => rl.output.write(s);
  if (hidden && process.stdin.isTTY) process.stdout.write('\n');
  const answer = (value ?? '').trim();
  return answer || fallback;
}
const yes = (a) => /^y(es)?$/i.test(a);

function run(args, label) {
  console.log(`\n> npm ${args.join(' ')}   (${label})`);
  const r = spawnSync(NPM, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`"npm ${args.join(' ')}" failed. Read the message above, fix it and run "npm run first-run" again.`);
}

function setEnv(text, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^#?\\s*${key}=.*$`, 'm');
  return re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
}

async function main() {
  console.log('\nWayguard first-time setup\n=========================\n');
  console.log('You need the password of the PostgreSQL "postgres" user (chosen when you installed PostgreSQL).\n');
  const host = await ask('PostgreSQL host', { fallback: 'localhost' });
  const port = await ask('PostgreSQL port', { fallback: '5432' });
  const superUser = await ask('PostgreSQL admin user', { fallback: 'postgres' });
  const superPass = await ask(`Password for "${superUser}"`, { hidden: true });

  // 1. database user and databases
  const admin = postgres({ host, port: Number(port), user: superUser, password: superPass, database: 'postgres', onnotice: () => {}, connect_timeout: 10 });
  const dbPass = crypto.randomBytes(18).toString('base64url');
  try {
    await admin`SELECT 1`;
  } catch (err) {
    throw new Error(`Cannot connect to PostgreSQL at ${host}:${port} as "${superUser}": ${err.message}. Is PostgreSQL running, and is the password right?`);
  }
  const [role] = await admin`SELECT 1 FROM pg_roles WHERE rolname = 'wayguard'`;
  // Role and database names are fixed identifiers; the password is a random URL-safe string.
  if (role) await admin.unsafe(`ALTER ROLE wayguard WITH LOGIN PASSWORD '${dbPass}'`);
  else await admin.unsafe(`CREATE ROLE wayguard WITH LOGIN PASSWORD '${dbPass}'`);
  for (const db of ['wayguard', 'wayguard_test']) {
    const [exists] = await admin`SELECT 1 FROM pg_database WHERE datname = ${db}`;
    if (!exists) await admin.unsafe(`CREATE DATABASE ${db} OWNER wayguard`);
    console.log(`  database ${db}: ${exists ? 'already there (kept)' : 'created'}`);
  }
  await admin.end();

  // 2. .env
  const contact = await ask('\nA contact e-mail for the free address search (required by OpenStreetMap)', { fallback: '' });
  const demo = yes(await ask('Load the labelled DEMO data (116 sample reports and 15 demo accounts) for practice? (y/N)', { fallback: 'n' }));
  let demoPass = '';
  if (demo) {
    demoPass = await ask('Password for the demo accounts (10+ characters, letters and numbers)', { hidden: true });
    if (demoPass.length < 10 || !/[A-Za-z]/.test(demoPass) || !/\d/.test(demoPass)) {
      demoPass = `Demo-${crypto.randomBytes(4).toString('hex')}-26`;
      console.log(`  That password is too short, so this one was chosen for the demo accounts: ${demoPass}`);
    }
  }
  let env = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  const url = (db) => `postgres://wayguard:${dbPass}@${host}:${port}/${db}`;
  env = setEnv(env, 'DATABASE_URL', url('wayguard'));
  env = setEnv(env, 'TEST_DATABASE_URL', url('wayguard_test'));
  if (contact) env = setEnv(env, 'GEOCODER_EMAIL', contact);
  if (demoPass) env = setEnv(env, 'SEED_DEMO_PASSWORD', demoPass);
  fs.writeFileSync(ENV_FILE, env);
  console.log('  .env written (keep it private; it is not uploaded anywhere).');

  // 3. tables and web app
  run(['run', 'db:migrate'], 'create the tables');
  run(['run', 'psgc:sync'], 'load the official Philippine geographic directory');
  run(['run', 'build'], 'build the web app');

  // 4. data and administrator
  if (demo) run(['run', 'db:seed'], 'load demo data');
  if (yes(await ask(`\nCreate your own administrator account now? (${demo ? 'y/N' : 'Y/n'})`, { fallback: demo ? 'n' : 'y' }))) {
    rl.close();
    run(['run', 'create-admin'], 'create administrator');
  }

  console.log('\nAll set. Start Wayguard with:\n\n    npm start\n\nthen open http://localhost:3000 in your browser.');
  if (demo) console.log(`Demo sign-in: admin@demo.wayguard.test (and the other demo accounts in README) with your demo password.`);
  if (!contact) console.log('Tip: add GEOCODER_EMAIL=your@email to .env so address search works.');
}

main()
  .catch((err) => {
    console.error(`\nSetup stopped: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
