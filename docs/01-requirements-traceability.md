# 1. Requirements traceability

Source of requirements: *IT 305 – Project 2* brief (Bulacan State University,
CICT). Each official requirement is mapped to where it is implemented and how
it was tested. Test names refer to `server/tests/*.test.js` (API integration
tests, prefixed **API**) and `tests/e2e/run.mjs` (browser workflow test,
prefixed **E2E**). Results: [06-test-report.md](06-test-report.md).

Status key: **Done** = implemented and covered by an automated test that
passed · **Done (manual)** = implemented and checked by screenshots/manual
run · **Partly verified** = implemented, but part of it could not be exercised
in the development environment (explained in the row).

## 1.1 Functional requirements (brief §4)

| ID | Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- | --- |
| FR-01 | User registration and login | `routes/auth.js` (register, login, logout, profile, change password), `services/sessions.js`, scrypt hashing in `lib/security.js`; UI `pages/public/Login.jsx`, `Register.jsx`, `pages/shared/Profile.jsx` | API: *registration validates input and always creates a citizen*, *login rejects wrong passwords…*, *session cookie is HttpOnly…*, *changing password…*, *deactivated users…*; E2E: *registers a citizen account*, *must replace the temporary password on first sign-in* | Done |
| FR-02 | Pothole reporting from browser or mobile device | `POST /api/reports` (`routes/reports.js`); responsive PWA form `pages/citizen/NewReport.jsx` | API: *a valid report is stored…*; E2E (phone viewport): *submits the report and gets a reference code* | Done |
| FR-03 | Photo upload (one or more images) | Multipart upload, 1–5 photos (configurable), type sniffing + full decode + re-encode with metadata removal (`services/photos.js`); camera capture and gallery picker with in-browser compression (`components/Photos.jsx`, `lib/image.js`) | API: *a report needs … a photo*, *non-image files are rejected…*, *…photos (metadata stripped)*, *oversized uploads are refused*, *large camera photos are resized*; E2E: *adds a photo…* | Done |
| FR-04 | GPS location when permission is granted | `navigator.geolocation` requested only on button press, accuracy stored, clear messages for denied/unavailable/insecure (`components/LocationPicker.jsx`) | E2E: *captures the location with GPS* (location stored with `location_source = gps`) | Done (real phone GPS hardware not tested, see test report) |
| FR-05 | Manual location: pin on a map or enter an address | Click/drag pin on the map (Google Maps, or Leaflet/OpenStreetMap); address search through the server-side proxy (Nominatim, or Google Geocoding) (`routes/geo.js`, `services/geocoder.js`); typed coordinates as a further fallback | API (fake Nominatim): *address search goes through the server…*, *reverse geocoding fills road and barangay…*, *geocoder failures degrade gracefully*; E2E: *finds a place by address and fills in the road details* | Done (live Nominatim not reachable from the dev sandbox) |
| FR-06 | Description, road name, landmarks, hazards | Fields `description`, `road_name`, `barangay`, `city`, `landmark`, `hazards[]`, `road_type` with validation | API: *a report needs a description, road…*; E2E: *adds a photo and describes the pothole* | Done |
| FR-07 | Severity classification (low/medium/high) | `reported_severity` (citizen) and `severity` (confirmed/adjusted by admin, change recorded in history) | API: *admin reviews and verifies, adjusting severity…* | Done |
| FR-08 | Report management: view, search, filter, verify, manage | `GET /api/admin/reports` (search, status/severity/barangay/team/date filters, duplicate and awaiting-check filters, sorting, pagination); review screen `pages/admin/ReportReview.jsx`; edit details; notes | API: *reports table filters, searches and sorts* (incl. SQL-injection attempt), workflow tests; E2E: *signs in and sees the new report…*, *starts the review and verifies…* | Done |
| FR-09 | Status tracking | Status on report, badge everywhere, "progress road" component, `/app/reports` list | API: *the citizen sees a public timeline…*; E2E: *tracks the report…* | Done |
| FR-10 | Assignment management | `POST /api/admin/reports/:id/assign` (team, due date, instructions), reassign, unassign; one active assignment per report (unique index) | API: *admin assigns a verified report to a team…*, *reassignment moves the task…*; E2E: *assigns the repair…* | Done |
| FR-11 | Notifications when statuses change | In-app notifications written in the same transaction as every change (`services/notifications.js`), bell/badge polling, notification centre; optional e-mail via SMTP outbox (`services/mailer.js`, `services/smtp.js`) | API: *the citizen sees … status notifications*, *status notifications are e-mailed through SMTP when configured* (fake SMTP server), *users who opt out…*; E2E: *receives the status notifications* | Done (e-mail against a real provider not tested) |
| FR-12 | Interactive map of reports | Public map (verified reports only) `pages/public/PublicMap.jsx`; admin map (all, filterable) `pages/admin/AdminMap.jsx`; crew task map; markers encode severity by letter and colour and repaired state by a check mark; default Waze-style full-screen map screen on the free OpenStreetMap vector map (`components/MapScreen.jsx`, `VectorMap.jsx`), Google Maps when `GOOGLE_MAPS_API_KEY` is set (`components/GoogleMap.jsx`), raster OpenStreetMap as automatic fallback | API: *the public map only shows verified reports…*, Google Maps config/CSP tests; E2E: *finds the repaired pothole on the public map…*; map screen browser test (9 steps), Google Maps browser test (9 steps); screenshots | Done (OpenFreeMap, real Google Maps and live OSM tiles not reachable from the sandbox; all were simulated in tests) |
| FR-13 | Repair documentation (notes, completion photos) | Progress updates with before/progress photos, completion with required after photos (`routes/maintenance.js`, `pages/crew/TaskDetail.jsx`) | API: *crew posts a progress update…*, *completion requires an after photo…*; E2E: *starts work and posts a progress update…*, *submits the finished repair…* | Done |
| FR-14 | Dashboard and analytics | `GET /api/admin/stats` (`services/stats.js`): totals, work queues, by status/severity, monthly trend, barangays, team workload, average resolution time, feedback; `pages/admin/Dashboard.jsx` | API: *dashboard statistics match the database* | Done |
| FR-15 | Report history | `report_events` table: every creation, status change, assignment, repair update, note, feedback with time and actor; public vs staff-only events | API: *the citizen sees a public timeline…*, *staff see the full history…*; E2E: *history records every step of the workflow* | Done |
| FR-16 | Duplicate detection (proximity, location, details) | Haversine distance in SQL (`wg_distance_m`), configurable radius/time window, score from distance + road name + barangay + time; warning on the report form; flag and filter in admin table; duplicate candidates panel; same person/same spot block | API: *the same person cannot report the same spot twice…*, *another citizen reporting nearby is flagged…*, *the nearby endpoint warns…*, *rejection needs a reason; duplicates link to an original…* | Done |
| FR-17 | Feedback on completed repairs | 1–5 stars + comment, once, reporter only, only when resolved | API: *feedback is only accepted from the reporter after resolution*, *reporter can leave feedback exactly once*; E2E: *sees the after photo and rates the repair* | Done |
| FR-18 | Export reports (CSV or PDF) | `GET /api/admin/exports/reports.csv`, `reports.pdf`, `summary.pdf` with filters; formula-injection protection; no reporter personal data; audit-logged | API: *CSV export is complete, excludes personal data and neutralises formulas*, *PDF exports are produced and audited* | Done |

