// Builds a single self-contained HTML page that runs the Wayguard interface
// entirely in the browser, with the demo data and an in-page stand-in for the
// API (src/preview/mockServer.js). Used to share a clickable preview; the
// real application is built with build.mjs and served by the Node.js server.
//   node build-preview.mjs [output.html]
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] || path.join(here, 'dist-preview', 'wayguard-preview.html'));

// '/fonts/…' and '/brand/…' URLs point at files in client/public; inline them.
const publicFiles = {
  name: 'public-files',
  setup(build) {
    build.onResolve({ filter: /^\/(fonts|brand|icons)\// }, (args) => ({ path: path.join(here, 'public', args.path) }));
  },
};

const result = await esbuild.build({
  entryPoints: [path.join(here, 'src', 'preview', 'main.jsx')],
  bundle: true,
  write: false,
  outdir: path.join(here, 'dist-preview', 'tmp'),
  format: 'iife',
  target: ['es2020', 'safari15', 'chrome100', 'firefox100'],
  jsx: 'automatic',
  minify: true,
  legalComments: 'none',
  loader: { '.png': 'dataurl', '.svg': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"', __WG_PREVIEW__: 'true' },
  plugins: [publicFiles],
  logLevel: 'warning',
});

const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text;
const css = result.outputFiles.find((f) => f.path.endsWith('.css'))?.text || '';
const safe = (s, tag) => s.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`);

const html = `<title>Wayguard Live Preview</title>
<meta name="description" content="Clickable preview of Wayguard, the road pothole reporting and monitoring system, running on demo data.">
<meta name="theme-color" content="#0A2244">
<style>${safe(css, 'style')}</style>
<div id="root"></div>
<script>${safe(js, 'script')}</script>
`;

await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, html);
console.log(`[preview] wrote ${path.relative(process.cwd(), out)} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB)`);
