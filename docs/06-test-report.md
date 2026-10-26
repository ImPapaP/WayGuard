# 6. Test report

Run on **23 October 2026** in the development environment: Linux, Node.js
22.22.0, PostgreSQL 16.15, Chromium 153 (Playwright 1.63). Full logs:
[`test-results/backend-tests.txt`](test-results/backend-tests.txt) and
[`test-results/e2e-test.txt`](test-results/e2e-test.txt) and
[`test-results/google-maps-e2e.txt`](test-results/google-maps-e2e.txt) and
[`test-results/map-screen-e2e.txt`](test-results/map-screen-e2e.txt) (all re-run 24 October).

| Suite | Command | Result |
| --- | --- | --- |
| API integration tests (`server/tests`) | `npm test` | **60 passed, 0 failed** (re-run 24 Oct; 4 hosting tests added) |
| End-to-end browser workflow (`tests/e2e/run.mjs`) | `npm run test:e2e` | **28 passed, 0 failed**, no browser console errors (24 Oct, on the default vector map; step 8 added) |
| Waze-style map screen (`tests/e2e/vector-map.mjs`) | `npm run test:e2e:map` | **13 passed, 0 failed** — against a local synthetic vector tile service (see 6.2c) |
| Google Maps integration (`tests/e2e/google-maps.mjs`) | `npm run test:e2e:google` | **9 passed, 0 failed** — against a local stand-in for the Maps JavaScript API (see 6.5) |
| Visual review of every main screen at 1366×860 and 390×844 | screenshot tour (see `screenshots/`) | Reviewed; issues found were fixed (below) |

## 6.1 API integration tests (50)

Each test file wipes and rebuilds `TEST_DATABASE_URL`, starts the real
application on a random port and talks to it over HTTP like the browser does.

| Area | Tests |
| --- | --- |
| Authentication and sessions (`auth.test.js`, 9) | registration validation and forced citizen role; e-mail case-insensitivity; duplicate e-mail; scrypt hash stored, never the password; identical error for wrong password and unknown e-mail; HttpOnly SameSite=Lax cookie; logout revokes the token; CSRF header and Origin checks; 401/403 for every role boundary; password change requires the current password and signs out other devices; temporary passwords must be changed; deactivated users are locked out immediately; JSON 404 and malformed JSON |
| Reports and privacy (`reports.test.js`, 11) | required fields, coordinate range, severity and hazard validation; at least one and at most five photos; non-images and corrupt JPEGs rejected; EXIF/GPS removed from stored photos; agency routing by road type; same person + same spot blocked; nearby report flagged as a high-likelihood duplicate; nearby warning without personal data; citizens see only their own reports and photos (404 for others, 401 anonymous); public map shows only verified reports and no personal fields; bbox filter; feedback rules; oversized uploads refused; large photos resized to 1600 px |
| Workflow (`workflow.test.js`, 14) | transition table; cannot skip review or assign early; review → verify with severity and agency change; crews see only their team's work; assignment with due date and instructions and team notification; progress update with before photos starts work; completion requires an after photo, cannot be approved by the crew, appears in the admin queue; return for rework then approve → resolved; citizen timeline hides internal notes and staff names; five status notifications; mark read / read all; staff see full history and repair updates, crews do not see reporter contact; feedback once; resolved is final; rejection needs a reason; duplicate rules; reopen with a note; reassignment and unassignment |
| Administration (`admin.test.js`, 11) | staff account creation with temporary password; user search/filter/pagination; role change and deactivation revoke sessions and are audit-logged; self-lockout and last-admin protection; password reset; teams and agencies (unique names); settings validation; dashboard numbers equal the database; reports table filters, search (including an SQL-injection string), sorting, map endpoint; CSV export completeness, UTF-8 BOM, formula neutralisation, no personal data; PDF exports valid and audit-logged; citizens blocked from exports |
| Integrations (`integrations.test.js`, 5) | address search via a fake Nominatim: server-side, identifying User-Agent, contact e-mail, country filter, cached; reverse geocoding and request spacing; graceful 503 when the geocoder fails; e-mail notifications delivered through a fake SMTP server with AUTH, correct subject, greeting and report link; opted-out users get in-app notifications only |

**Google Maps (`maps.test.js`, 5, plus 1 in `integrations.test.js`)**: with a
key set, `/api/public/config` gives the browser key and Map ID but never the
server-side geocoding key; the CSP allows Google's map hosts (and still the
OSM fallback) while keeping `frame-ancestors 'none'`; Google Geocoding search
and reverse lookups are parsed into road/barangay/city, sent with the server
key and `country:PH`, and cached; a rejected key gives a generic 503 without
Google's error text; without a key the config says `osm` and the CSP has no
Google hosts.

