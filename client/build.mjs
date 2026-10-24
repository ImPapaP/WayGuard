// Builds the Wayguard web client (React + Leaflet) into client/dist with
// esbuild, writes index.html with hashed asset names and generates the
// service worker for the installable PWA.
//   node build.mjs          production build (minified)
//   node build.mjs --watch  development build that rebuilds on change
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
const watch = process.argv.includes('--watch');
const production = !watch;

async function copyDir(from, to) {
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) await copyDir(src, dest);
    else if (entry.name !== 'sw.template.js') await fs.copyFile(src, dest);
  }
}

async function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(p, base)));
    else out.push('/' + path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

async function writeShell(metafile) {
  const outputs = Object.entries(metafile.outputs);
  const js = outputs.find(([file, o]) => o.entryPoint && file.endsWith('.js'));
  const css = outputs.find(([file]) => file.endsWith('.css'));
  // Metafile paths are relative to the directory esbuild ran in.
  const toUrl = (file) => '/' + path.relative(dist, path.resolve(process.cwd(), file)).split(path.sep).join('/');
  const template = await fs.readFile(path.join(here, 'index.html'), 'utf8');
  const html = template
    .replace('<!--styles-->', css ? `<link rel="stylesheet" href="${toUrl(css[0])}">` : '')
    .replace('<!--scripts-->', `<script type="module" src="${toUrl(js[0])}"></script>`);
  await fs.writeFile(path.join(dist, 'index.html'), html);

  // Service worker: precache the app shell and static assets so the app
  // opens offline; API calls and map tiles always go to the network.
  const files = (await listFiles(dist)).filter(
    (f) => !f.endsWith('.map') && f !== '/sw.js' && !f.startsWith('/brand/source'),
  );
  const version = crypto.createHash('sha256').update(files.join('|') + html).digest('hex').slice(0, 12);
  const sw = (await fs.readFile(path.join(here, 'public', 'sw.template.js'), 'utf8'))
    .replace('__VERSION__', version)
    .replace('__PRECACHE__', JSON.stringify(files.filter((f) => f !== '/index.html'), null, 2));
  await fs.writeFile(path.join(dist, 'sw.js'), sw);
}

const require = createRequire(import.meta.url);
const maplibreWorker = path.join(path.dirname(require.resolve('maplibre-gl/package.json')), 'dist', 'maplibre-gl-csp-worker.js');

const shellPlugin = {
  name: 'wayguard-shell',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length) return;
      await copyDir(path.join(here, 'public'), dist);
      // MapLibre's CSP-friendly worker is served from our own origin.
      await fs.mkdir(path.join(dist, 'vendor'), { recursive: true });
      await fs.copyFile(maplibreWorker, path.join(dist, 'vendor', 'maplibre-gl-csp-worker.js'));
      await writeShell(result.metafile);
      if (watch) console.log(`[client] rebuilt at ${new Date().toLocaleTimeString()}`);
    });
  },
};

await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(dist, { recursive: true });

const options = {
  entryPoints: { app: path.join(here, 'src', 'main.jsx') },
  bundle: true,
  outdir: path.join(dist, 'assets'),
  entryNames: '[name]-[hash]',
  assetNames: '[name]-[hash]',
  publicPath: '/assets',
  format: 'esm',
  // The vector map library (MapLibre) is loaded only when a map is shown.
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  target: ['es2020', 'safari15', 'chrome100', 'firefox100'],
  jsx: 'automatic',
  minify: production,
  sourcemap: true,
  metafile: true,
  legalComments: 'linked',
  loader: { '.png': 'file', '.svg': 'file', '.woff': 'file', '.woff2': 'file' },
  // Files served from client/public keep their own URLs.
  external: ['/fonts/*', '/brand/*', '/icons/*'],
  define: {
    'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development'),
    // true only in the self-contained browser preview (build-preview.mjs)
    __WG_PREVIEW__: 'false',
  },
  logLevel: 'warning',
  plugins: [shellPlugin],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('[client] watching for changes...');
} else {
  const result = await esbuild.build(options);
  const size = Object.entries(result.metafile.outputs)
    .filter(([f]) => /\.(js|css)$/.test(f))
    .map(([f, o]) => `${path.basename(f)} ${(o.bytes / 1024).toFixed(0)} KB`)
    .join(', ');
  console.log(`[client] built to client/dist (${size})`);
}
