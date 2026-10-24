// Serves the built web client (client/dist) with an SPA fallback to index.html.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

export function createStaticHandler(rootDir) {
  const root = path.resolve(rootDir);

  async function tryFile(filePath) {
    try {
      const stat = await fsp.stat(filePath);
      return stat.isFile() ? stat : null;
    } catch {
      return null;
    }
  }

  return async function serveStatic(ctx) {
    if (ctx.method !== 'GET' && ctx.method !== 'HEAD') {
      ctx.json(405, { error: { code: 'method_not_allowed', message: 'Method not allowed.' } });
      return;
    }
    let rel;
    try {
      rel = decodeURIComponent(ctx.path);
    } catch {
      ctx.send(400, 'Bad request');
      return;
    }
    if (rel.includes('\0')) {
      ctx.send(400, 'Bad request');
      return;
    }
    let filePath = path.resolve(root, '.' + path.posix.normalize(rel));
    // Never serve anything outside the client build directory.
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      ctx.send(404, 'Not found');
      return;
    }
    let stat = await tryFile(filePath);
    let isFallback = false;
    if (!stat) {
      // Requests for missing assets get a real 404; app routes get index.html.
      if (path.extname(rel) && !rel.endsWith('.html')) {
        ctx.send(404, 'Not found');
        return;
      }
      filePath = path.join(root, 'index.html');
      stat = await tryFile(filePath);
      isFallback = true;
      if (!stat) {
        ctx.send(
          503,
          'The web client has not been built yet. Run `npm run build` (or `npm run dev`) and reload.',
        );
        return;
      }
    }
    const ext = path.extname(filePath).toLowerCase();
    const base = path.basename(filePath);
    let cache = 'no-cache';
    if (/-[A-Z0-9]{8,}\.(js|css|png|woff2?|svg|jpg)$/i.test(base) || rel.startsWith('/fonts/')) {
      cache = 'public, max-age=31536000, immutable';
    } else if (rel.startsWith('/brand/') || rel.startsWith('/icons/')) {
      cache = 'public, max-age=86400';
    }
    if (isFallback || base === 'sw.js' || base === 'index.html') cache = 'no-cache';
    const res = ctx.res;
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', cache);
    res.setHeader('Last-Modified', stat.mtime.toUTCString());
    if (base === 'sw.js') res.setHeader('Service-Worker-Allowed', '/');
    if (ctx.method === 'HEAD') {
      res.end();
      return;
    }
    await new Promise((resolve) => {
      const stream = fs.createReadStream(filePath);
      stream.on('error', () => {
        if (!res.headersSent) ctx.send(500, 'Error');
        else res.destroy();
        resolve();
      });
      stream.on('end', resolve);
      stream.pipe(res);
    });
  };
}