**Hosting (`hosting.test.js`, 4)**: with `PHOTO_STORAGE=database`, uploaded
photos (full size and thumbnail) are stored in `photo_files`, served with the
same access control and no files are written to disk; the first
administrator is created once from `INITIAL_ADMIN_*` with
`must_change_password` and is blocked from the admin API until the password
is changed, a second start does not create another, and a weak password is
refused; Neon connection strings lose `channel_binding` and pooled
(`-pooler`) hosts disable prepared statements.

**Production start simulation (24 Oct)**: the `render.yaml` start command
(`npm run db:migrate && npm start`) with `NODE_ENV=production`,
`PHOTO_STORAGE=database` and `INITIAL_ADMIN_*` on an empty database:
migrations applied, administrator created, `__Host-` session cookie, password
change enforced, citizen registration and a report with a photo; then the
server was stopped, its upload folder deleted (as Render does) and restarted:
the photo was still served and the administrator was not re-created. The
Render build itself (`npm install` from the public registry) and Neon were not
reachable from the build environment and were not run here.

`npm run first-run` was tested with scripted answers in a copy of the project:
it created the missing database, kept the existing one, wrote `.env`,
applied migrations and built the client.

## 6.2 End-to-end workflow (27 steps)

Real Chromium, real server, test database. Citizen and crew used a phone-sized
touch viewport (390×844), the administrator a desktop (1366×900).

1. Citizen registers.
2. Empty report shows validation messages for location, photos and severity.
3. Address search fills road and barangay.
4. GPS location captured (browser geolocation, accuracy shown and stored).
5. Photo added through the file input; description, road type, hazards, severity.
6. Report submitted; reference code shown; database stores GPS coordinates.
7. Report tracked under My reports.
8. Administrator sees it in the review queue.
9. Starts review, verifies with the responsible agency.
10. Assigns Road Crew Alpha with a due date and instructions.
11. Crew member must replace the temporary password at first sign-in.
12. Crew opens the task, sees instructions and the OpenStreetMap directions link.
13. Starts work, posts a progress update with a before photo.
14. Completion without a photo is refused; with an after photo it is submitted.
15. Administrator approves the repair; report resolved.
16. Citizen has all five status notifications.
17. Citizen sees the after photo and leaves a 5-star rating.
18. Public map shows the repaired pothole and no personal data.
19. History contains Under review → Verified → Assigned → In progress → Resolved.
20. Two nearby reports from different citizens: administrator marks one as a duplicate from the candidates panel.
21. Rejection dialog requires a reason; report rejected.
22. Administrator creates a staff account with a temporary password.
23. Administrator creates a team and an agency.
24. Settings change (LGU name, duplicate radius) appears on the public site.
25. CSV, PDF and summary PDF downloads are valid; CSV has no personal data.
26. Citizen redirected away from `/admin`; the API answers 403.
27. No browser console errors during the run.

## 6.2b Google Maps in the browser (9 steps)

Requests to `https://maps.googleapis.com/maps/api/js` are answered with
`tests/e2e/google-maps-stub.js`, a small stand-in that implements the calls
Wayguard makes and records them. Checked: the script URL carries the browser
key, `libraries=marker`, `loading=async`, `v=weekly`; the map gets the Map
ID; no Leaflet map is shown alongside; report markers use the Wayguard pin,
are clickable buttons and show selection; the footer credits Google; a
citizen sets the location by clicking the map and by dragging the pin;
GPS draws an accuracy circle of the reported radius; the crew's Directions
link opens Google Maps with the report's coordinates; when Google rejects the
key (`gm_authFailure`) or the script is blocked, maps switch to OpenStreetMap
with a notice; no unexpected console errors.

## 6.2c Waze-style map screen (13 steps)

The default map (MapLibre, WebGL through SwiftShader in headless Chromium) is
drawn from `tests/e2e/vector-fixture.mjs`, a local service that serves a
TileJSON, vector tiles of a synthetic test town in the OpenMapTiles schema and
label glyphs (Noto Sans, `tests/e2e/fixtures/glyphs`). Checked on a phone
viewport: the map fills the screen and tiles and glyphs are requested; report
bubbles are buttons and tapping one slides up its details; closing returns to
the map; search finds a report by road name; the bottom list shows every
report with the legend; "Show my location" adds the you-are-here puck and
distances; the 3D button tilts and flattens the map; the Report button
preselects GPS, offers severities and sends visitors to sign up with the
location and severity kept; with the tile service blocked the page falls back
to the raster OpenStreetMap map with a notice, bubbles and Report button; no
unexpected console errors. Added for night/drive mode: every bubble's tip
sits within 2 px of its projected map position (vector and raster maps);
the night map is the default and the day switch is remembered after reload;
drive mode with emulated GPS movement shows the heading arrow on screen, a
speed above 0 and a "Pothole ahead — High severity" alert for a report in
front; dragging pauses following, Recenter resumes it, Stop ends drive mode.
The main workflow test also starts a report from
the map (Report → Map centre → High) and checks the form is pre-filled.

