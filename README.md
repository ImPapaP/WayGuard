# Wayguard — Road Pothole Reporting and Monitoring System

IT 305 Advanced Web Development final project: *Development of a Web and
Mobile-Based Road Pothole Reporting and Monitoring System for Local Government
Units*.

Citizens report potholes from a phone or computer with photos, GPS or a map
pin, a description and a severity rating. LGU administrators review and verify
reports, flag duplicates, route them to the responsible agency and assign them
to maintenance teams. Road crews document repairs with before-and-after photos,
and the LGU verifies the work before the report is closed. Everyone involved is
notified at each step.

| Who | Where | What they can do |
| --- | --- | --- |
| Citizen / reporter | `/app` (installable mobile web app) | Register, report potholes (photo, GPS or map pin or address, description, severity), track "My reports" on a progress road and timeline, receive notifications, view the public map, rate completed repairs |
| LGU administrator | `/admin` | Manage staff and crews, teams, agencies and LGU settings; full report workflow, statistics, map, exports and activity log |
| LGU staff | `/admin` | Process reports for their assigned LGU, review and verify reports, assign repairs, view the LGU map and export tenant-scoped reports |
| Platform administrator | `/platform/lgus` | Create and deactivate LGU workspaces and appoint each LGU's first administrator |
| Road maintenance personnel | `/crew` (mobile web app) | View assigned tasks with location, directions link and instructions, start work, post progress updates with before/progress photos, submit completion with after photos for LGU verification |
| Public | `/`, `/map` | See verified potholes and repairs on an OpenStreetMap map (no personal data) |

> **Run the real system:** on your computer, install Node.js 22 and PostgreSQL,
> then `npm install` and `npm run first-run` (it sets everything up), then
> `npm start`. To put it online for free (Render + Neon), follow
> [docs/10-go-live.md](docs/10-go-live.md).

Documentation is in [`docs/`](docs/):
[requirements traceability](docs/01-requirements-traceability.md) ·
[architecture](docs/02-architecture.md) ·
[database](docs/03-database.md) ·
[API](docs/04-api.md) ·
[user manual](docs/05-user-manual.md) ·
[test report](docs/06-test-report.md) ·
[demo checklist](docs/07-demo-checklist.md) ·
[deployment](docs/08-deployment.md) ·
[brand usage](docs/09-brand-usage.md) ·
[go live](docs/10-go-live.md) ·
[uptime, e-mail and phone testing](docs/11-operations.md) ·
[working together](CONTRIBUTING.md).
Development status and decisions: [`WAYGUARD_PROGRESS.md`](WAYGUARD_PROGRESS.md).

---

## Technology

| Layer | Choice |
| --- | --- |
| Web and mobile front end | React 19 single-page app, installable **Progressive Web App** (one code base for desktop and phones), bundled with esbuild |
| Maps | **Waze-style road map** by default: MapLibre GL 5 drawing free OpenStreetMap vector tiles (OpenFreeMap, no key) in Wayguard's colours — night map by default (Night Ink, slate streets, Road Amber highways, route-number shields) with a day map switch — and a full-screen map screen (floating search, locate-me, 3D tilt, **drive mode** with heading arrow, speed and "Pothole ahead" alerts, Report button, slide-up sheets). Optional **Google Maps**. Leaflet + OpenStreetMap raster tiles as the automatic fallback. Address search through the server (Nominatim, or Google Geocoding) |
| Back end / API | Node.js 22 (`node:http`) with a small built-in router, zod validation, sessions in PostgreSQL |
| Database | PostgreSQL 14+ (tested on 16) via the `postgres` driver; SQL migrations |
| Photos | Stored on disk outside the web root; validated and re-encoded with `sharp` (EXIF/GPS metadata removed) |
| Exports | CSV, and PDF with `pdf-lib` |
| Notifications | In-app notifications for every status change, optional e-mail through any SMTP server |
| Tests | `node:test` API integration tests (60), Playwright end-to-end workflow test (28 steps), map screen browser test (13 steps), Google Maps browser test (9 steps) |

## 1. Install the prerequisites

1. **Node.js 22.12 or newer** (LTS) — <https://nodejs.org>. Check with `node -v`.
2. **PostgreSQL 14 or newer** — <https://www.postgresql.org/download/>.
   On Windows, the EDB installer includes *pgAdmin* and `psql`. Remember the
   password you give the `postgres` user.
   *Alternative:* if you have Docker, `docker compose up -d` starts PostgreSQL
   16 with the database and user from `docker-compose.yml`.

## 2. Create the database