## 1.2 Roles (brief §3)

| Role ability | Where | Status |
| --- | --- | --- |
| Citizen: register and log in | FR-01 | Done |
| Citizen: submit reports with photos and location | FR-02–FR-07 | Done |
| Citizen: view submitted reports and status | `/app/reports`, `/app/reports/:id` | Done |
| Citizen: receive notifications | FR-11 | Done |
| Citizen: view public reports on a map | `/map`, `/app/map` | Done |
| Admin: dashboard | `/admin` | Done |
| Admin: review, verify, reject, flag reports | Review screen | Done |
| Admin: assign verified reports | FR-10 | Done |
| Admin: update report statuses | Workflow actions (only valid transitions) | Done |
| Admin: manage user accounts and system settings | `/admin/users`, `/admin/teams`, `/admin/settings` | Done (API tests: users, teams/agencies, settings) |
| Admin: generate summary reports and statistics | Dashboard, `/admin/exports`, summary PDF | Done |
| Crew: view assigned reports | `/crew` | Done |
| Crew: check location and severity | Task screen with map, directions link, severity, hazards | Done |
| Crew: update repair progress | FR-13 | Done |
| Crew: upload before-and-after photos | FR-13 | Done |
| Crew: mark repair completed for administrative verification | Completion → "Awaiting check" queue → admin approves or returns | Done |

## 1.3 Workflow and statuses (brief §5)

All eight recommended statuses are used: Submitted, Under Review, Verified,
Assigned, In Progress, Resolved, Rejected, Duplicate. Allowed transitions are
enforced on the server (`services/workflow.js`, `TRANSITIONS`):