## 6.3 Other checks performed

| Check | How | Result |
| --- | --- | --- |
| PWA | Service worker registered, 30 files precached, manifest with 3 icons; navigating offline loads the app shell and the offline notice | Pass |
| Keyboard | Tab order on sign-in page; visible amber focus ring on inputs, buttons and links; dialogs trap focus and close with Escape; map markers focusable; every map has a text list | Pass |
| Colour contrast | WCAG ratios computed for text/background pairs (badges, severity text, muted text, sidebar) | All ≥ 4.5:1 after darkening one grey token (was 4.43:1) |
| Chart colours | Two-series palette validated for colour-vision deficiency (dataviz validator): `#2B4F8A`/`#B87800` | Pass (brand navy `#0A2244` failed the chart lightness band, so it is not used for data marks) |
| Migrations | Run twice on the same database | Second run: "already up to date" |
| Seed | `db:seed`, then `db:seed` again (skips), then `db:seed -- --fresh` (removes 51 photos and recreates) | Pass |
| `create-admin` | Valid, weak-password and duplicate-e-mail cases | Pass, with clear messages |
| `npm run dev` | Client rebuild on change, server serving | Pass |
| HTTPS mode | `HTTPS_KEY_FILE`/`HTTPS_CERT_FILE` with a temporary self-signed certificate | Pass: served over https, session cookie `__Host-` + `Secure`, HSTS header |
| Fresh install | Packaged archive extracted to a new folder with new databases: migrate, build, seed, start, sign in, then `npm test` and `npm run test:e2e` | Pass: 50/50 and 27/27; report codes start at WG-2026-00001 |
| Browser-only preview (`npm run build:preview`) | (1) Every response shape of the in-page API stand-in compared with the real server on the same demo data (anonymous, citizen, admin, crew; 40 endpoints/views); (2) an 18-step click-through of the whole workflow across all four views in Chromium under a CSP that allows no network access | (1) Same fields and identical dashboard numbers; only differences are the preview basemap flag and audit entries from earlier exports. (2) 18/18, no console errors, no horizontal scrolling at 390 px |

## 6.4 Defects found and fixed during testing

| Found by | Defect | Fix |
| --- | --- | --- |
| API test | Duplicate likelihood too low for "Paseo del Congreso" vs "Paseo del Congreso St." 17 m apart | Ignore generic road words (St., Ave., Hwy…), quadratic distance fall-off, recalibrated thresholds |
| API test | `node --test tests/` does not accept a directory on Node 22 | Glob pattern `"tests/*.test.js"` |
| Seed run | Resolved status written before `resolved_at` violated a CHECK | Single combined UPDATE |
| Screenshot review | Page containers lost side padding on phones | `.page` sets only vertical padding |
| Screenshot review | Progress-road stops drawn under the track | Stops placed on their own stacking layer |
| Screenshot review | "Due in NaN days" — DATE values arrived as timestamps | DATE columns returned as `YYYY-MM-DD`; client parses the date part |
| Screenshot review | "Near Near the mall entrance" | Landmarks shown as "Landmark: …" |
| Screenshot review | Sticky submit bar covered form content | Normal submit area at the end of the form |
| E2E test | Address search did not work inside the report form (nested `<form>`) | Search and coordinate entry no longer use nested forms |
| E2E test | `npm run db:seed -- --fresh` did not pass `--fresh` through | Root script forwards arguments |
| Night/drive work (24 Oct) | Our marker styles overrode the map libraries' absolute positioning, so on the vector map each bubble was pushed down by the height of the bubbles before it (52 px per marker) | Markers keep `position: absolute`; new test measures every bubble against its projected position (it fails without the fix) |
| Night/drive work (24 Oct) | Leaflet's stylesheet lifts every SVG in a map to z-index 200, hiding the H/M/L tag on the raster map | Bubble layers ordered explicitly inside Leaflet maps |
| Night/drive work (24 Oct) | Drive mode stopped on the first transient "position unavailable" GPS error | Only a denied permission stops drive mode; short GPS gaps show a one-time notice |
| Live preview (reported by the team) | In a small or initially hidden frame the map fitted the reports before it had its real size, so all 14 bubbles piled up in one corner | Maps keep every report in view whenever they are resized, until the person moves the map; fitting no longer rebuilds the markers (which had swallowed a tap) |
| Map screen work (24 Oct) | A Leaflet move event could run while a map was being removed (`_leaflet_pos` error in the preview) | Move events are ignored once the map is being removed |
| Map screen work (24 Oct) | `node client/build.mjs` run from the project root wrote asset URLs as `/../client/dist/...` (blank page) | Asset URLs are resolved from the directory esbuild runs in; `npm run build` was not affected |
| Preview click-through | Leaving a map page during a zoom animation logged a Leaflet error (`_leaflet_pos`) | Map ignores Leaflet's delayed zoom-end once it has been removed; `npm test` 50/50 and E2E 27/27 re-run afterwards |
| Visual upgrade (24 Oct) | A fixed page background (`background-attachment: fixed`) made every scroll repaint the whole page; full-page screenshots timed out | Background scrolls with the page and is a single light pattern |
| Visual upgrade (24 Oct) | Animated dashed lanes (`stroke-dashoffset`) in large SVGs plus blurred glows froze the browser for ~30 s after sign-in | Roads move with a transform animation (handled by the GPU); glows are static gradients without blur |
| Visual upgrade (24 Oct) | The reversed (white) logo showed on a gradient on the sign-in panel, against the brand rule | Sign-in brand panel is plain Night Ink; hero bubbles moved to the edges and hidden on phones so they never cover text |