Open `psql` (or pgAdmin's Query Tool) as the `postgres` user and run — choose
your own password:

```sql
CREATE ROLE wayguard WITH LOGIN PASSWORD 'choose-a-db-password';
CREATE DATABASE wayguard OWNER wayguard;
CREATE DATABASE wayguard_test OWNER wayguard;  -- only needed for `npm test`
```

## 3. Configure

Copy the example settings and edit them:

```bash
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
```

In `.env`, set at least:

- `DATABASE_URL=postgres://wayguard:choose-a-db-password@localhost:5432/wayguard`
- `TEST_DATABASE_URL=postgres://wayguard:choose-a-db-password@localhost:5432/wayguard_test`
- `GEOCODER_EMAIL=` a real contact e-mail (required by the Nominatim usage policy)
- `SEED_DEMO_PASSWORD=` a password for the demo accounts (10+ characters, letters and numbers) if you will load demo data

**Maps**: nothing to set up — the default Waze-style map uses free
OpenStreetMap vector tiles from [OpenFreeMap](https://openfreemap.org) (no
key). Optional — **Google Maps**: set `GOOGLE_MAPS_API_KEY` (and ideally
`GOOGLE_MAPS_MAP_ID`) to show Google Maps instead of OpenStreetMap. Follow
[docs/08-deployment.md §8.2](docs/08-deployment.md#82-maps-and-geocoding-in-production)
to create the key and **restrict it to your site**; without a key the app
uses the default map and everything else works the same.

All settings are explained in `.env.example`. `.env` is git-ignored; never
commit it.

## 4. Install, migrate, build

```bash
npm install          # installs server and client packages (npm workspaces)
npm run db:migrate   # creates the tables
npm run build        # builds the web client into client/dist
```

(`npm run setup` runs all three. Easier: `npm run first-run` asks for your
PostgreSQL password and does steps 2–5 for you.)

## 5. Create accounts and (optionally) demo data

**For a demonstration**, load clearly-labelled demo data — agencies, two road
crews, 15 demo accounts and 116 reports in every workflow stage:

```bash
npm run db:seed
```

| Demo account | Role |
| --- | --- |
| `admin@demo.wayguard.test`, `admin2@demo.wayguard.test` | LGU administrators |
| `crew.alpha@…`, `crew.bravo@…`, `crew.charlie@…`, `crew.delta@demo.wayguard.test` | Maintenance personnel (one per road crew) |
| `maria@…`, `juan@…`, `liza@…`, `ben@…`, `grace@…`, `mark@…`, `joy@…`, `paolo@…`, `rose@demo.wayguard.test` | Citizens |

All demo accounts use the `SEED_DEMO_PASSWORD` from your `.env`. Demo reports
are tagged "Demo" everywhere and their photos are illustrations stamped
"DEMO PHOTO". `npm run db:seed -- --fresh` removes and recreates the demo data.
Seeding is refused when `NODE_ENV=production` unless `DEMO_DATA=on` is set
explicitly (used for a hosted demonstration, see `docs/10-go-live.md`).

**For real use**, create the first administrator (there is no default
administrator password anywhere in Wayguard):

```bash
npm run create-admin
```

The administrator then creates accounts under **Users**. Accounts created by an LGU administrator automatically belong to that LGU; maintenance personnel must be assigned to one of that LGU's teams. Regular LGU staff can process reports but cannot manage users, teams, agencies or settings. Citizens select their LGU when registering at `/register`.

### Multi-LGU setup

The multi-LGU migration creates a default LGU and attaches existing users, reports, teams, agencies, settings and historical records to it. Render's configured start command applies database migrations automatically on the next deploy.

To provision additional cities or municipalities, bootstrap a separate platform administrator once, then sign in and open **LGU management** at `/platform/lgus`. For local development, run:

```bash
npm run create-platform-admin
```

Use a unique e-mail address and a strong password. This platform administrator creates each LGU and its first LGU administrator. The LGU administrator then creates that jurisdiction's staff and maintenance crews under **Users**. Do not share the platform administrator account with LGU personnel.

Tenant restrictions are enforced by the backend and database constraints, not only by the interface. LGU staff and administrators can access only their LGU's private reports, assignments, maps, statistics, photos, notifications and exports. Only LGU administrators can manage users, teams, agencies, settings and the activity log. The public map remains public-safe and may show verified reports across LGUs.

## 6. Run

```bash
npm start            # production mode: http://localhost:3000
npm run dev          # development: rebuilds the client and restarts the server on changes
```

Open <http://localhost:3000>.

### Testing on a phone (GPS and camera)

Phones on the same Wi-Fi can open `http://<your-computer-IP>:3000`, but
browsers only allow **GPS** on secure (`https://`) pages. Options:

- Create a trusted local certificate with [mkcert](https://github.com/FiloSottile/mkcert):
  `mkcert -install && mkcert 192.168.1.10 localhost` (use your IP), then set
  `HTTPS_KEY_FILE` and `HTTPS_CERT_FILE` in `.env` to the two generated files
  and restart. Open `https://192.168.1.10:3000` on the phone (install mkcert's
  root CA on the phone, see mkcert's README).
- Or use a tunnelling service that gives you an `https://` URL.
- Without HTTPS everything else works; citizens place the pin on the map instead.

On the phone, use the browser's **Add to Home Screen / Install app** to install
Wayguard like an app.

## 7. Test

```bash
npm test             # 60 API integration tests (uses TEST_DATABASE_URL, wipes it)
npm run build && npm install --no-save playwright && npx playwright install chromium
npm run test:e2e     # browser test of the whole workflow (also uses the test database)
npm run test:e2e:map     # Waze-style map screen and fallback, against a local test tile service
npm run test:e2e:google  # Google Maps integration and fallback, against a local stand-in for Google's API
```

Results from the development run are in [docs/06-test-report.md](docs/06-test-report.md).

## Browser-only preview (optional)

```bash
npm run build:preview   # writes client/dist-preview/wayguard-preview.html
```

This produces one self-contained HTML page that runs the real interface in any
browser **without the server or database**: an in-page stand-in for the API
(`client/src/preview/mockServer.js`) answers with the demo data, which lives
only in that page and resets on reload. A strip at the top switches between
the public site, citizen, administrator and road-crew views (demo password
`preview`). It is meant for showing the project to people who cannot install
it; map tiles, file downloads and real GPS are replaced or disabled there. The
real application never uses it.

## Project structure

```
wayguard/
├── client/                 Web client (React PWA)
│   ├── build.mjs           esbuild build: bundles, writes index.html and the service worker
│   ├── build-preview.mjs   self-contained browser preview (optional, see above)
│   ├── public/             brand artwork, fonts, icons, manifest, service-worker template
│   └── src/
│       ├── components/     shells, map, location picker, photos, progress road, timeline, charts, UI kit
│       ├── lib/            router, API client, auth, formatting, image compression
│       ├── pages/          public, citizen, admin, crew and shared screens
│       ├── preview/        in-browser API stand-in used only by the preview build
│       └── styles/         design tokens and stylesheets
├── server/                 API and web server
│   ├── src/
│   │   ├── db/             connection, migration runner, SQL migrations
│   │   ├── lib/            HTTP router/body parsing, security, validation, static files
│   │   ├── middleware/     authentication and role guards
│   │   ├── routes/         auth, reports, photos, notifications, public, admin, maintenance, geo, exports
│   │   └── services/       workflow, reports, photos, sessions, notifications, mailer/SMTP, geocoder, stats, exporter
│   ├── scripts/            create-admin, seed-demo
│   └── tests/              API integration tests
├── tests/e2e/              Playwright end-to-end test
├── docs/                   Project documentation
├── assets/brand-source/    Supplied logo files and Brand Sheet (originals)
├── scripts/dev.mjs         `npm run dev`
├── docker-compose.yml      Optional PostgreSQL for development
└── WAYGUARD_PROGRESS.md    Development log, decisions and status
```

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Cannot connect to PostgreSQL` | Is PostgreSQL running? Do the user, password and database in `DATABASE_URL` exist? |
| `The database has no Wayguard tables yet` | Run `npm run db:migrate`. |
| Page says the client is not built | Run `npm run build` (or use `npm run dev`). |
| Map is grey | The computer has no internet access, or the tile server is blocked by a firewall. Reports, GPS and map pins still work. |
| "The road map could not load, so the basic OpenStreetMap map is shown instead" | The browser has no WebGL (old device, or hardware acceleration off) or `tiles.openfreemap.org` is blocked. Everything still works on the basic map; turn on hardware acceleration or allow the site. To always use the basic map set `MAP_PROVIDER=osm`. |
| "Google Maps could not load, so OpenStreetMap is shown instead" | The Google key was rejected or Google is unreachable. The browser console shows Google's reason (e.g. `RefererNotAllowedMapError`: add your address to the key's website restrictions; `BillingNotEnabledMapError`: enable billing). See docs/08-deployment.md §8.2. |
| Address search says it is unavailable | Nominatim is unreachable or rate-limited; pin the location on the map. Check `GEOCODER_EMAIL`. |
| "Use my current location" explains it needs https | Use `localhost` on the computer or set up HTTPS for phones (see above). |
| `sharp` fails to install | Use Node 22 LTS 64-bit and run `npm install` again; see <https://sharp.pixelplumbing.com/install>. |

## Credits and licences

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL); vector tiles by [OpenFreeMap](https://openfreemap.org) © [OpenMapTiles](https://www.openmaptiles.org/); map libraries [MapLibre GL JS](https://maplibre.org) (BSD-3-Clause) and [Leaflet](https://leafletjs.com) (BSD-2-Clause). The "Wayguard Road" map style and report-bubble artwork are original to this project (inspired by driving apps; no Waze artwork is used).
- Test glyphs in `tests/e2e/fixtures/glyphs`: Noto Sans (SIL OFL 1.1).
- Google Maps, when enabled, is used under the [Google Maps Platform Terms of Service](https://cloud.google.com/maps-platform/terms).
- Fonts: Montserrat and Nunito Sans, SIL Open Font License 1.1 (`client/public/fonts/*-OFL.txt`).
- Icons: [Lucide](https://lucide.dev) via react-icons (ISC).
- Wayguard name, logo and slogan: official artwork supplied in the Wayguard Brand Sheet.
