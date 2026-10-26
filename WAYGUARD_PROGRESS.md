# WAYGUARD_PROGRESS.md

Development record for **Wayguard — Road Pothole Reporting and Monitoring
System** (IT 305 Project 2). Last updated **24 October 2026**.

## Current phase

**Complete — ready for local installation and demonstration.** All 18
functional requirements, the three roles, the workflow and statuses, the UI
screens and the constraints in the IT 305 brief are implemented and covered
by automated tests that pass (50 API tests, 27-step browser workflow test).
Remaining items are environment checks that could not be done in the build
sandbox (see *Known limitations*).

## Confirmed requirements (from the IT 305 brief)

- Web-based administrative dashboard + mobile-friendly citizen interface (PWA allowed by the brief).
- Roles: Citizen/Reporter, Administrator/LGU Personnel, Road Maintenance Personnel.
- FR-01…FR-18: registration/login, reporting, photos, GPS, manual location (map pin or address), description, severity, report management, status tracking, assignment, notifications, interactive map, repair documentation, dashboard/analytics, history, duplicate detection, feedback, CSV/PDF export.
- Statuses: Submitted, Under Review, Verified, Assigned, In Progress, Resolved, Rejected, Duplicate.
- Constraints: GPS optional with manual fallback, responsible agency per road, no unnecessary personal data in public, reports not verified automatically.
- Branding: official Wayguard Brand Sheet (navy `#0A2244`, Road Amber `#FAAE0B`, Night Ink `#061429`, Cloud `#F5F7FA`; Montserrat ExtraBold + Nunito Sans; logo rules).

Full matrix: `docs/01-requirements-traceability.md`.

## Technology stack and key decisions

| Area | Decision |
| --- | --- |
| Client | React 19 SPA + installable PWA, esbuild build with code splitting (`client/build.mjs`), small history router, maps: MapLibre GL 5 + OpenFreeMap vector tiles (default, Waze-style), Google Maps JavaScript API when a key is set, Leaflet 1.9 + OSM raster tiles as fallback; react-icons (Lucide), self-hosted fonts |
| Server | Node.js ≥ 22.12, `node:http` with an in-house router (`server/src/lib/http.js`), zod validation, server-side sessions, scrypt |
| Database | PostgreSQL 14+ via `postgres` (Postgres.js); SQL migrations |
| Files | Photos re-encoded by `sharp`, stored privately in `UPLOAD_DIR`, served through an access-checked endpoint |
| Exports | CSV; PDF via `pdf-lib` |
| Notifications | In-app (transactional) + optional SMTP e-mail outbox (own SMTP client) |
| Geocoding | Nominatim (default) or Google Geocoding (server-only key) through a server proxy (cached) |

Why not Express/Vite/pg: the build sandbox could not reach the npm registry,
so only packages available offline (or downloadable from GitHub releases)
could be used and tested. Declared dependencies (`postgres`, `zod`, `sharp`,
`pdf-lib`, `react`, `react-dom`, `react-icons`, `leaflet`, `esbuild`) are
normal npm packages installed by `npm install`. Rationale for other decisions:
`docs/02-architecture.md#decisions-and-assumptions`.

## Project structure

See README "Project structure". Main areas: `server/src/{lib,db,middleware,routes,services}`,
`server/scripts` (seed, create-admin), `server/tests`, `client/src/{components,lib,pages,styles}`,
`client/public` (brand, fonts, icons, manifest, SW template), `tests/e2e`, `docs`.
Size: server ≈ 4,500 lines, client ≈ 9,800 lines, tests ≈ 1,550 lines, docs ≈ 1,200 lines.

## Database schema

Tables: `lgus`, `users`, `sessions`, `agencies`, `maintenance_teams`, `reports`,
`assignments`, `repair_updates`, `report_photos`, `report_events`,
`notifications`, `feedback`, `settings`, `audit_logs`, `geocode_cache`,
`schema_migrations`; function `wg_distance_m`. Migrations: `001_initial_schema.sql`, `002_multi_lgu.sql`.
`server/src/db/migrations/001_initial_schema.sql`. Details and ERD:
`docs/03-database.md`.

## Completed milestones

