# 8. Deployment

For the free Render + Neon setup with click-by-click steps, see
[10-go-live.md](10-go-live.md). The repository includes `render.yaml`
(Render Blueprint) and `.node-version`.

Wayguard is a single Node.js process plus a PostgreSQL database and a folder
for photos. Any host that runs Node.js 22 works (a VPS, a university server,
or a platform such as Render or Railway with a managed PostgreSQL).

## 8.1 Checklist

1. **Database**: PostgreSQL 14+; create a user and database (README step 2).
   Use a strong password and do not expose port 5432 to the internet.
2. **Environment** (`.env` or the host's environment variables):
   - `NODE_ENV=production` (secure cookies, HSTS, demo seeding refused)
   - `DATABASE_URL`, `PUBLIC_BASE_URL=https://your-domain`
   - `UPLOAD_DIR` on persistent storage (back it up with the database)
   - `TRUST_PROXY=true` only if a reverse proxy/load balancer sits in front
   - `GEOCODER_EMAIL` (real contact)
   - Optional `SMTP_*` and `MAIL_FROM` for e-mail notifications
   - `TILE_URL` / `TILE_ATTRIBUTION` for a production tile provider (below)
3. **Install and build**: `npm ci` (or `npm install`), `npm run db:migrate`, `npm run build`.
4. **First administrator**: `npm run create-admin`.
5. **Start**: `npm start` under a process manager (systemd, pm2, the platform's runner).
6. **HTTPS**: required for GPS on phones and for secure cookies. Terminate TLS
   at a reverse proxy (nginx, Caddy) or the platform, or set `HTTPS_KEY_FILE`
   and `HTTPS_CERT_FILE`.
7. **Backups**: `pg_dump` the database and copy `UPLOAD_DIR` regularly.

### Example nginx site

```nginx
server {
  listen 443 ssl http2;
  server_name wayguard.example.gov.ph;
  ssl_certificate     /etc/letsencrypt/live/wayguard.example.gov.ph/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/wayguard.example.gov.ph/privkey.pem;
  client_max_body_size 50m;          # photo uploads
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }
}
```

With this setup set `TRUST_PROXY=true` so rate limits use the real client IP.

## 8.2 Maps and geocoding in production

### Default map: Wayguard road map (OpenFreeMap)

With no map settings, every map is Wayguard's own Waze-style road map:
MapLibre GL JS draws OpenStreetMap vector tiles from
[OpenFreeMap](https://openfreemap.org) using the "Wayguard Road" style
(`client/src/components/roadStyle.js`). OpenFreeMap is free, needs no key or
sign-up, allows commercial use and has no request limits, but offers **no
service guarantee** (it runs on donations). For an LGU deployment:

- It is fine to start with OpenFreeMap. If you need a guarantee, point
  `MAP_VECTOR_TILEJSON_URL` and `MAP_GLYPHS_URL` to any service that serves the
  **OpenMapTiles** schema — a paid provider, or your own copy (OpenFreeMap's
  software and a Philippines-only extract can be self-hosted).
- The map needs WebGL. Browsers without it, or networks that block the tile
  host, automatically get the basic Leaflet/OpenStreetMap raster map with a
  notice. `MAP_PROVIDER=osm` forces the basic map everywhere.
- The CSP automatically allows the hosts in those two URLs; MapLibre's worker
  is served from `/vendor/` on your own site (no `blob:` workers needed).
- Attribution ("OpenFreeMap © OpenMapTiles Data from OpenStreetMap") is shown
  on every map and must stay.

### Google Maps (optional)

Wayguard shows Google Maps on every map when `GOOGLE_MAPS_API_KEY` is set,
and OpenStreetMap otherwise. If Google Maps cannot load (wrong key, billing
off, address not allowed, network blocked), maps switch to OpenStreetMap
automatically and say so, so reporting never stops working.

1. In the [Google Cloud Console](https://console.cloud.google.com/), create
   (or pick) a project and **enable billing**. Google Maps Platform requires
   a billing account even within its free monthly usage; check current
   pricing at <https://mapsplatform.google.com/pricing/>.
2. Enable the **Maps JavaScript API** (APIs & Services > Library).
3. Create an API key (APIs & Services > Credentials) for the browser and
   restrict it:
   - *Application restrictions*: **Websites**, add your address(es), e.g.
     `https://wayguard.example.gov.ph/*` and, for development,
     `http://localhost:3000/*`.
   - *API restrictions*: **Maps JavaScript API** only.
   This key is visible to anyone who opens the site — that is how Google's
   browser keys work — so these restrictions are what protect it.
4. Optional but recommended: create a **Map ID** (Google Maps Platform >
   Map management, type *JavaScript*, vector or raster) and set
   `GOOGLE_MAPS_MAP_ID`. Without it Wayguard uses Google's `DEMO_MAP_ID`,
   which is meant for testing.
5. Put the key in `.env` as `GOOGLE_MAPS_API_KEY=...` and restart. The
   server log prints `Maps: Google Maps`.
6. Check it: open `/map` — you should see Google's map with Wayguard's pins.
   If you see the notice "Google Maps could not load", open the browser
   console: Google prints the reason (e.g. `RefererNotAllowedMapError`,
   `ApiNotActivatedMapError`, `BillingNotEnabledMapError`).

**Address search through Google (optional).** Set `GEOCODER_PROVIDER=google`
and `GOOGLE_GEOCODING_API_KEY` to a **second** key with only the
**Geocoding API** enabled and an **IP address** restriction for your
server. This key stays on the server. Google's terms allow Geocoding
results to be shown only with a Google map, so use it only together with
`GOOGLE_MAPS_API_KEY`; otherwise keep Nominatim (the default). Results are
cached for 30 days, the longest Google allows for coordinates.

The Content-Security-Policy automatically adds the hosts Google Maps needs
when a key is set (from Google's CSP guide), and the crew app's *Directions*
button opens Google Maps (these links need no key).

### OpenStreetMap

- The public `tile.openstreetmap.org` server is free for light use, with no
  service guarantee, and heavy use is not allowed
  (<https://operations.osmfoundation.org/policies/tiles/>). For an LGU
  deployment use an OSM-based provider with a plan that fits the traffic, or
  host tiles, then set `TILE_URL` and `TILE_ATTRIBUTION`. The CSP is built
  from `TILE_URL` automatically.
- Nominatim's public server allows at most 1 request per second and requires
  an identifying contact (<https://operations.osmfoundation.org/policies/nominatim/>).
  Wayguard already throttles, caches and identifies itself. For heavier use,
  point `GEOCODER_URL` to a self-hosted or commercial Nominatim-compatible
  service, or set `GEOCODER_ENABLED=false` (map pin and GPS still work).

## 8.3 Scaling notes

Rate limiting and the e-mail worker run inside the single server process.
To run several instances, move rate-limit counters to a shared store and run
the mailer in one instance only. Photos on local disk would need shared
storage (or object storage) in that case.

## 8.4 Development vs production

| Setting | Development | Production |
| --- | --- | --- |
| `NODE_ENV` | development | production |
| Cookies | not `Secure` over plain http | `Secure`, `__Host-` prefix, HSTS |
| Demo data | `npm run db:seed` allowed | refused |
| Client | `npm run dev` (unminified, rebuilds) | `npm run build` (minified, service worker) |
| Error output | stack traces in the server console only | same; clients always get generic messages |