## 6.5 Not verified in this environment (limitations)

The development sandbox had no internet access except a code-hosting mirror,
so the following could not be tested here and should be checked once on a
normal machine (they need only `npm install` and internet):

- **Live OpenFreeMap vector tiles** — not reachable from the build
  environment, so the "Wayguard Road" style was checked against the synthetic
  test town (6.2c). Real OpenStreetMap data has many more feature types; open
  `/map` once with internet access and look over a few neighbourhoods at
  zoom 12–18. The style is one file (`client/src/components/roadStyle.js`) if
  colours or widths need adjusting.
- **Real Google Maps** — Google's servers are not reachable from the build
  environment and no API key was available, so the Google Maps code was
  tested against the stand-in described in 6.2b (which follows Google's
  documented API), not against Google itself. Check once with your own
  restricted key: open `/map`, `/app/report` (tap the map, drag the pin),
  and a crew task, and watch the browser console for Google errors
  (docs/08-deployment.md §8.2, step 6).
- **Live OpenStreetMap tiles** — tests answered tile requests with a plain
  placeholder image; the screenshots in `screenshots/` therefore show a plain
  grid instead of real streets. The tile URL and attribution are standard.
- **Live Nominatim** — tested against a local fake with the same response
  format. Real use needs `GEOCODER_EMAIL` set.
- **Real e-mail provider** — SMTP was tested against a local fake server
  (plain connection); STARTTLS/TLS against a real provider was not exercised.
- **`npm install` from the public registry** — packages were provided from
  local copies of the same versions; `package-lock.json` is created on your
  first `npm install`.
- **Physical phones** — GPS, camera capture and "install app" were tested in
  Chromium's mobile emulation, not on real Android/iOS devices. Test on a
  phone over HTTPS (see README).
- Windows and macOS installs were not tried (Linux only).
- No load/performance testing.

## 6.6 Additions on 26 Oct 2026

| Area | How it was checked | Result |
| --- | --- | --- |
| Password reset by e-mail | API test: same reply for any address, token stored hashed, one use only, expired link refused, all devices signed out | Pass |
| "I saw this too" and priority score | API test: own report refused, admins cannot confirm, counted once, raises the score, priority sort highest first, reporter notified, undo works | Pass |
| Focus on one LGU, LGU comparison, figures CSV, monthly PDF | API test: focus narrows stats, lists and downloads; an unrelated focus is ignored; comparison is platform-only | Pass |
| Platform administrator powers | API test across two LGUs (reports, workflow, stats, users, teams, settings of any LGU, activity log, exports) | Pass |
| Demo LGU linked to the official City of Malolos | Simulated a fresh Render start and an upgrade of an already-seeded database: one Malolos with all 116 demo reports | Pass |
| PSGC directory on restart | Unchanged directory is skipped (0.3 s instead of a full reload); `--force` still reloads | Pass |
| Offline reporting | Browser test: report saved with photo while offline, sent automatically on reconnect (new code issued) | Pass |
| Filipino / English | Browser check of landing, sign-in, citizen home, report form and lists in Filipino and back | Pass; translations need a native speaker's review |
| Heat map and barangay counts | Screenshots on the admin map (Leaflet fallback; vector map uses the same markers) | Pass |
| Phone widths | 360 px and 390 px: no sideways scrolling on public, sign-in and citizen pages | Pass |

Not verified here: e-mail delivery through a real SMTP service, UptimeRobot,
spoken alerts on real phones (speech engines differ by phone), and real
devices in general — see `docs/11-operations.md` §11.3 for the phone checklist.

