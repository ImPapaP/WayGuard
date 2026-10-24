// Address search / reverse geocoding for signed-in users (rate limited).
import { Router, badRequest } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { latitude, longitude } from '../lib/validation.js';
import { RateLimiter } from '../lib/security.js';
import { getSettings } from '../services/settings.js';
import { searchAddress, reverseGeocode } from '../services/geocoder.js';

const limiter = new RateLimiter({ windowMs: 60 * 1000, max: 20, name: 'address lookups' });

export const geoRoutes = new Router('/api/geo');

geoRoutes.get('/search', requireAuth(), async (ctx) => {
  limiter.consume(`user:${ctx.user.id}`, ctx);
  const q = String(ctx.query.q || '').trim();
  if (q.length < 3) throw badRequest('Type at least 3 characters to search.');
  // Bias results to roughly 25 km around the LGU's map centre.
  const { map_center: c } = await getSettings();
  const viewbox = [c.lng - 0.25, c.lat + 0.25, c.lng + 0.25, c.lat - 0.25].map((n) => n.toFixed(4)).join(',');
  ctx.json(200, { items: await searchAddress(q, { viewbox }) });
});

geoRoutes.get('/reverse', requireAuth(), async (ctx) => {
  limiter.consume(`user:${ctx.user.id}`, ctx);
  const lat = latitude.parse(ctx.query.lat);
  const lng = longitude.parse(ctx.query.lng);
  ctx.json(200, { result: await reverseGeocode(lat, lng) });
});