| From | To | Who |
| --- | --- | --- |
| Submitted | Under Review, Rejected, Duplicate | Administrator |
| Under Review | Verified, Rejected, Duplicate | Administrator |
| Verified | Assigned (by assigning a team), Rejected, Duplicate | Administrator |
| Verified | Under Review (sent back for another review, with a note; API only) | Administrator |
| Assigned | In Progress | Assigned crew or administrator |
| Assigned | Verified (assignment removed) | Administrator |
| Assigned / In Progress | Assigned (reassigned to another team) | Administrator |
| In Progress | Resolved — only after the crew submitted completion with after photos | Administrator |
| Rejected, Duplicate | Under Review (reopen, with a note) | Administrator |
| Resolved | — (final) | — |

"Repair completed, awaiting LGU verification" is recorded with
`work_completed_at` while the status stays *In Progress*; this keeps exactly
the eight recommended statuses while supporting step 5–6 of the workflow.
Tested by API *transition table matches the documented workflow*, *reports
cannot skip review…*, *resolved reports are final*.

## 1.4 User-interface requirements (brief §7)

| Screen | Implementation |
| --- | --- |
| A. Citizen: home screen and report button | `CitizenHome.jsx`, amber Report button in the bottom tab bar |
| A. Reporting form; camera/upload; GPS and map selector | `NewReport.jsx`, `Photos.jsx` (`capture="environment"`), `LocationPicker.jsx` |
| A. My Reports; details and status timeline | `MyReports.jsx`, `ReportDetail.jsx` (progress road + history) |
| A. Notifications and feedback | `Notifications.jsx`, feedback form on resolved reports |
| B. Admin: totals and pending; by status and severity | `Dashboard.jsx` work queues and charts |
| B. Interactive map; searchable table | `AdminMap.jsx`, `AdminReports.jsx` |
| B. Verification and assignment controls | `ReportReview.jsx` |
| B. User management; statistics and export tools | `Users.jsx`, `Teams.jsx`, `Settings.jsx`, `Exports.jsx` |
| C. Crew: assigned tasks; location and description; navigation/map link | `Tasks.jsx`, `TaskDetail.jsx` (OpenStreetMap directions, `geo:` link for the phone's maps app) |
| C. Progress updates; before/after photos; completion | `TaskDetail.jsx` |

## 1.5 Constraints and assumptions (brief §8)

| # | Constraint | How it is handled |
| --- | --- | --- |
| 1 | GPS depends on hardware, permission and signal | GPS is optional; denial, timeout, unavailable and non-https cases each show an explanation and point to the map pin |
| 2 | Manual location when GPS unavailable | Map pin (click/drag), address search, typed coordinates |
| 3 | LGUs must have authorized personnel and separate workspaces | Platform administrator provisions each LGU and its first administrator; LGU admins create tenant-scoped staff and maintenance accounts; backend and database enforce tenant isolation |
| 4 | Internet needed unless offline is implemented | The installed PWA opens offline (cached app shell) and shows an offline notice; submitting and loading reports need a connection (offline submission is **not** implemented) |
| 5 | Identify the agency responsible for each road | Road type on each report, agencies table, automatic routing by road type (settings), agency confirmed/changed during verification, rejection reason for out-of-jurisdiction reports |
| 6 | Public reports must not expose unnecessary personal data | Public API returns only verified reports and non-personal fields; photos and reporter identity are never public; exports omit reporter details; EXIF/GPS removed from photos |
| 7 | Reports are not verified just because they were submitted | Every report starts as Submitted and must be reviewed and verified by an administrator before it is public or can be assigned |

## 1.6 Technical stack (brief §6)

The brief lists one practical stack and allows equivalents. Used here:
React SPA + PWA (web framework and mobile interface), Node.js back end,
PostgreSQL with secure (access-controlled, non-public) image storage, Leaflet
with OpenStreetMap tiles, and in-app plus e-mail notifications. Express was
replaced by a small router on Node's built-in `http` module because the
development environment could not download packages from npm; see
[02-architecture.md](02-architecture.md#decisions-and-assumptions).

## 1.7 Additions beyond the brief (recommended enhancements)

Not required by the brief; added because they support the stated objectives:
role-specific dashboards and queues, duplicate scoring and same-person repeat
block, forced change of temporary passwords, audit log of administrative
actions, sliding sessions with server-side revocation, rate limiting, CSRF
protection, client-side photo compression, installable PWA with offline
shell, OpenStreetMap directions link for crews, configurable settings (LGU
name, duplicate radius/window, photo limit, map centre, public retention of
resolved reports), clearly-labelled demo data generator.
