// `npm run dev`: rebuilds the web client on every change and restarts the
// API server when server files change. Open http://localhost:3000.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const children = [];

function run(name, args, cwd) {
  const child = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const prefix = (line) => `[${name}] ${line}`;
  for (const stream of [child.stdout, child.stderr]) {
    let buf = '';
    stream.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) if (l.trim()) console.log(l.startsWith(`[${name}]`) ? l : prefix(l));
    });
  }
  child.on('exit', (code) => {
    console.log(prefix(`exited with code ${code}`));
    shutdown(code || 0);
  });
  children.push(child);
}

function shutdown(code) {
  for (const c of children) if (!c.killed) c.kill();
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run('client', ['build.mjs', '--watch'], path.join(root, 'client'));
run('server', ['--watch-path=src', 'src/server.js'], path.join(root, 'server'));
