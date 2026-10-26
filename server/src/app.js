// Assembles the HTTP application: security headers, the JSON API under /api,
// and the built web client for every other path.
import {
  Router,
  compose,
  createContext,
  sendError,
  HttpError,
} from './lib/http.js';
import { createStaticHandler } from './lib/static.js';
import { securityHeaders, csrfProtection } from './lib/security.js';
import { config } from './config.js';
import { sql } from './db/index.js';
import { loadSession } from './services/sessions.js';
import { authRoutes } from './routes/auth.js';
import { reportRoutes } from './routes/reports.js';
import { photoRoutes } from './routes/photos.js';
import { notificationRoutes } from './routes/notifications.js';
import { publicRoutes } from './routes/public.js';
import { adminRoutes } from './routes/admin.js';
import { platformRoutes } from './routes/platform.js';
import { maintenanceRoutes } from './routes/maintenance.js';
import { geoRoutes } from './routes/geo.js';
import { exportRoutes } from './routes/exports.js';

export function createApp({ logRequests = !config.isTest } = {}) {
  const api = new Router();
  api.get('/api/health', async (ctx) => {
    await sql`SELECT 1`;
    ctx.json(200, { status: 'ok', time: new Date().toISOString() });
  });
  for (const r of [
    authRoutes,
    reportRoutes,
    photoRoutes,
    notificationRoutes,
    publicRoutes,
    adminRoutes,
    platformRoutes,
    maintenanceRoutes,
    geoRoutes,
    exportRoutes,
  ]) {
    api.include(r);
  }

  const apiPipeline = compose([csrfProtection(), loadSession()]);
  const serveStatic = createStaticHandler(config.clientDist);
  const withHeaders = securityHeaders();

  return async function handle(req, res) {
    const started = Date.now();
    const ctx = createContext(req, res, { trustProxy: config.trustProxy });
    if (logRequests) {
      res.on('finish', () => {
        if (ctx.path.startsWith('/api/')) {
          console.log(`${ctx.method} ${ctx.path} ${res.statusCode} ${Date.now() - started}ms`);
        }
      });
    }
    try {
      await withHeaders(ctx, async () => {
        if (ctx.path === '/api' || ctx.path.startsWith('/api/')) {
          const match = api.match(ctx.method, ctx.path);
          if (!match) throw new HttpError(404, 'API endpoint not found.', undefined, 'not_found');
          if (match.methodNotAllowed) throw new HttpError(405, 'Method not allowed.', undefined, 'method_not_allowed');
          ctx.params = match.params;
          await apiPipeline(ctx, () => compose(match.route.handlers)(ctx));
          if (!ctx.responded) ctx.json(204, null);
        } else {
          await serveStatic(ctx);
        }
      });
    } catch (err) {
      if (!ctx.responded) sendError(ctx, err);
      else res.destroy();
    }
  };
}