1. Requirements analysis, traceability, architecture — done.
2. Project scaffold, brand assets (supplied PNGs + variants cut from the Brand Sheet), fonts, PWA icons — done.
3. Database schema, migration runner, demo seed, create-admin — done.
4. Auth, sessions, RBAC, CSRF, rate limiting, security headers — done and tested.
5. Reports, photos, duplicates, workflow, assignments, repairs, notifications, feedback, history — done and tested.
6. Admin: users, teams, agencies, settings, stats, CSV/PDF/summary exports, audit log, geocoder proxy, e-mail — done and tested.
7. Web client: public site and map, auth, citizen PWA, admin workspace, crew app — done.
8. End-to-end browser test of the complete workflow and admin tools — 27/27 pass.
9. Visual review (desktop + phone), accessibility checks (keyboard, contrast), PWA/offline check — done; defects fixed.
10. Documentation set (README + docs 01–09, test logs, screenshots) — done.
11. Browser-only preview (`npm run build:preview` → one self-contained HTML page with an in-page API stand-in and the demo data) — done, shape-checked against the real API and click-tested; published as a private claude.ai artifact ("Wayguard Live Preview"). Fixed a Leaflet error when leaving a map mid-zoom.
12. **Google Maps** (24 Oct, requested by the team): every map uses the Google Maps JavaScript API (Advanced Markers) when `GOOGLE_MAPS_API_KEY` is set, with automatic fallback to OpenStreetMap; optional Google Geocoding with a separate server-only key; CSP, directions links and footer credit follow the provider. Tests: 56/56 API, 27/27 E2E, 9/9 Google Maps browser test (against a stand-in for Google's API — not yet tried with a real key).
13. **Waze-style map** (24 Oct, requested by the team): new default map — Wayguard's own "Wayguard Road" vector style (MapLibre GL 5 + free OpenStreetMap vector tiles from OpenFreeMap, no key) in brand colours, report bubbles with a pothole symbol, and a full-screen map screen for the public, citizen and crew maps (floating search, filter chips, locate-me puck, 3D tilt, zoom, big Report button with where/how-bad sheet that pre-fills the report form, slide-up details and list). Falls back to Leaflet/OSM raster tiles when WebGL or the tile service is unavailable. Tests: 56/56 API, 28/28 E2E, 9/9 map screen, 9/9 Google Maps (vector tiles from a local synthetic test town; OpenFreeMap itself not reachable from the sandbox).
14. **Night map + drive mode** (24 Oct, requested by the team, from a Waze night-mode screenshot): night "Wayguard Road" style is now the default (Night Ink/Navy land, slate streets, Road Amber highways, white route-number shields) with a day switch; drive mode (amber heading arrow, follow heading-up and tilted, km/h speed bubble, Recenter, Stop) and "Pothole ahead" alerts for open reports within 500 m ahead. Fixed marker positioning (bubbles were offset 52 px per marker on the vector map) and the hidden severity tag on the raster map. Tests: 56/56 API, 28/28 E2E, 13/13 map screen, 9/9 Google Maps.
15. **Go-live readiness** (24 Oct, requested by the team — "a full working system", not a demo): `npm run first-run` sets up a PC in one command (database user and databases, `.env`, migrations, build, demo data and/or administrator); free online hosting on Render + Neon via `render.yaml`, photos stored in PostgreSQL (`PHOTO_STORAGE=database`, migration 002), first administrator from `INITIAL_ADMIN_*` (must change password; ignored once an admin exists), Neon connection-string handling. Step-by-step guide: `docs/10-go-live.md`. Tests: 60/60 API (4 new), production start simulated incl. restart with wiped disk.
16. **Landing + single sign-in** (24 Oct, requested by the team): the landing page gains a "One sign-in for everyone" section (citizens, LGU administrators, road crews and where each lands); the single sign-in page lists the three destinations, recognises the account type after sign-in, shows a short welcome with the detected role and opens the matching workspace. Preview: demo-account buttons on the sign-in page; role switcher renamed "Quick switch". Tests: 28/28 E2E, 13/13 map, 9/9 Google, preview click-through.
17. **New look and animations** (24 Oct, requested by the team): animated road backdrop (slowly drifting roads with Road Amber lanes, floating report bubbles at the edges) on a dark Night Ink/Navy hero, the roles band and the sign-in panel; faint street-map pattern behind every page; amber lane underline under the headline; staggered rise-in of hero content; landing stats count up; scroll-reveal for the journey, roles and notes; frosted sticky header; button sheen and press, card hover lift, page entrance; road band in the footer. All motion uses compositor-friendly transforms and switches off under the system "reduce motion" setting; the reversed logo sits only on plain Night Ink. Tests: 60/60 API, 28/28 E2E, 13/13 map, 9/9 Google, 18-step preview click-through, screenshot review at 1366 px and 390 px.
18. **Deployed + sample data online** (24 Oct): code pushed to GitHub `ImPapaP/WayGuard`; the team deployed it on Render (Blueprint) with a Neon database. Larger labelled demo set (116 reports, 4 road crews, 2 demo admins, 9 demo citizens, 252 DEMO PHOTO pictures) that a hosted site loads at start-up only when `DEMO_DATA=on` (password from `SEED_DEMO_PASSWORD`), and removes with `DEMO_DATA=remove`; never blocks start-up; keeps settings an admin already saved. Tests: production start-up simulated (off / on / restart / remove / refused without the switch), 60/60 API.
19. **Multi-LGU tenancy** (26 Oct): added the `lgus` table and migration `002_multi_lgu.sql`; each account/report/team/agency/assignment/settings and audit trail is associated with an LGU; added composite foreign keys, LGU-scoped report queues/maps/stats/exports/notifications/photo access, platform-admin tenant provisioning at `/platform/lgus`, per-LGU admin/staff/maintenance roles, explicit LGU selection during citizen registration, optional map-centre setup, and an integration test for cross-LGU isolation. **The new test suite and production migration have not yet been run after this change.** Location-based boundary polygons/automatic jurisdiction matching are not part of this implementation; reports inherit the LGU selected by the citizen.

## Setup commands

```bash
cp .env.example .env            # set DATABASE_URL, TEST_DATABASE_URL, GEOCODER_EMAIL, SEED_DEMO_PASSWORD
npm install
npm run db:migrate
npm run build
npm run db:seed                 # optional demo data (or: npm run create-admin)
npm start                       # http://localhost:3000   (npm run dev for development)
npm test                        # API tests (wipes TEST_DATABASE_URL)
npm install --no-save playwright && npx playwright install chromium && npm run test:e2e
```

## Tests performed (actual results, 23 Oct 2026)

- `npm test`: 60 passed, 0 failed (4 hosting tests added 24 Oct) (50 + 6 Google Maps tests; earlier log in `docs/test-results/backend-tests.txt`).
- `npm run test:e2e`: 28 passed (24 Oct, default vector map).
- `npm run test:e2e:map`: 13 passed, 0 failed (Waze-style map screen incl. night/day and drive mode, synthetic vector tiles and emulated GPS).
- `npm run test:e2e:google`: 9 passed, 0 failed (stand-in for Google's API).
- `npm run test:e2e`: 27 passed, 0 failed, no console errors (`docs/test-results/e2e-test.txt`).
- Preview build: response shapes match the real API; 18-step click-through passes with no console errors. Both suites above re-run after the preview changes: 50/50 and 27/27.
- Screenshot review at 1366 px and 390 px; PWA offline shell; keyboard order; WCAG contrast; seed/--fresh; create-admin; dev script.
Details and defects fixed: `docs/06-test-report.md`.

## Known limitations / not verified here

- Real Google Maps was not tried: no API key and no access to Google from the build sandbox. The integration was tested against a stand-in for the Maps JavaScript API; verify once with your own restricted key (docs/08-deployment.md §8.2).
- Live OpenStreetMap tiles and live Nominatim were unreachable from the sandbox (tested with local stand-ins).
- The default vector map was only rendered against a synthetic test town (OpenFreeMap unreachable from the sandbox); check `/map` once with internet access.
- OpenFreeMap is free but has no service guarantee; for production consider a paid OpenMapTiles-compatible provider or self-hosting (docs/08-deployment.md §8.2).
- The browser-only preview artifact cannot load Google Maps or OpenFreeMap (the preview frame blocks outside map services), so it keeps the grid basemap — but it does show the new map screen, bubbles and Report flow.
- Real SMTP provider (TLS/STARTTLS) not exercised; tested with a fake SMTP server.
- `npm install` from the public registry not run here; `package-lock.json` will be generated on first install.
- Not tested on physical Android/iOS devices or on Windows/macOS.
- Offline report submission is not implemented (the app shell opens offline; data needs a connection) — allowed by brief constraint 4.
- PDF exports use Helvetica (no custom-font embedding package available).
- Rate limits and the mailer are per process (single-instance deployment assumed).
- The browser-only preview is a demonstration aid, not the product: its data lives in the page, map tiles are a plain grid, GPS is simulated, and exports are disabled.

## Exact next steps (for the student team)

1. On your computer: install Node.js 22 LTS and PostgreSQL, then `npm install` and `npm run first-run` (docs/10-go-live.md Part A). To go online: docs/10-go-live.md Part B (GitHub + Neon + Render).
2. Run `npm test` once to confirm the install (needs `wayguard_test` database).
3. Open `/map` with internet access and check the Waze-style map shows your streets. Optional: create a Google Maps browser key (docs/08-deployment.md §8.2), restrict it to your site, set `GOOGLE_MAPS_API_KEY`, and confirm `/map` shows Google Maps (or leave it empty to use OpenStreetMap). Confirm address search works (set `GEOCODER_EMAIL`).
4. Test on a phone over HTTPS (README "Testing on a phone") for GPS and camera.
5. Optional: configure SMTP to demonstrate e-mail notifications.
6. Rehearse with `docs/07-demo-checklist.md`; reseed with `npm run db:seed -- --fresh` before presenting.
7. If you add team members' names/IDs or a cover page for submission, add them to README.

## Continuation prompt

If development continues in a new session, paste this:

> You are continuing development of **Wayguard**, an IT 305 road-pothole reporting system. The complete project is in the folder I'm providing (or attached zip). Read `WAYGUARD_PROGRESS.md`, `README.md` and `docs/01-requirements-traceability.md` first; the official brief is in `assets/reference/` and the Brand Sheet and logo files are in `assets/brand-source/` and the requirements are summarised in the traceability matrix. Maps: default Waze-style MapLibre + OpenFreeMap vector map (client/src/components/{MapScreen,VectorMap,roadStyle}.jsx/js). Stack: Node.js 22 (`node:http` router in `server/src/lib/http.js`), PostgreSQL via `postgres`, zod, sharp, pdf-lib; React 19 PWA built with esbuild (`client/build.mjs`), Google Maps JavaScript API (client/src/components/GoogleMap.jsx) or Leaflet + OpenStreetMap. Status: all FR-01–FR-18 implemented; maps use Google Maps when GOOGLE_MAPS_API_KEY is set (fallback OpenStreetMap); 60 API tests, a 28-step Playwright E2E test, a 13-step map screen test and a 9-step Google Maps browser test pass. Before changing anything, run `npm run db:migrate`, `npm test` and `npm run build && npm run test:e2e` to confirm the baseline. Keep the official branding rules (`docs/09-brand-usage.md`), enforce permissions on the server, add tests for any change, and update `WAYGUARD_PROGRESS.md` and `docs/06-test-report.md` with real results. Next task: [describe what you want changed].


## 20. LGU jurisdiction boundaries (in progress, 26 Oct 2026)

- Added migration `003_lgu_jurisdiction_boundary.sql` to store each LGU's optional GeoJSON Polygon/MultiPolygon boundary.
- Platform administrators can paste official GeoJSON when creating an LGU or update/remove the boundary in LGU management.
- The report submission API rejects a citizen's new report when its coordinates fall outside that citizen account's LGU boundary. Existing LGUs without a configured boundary remain compatible and are not geographically restricted until a boundary is saved.
- Signed-in app configuration includes the user's LGU boundary. The vector map highlights the boundary in Road Amber and dims the surrounding map; the Leaflet fallback also dims outside the boundary and highlights its outline.
- Existing account management continues to scope LGU administrators to their own LGU; their staff and maintenance accounts inherit that LGU, and crew accounts must be assigned to a team from that same LGU.
- **Not yet verified:** run migrations and all API/browser tests after the latest multi-LGU and boundary changes. Boundary upload currently accepts GeoJSON text rather than a map-drawing editor. Existing report records are not automatically reassigned or validated against boundaries.
