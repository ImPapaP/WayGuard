# 4. API reference

Base path `/api`. JSON in and out (multipart for uploads). Authentication is
the session cookie set by `/api/auth/login` or `/api/auth/register`.

**Every** `POST`, `PUT`, `PATCH` and `DELETE` must include the header
`X-Wayguard-CSRF: 1`. Errors have the form:

```json
{ "error": { "code": "validation_error", "message": "Please check the highlighted fields.", "fields": { "email": "Enter a valid e-mail address." } } }
```

Common codes: `validation_error` / `bad_request` (400), `unauthorized` (401),
`forbidden`, `csrf`, `password_change_required` (403), `not_found` (404),
`conflict`, `invalid_transition` (409), `too_large` (413), `rate_limited`
(429), `geocoder_unavailable` (503). List endpoints accept `page` and
`pageSize` and return `{ items, total, page, pageSize }`.

## Public (no sign-in)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | Server and database check |
| GET | `/api/public/config` | Active LGU list, current/selected LGU name, map centre, tile URL and attribution, photo limits, geocoder availability |
| GET | `/api/public/reports` | Verified/assigned/in-progress and recently resolved reports, public fields only. Filters: `status`, `severity`, `bbox=minLng,minLat,maxLng,maxLat` |
| GET | `/api/public/stats` | Total reported, resolved, average days to resolve |

## Platform administration

Only a `platform_admin` may call these endpoints. Bootstrap the first platform account with `npm run create-platform-admin`; then use the platform workspace at `/platform/lgus`.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/platform/lgus` | List LGUs, active staff counts, report counts and their initial administrator |
| POST | `/api/platform/lgus` | Create an LGU and its first administrator; body: `name, city, province, slug?, map_latitude?, map_longitude?, admin_name, admin_email, admin_phone?, temporary_password` |
| PATCH | `/api/platform/lgus/:id` | Activate/deactivate an LGU; deactivation revokes tenant sessions |

## Account

| Method | Path | Who | Body / notes |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | anyone | `full_name, email, phone?, password, lgu_id` → citizen account attached to an active LGU |
| POST | `/api/auth/login` | anyone | `email, password` |
| POST | `/api/auth/logout` | anyone | |
| GET | `/api/auth/me` | anyone | `{ user }` or `{ user: null }` |
| PATCH | `/api/auth/profile` | signed in | `full_name?, phone?, email_notifications?` |
| POST | `/api/auth/change-password` | signed in | `current_password, new_password`; signs out other sessions |

Passwords: 8–128 characters with at least one letter and one number.

## Citizen reports

| Method | Path | Who | Notes |
| --- | --- | --- | --- |
| POST | `/api/reports` | citizen | multipart: `description, road_name, barangay?, city?, landmark?, road_type?, hazards (comma list), severity, latitude, longitude, location_source (gps/map/address), location_accuracy_m?, photos[1..max]`. 409 if the same person reported within 25 m in the last 24 h. Returns `{ report: {id, code, status}, possible_duplicates }` |
| GET | `/api/reports/mine` | citizen | own reports; `status` filter (comma list); includes `counts` per status |
| GET | `/api/reports/nearby?lat&lng&radius?` | signed in | open reports nearby (code, status, severity, road, distance) — no personal data |
| GET | `/api/reports/:id` | owner citizen, admin, crew of an assigned team | role-shaped detail: citizens get public history only; staff get repair updates and all history; admins also get reporter contact, duplicate candidates and linked duplicates |
| POST | `/api/reports/:id/feedback` | reporting citizen | `rating 1–5, comment?`; only when resolved; once |
| GET | `/api/photos/:id[?size=thumb]` | anyone allowed to see the report | JPEG; `Cache-Control: private` |

## Notifications

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/notifications?unread=true` | own notifications, newest first, with `unread` count |
| GET | `/api/notifications/unread-count` | |
| POST | `/api/notifications/:id/read` | |
| POST | `/api/notifications/read-all` | |

## Address search (signed in)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/geo/search?q=` | ≥3 characters; up to 6 results with coordinates, road, barangay, city |
| GET | `/api/geo/reverse?lat&lng` | road, barangay and city suggestion for a point |

## Administrator

| Method | Path | Body / notes |
| --- | --- | --- |
| GET | `/api/admin/reports` | filters: `q`, `status` (comma list), `severity`, `barangay`, `team_id`, `agency_id`, `from`, `to` (YYYY-MM-DD), `has_duplicates=true`, `awaiting_completion=true`; `sort` = `priority` (default), `newest`, `oldest`, `severity`, `updated`. Rows include `possible_duplicates`, `team_name`, `photo_count` |
| GET | `/api/admin/map` | same filters, all matching reports for the map |
| GET | `/api/admin/barangays` | barangays with report counts |
| POST | `/api/admin/reports/:id/review` | `note?` (required when reopening a rejected/duplicate report) → Under Review |
| POST | `/api/admin/reports/:id/verify` | `severity?, agency_id?, note?` → Verified |
| POST | `/api/admin/reports/:id/reject` | `reason` (shown to the reporter) → Rejected |
| POST | `/api/admin/reports/:id/duplicate` | `duplicate_of_id, note?` → Duplicate |
| POST | `/api/admin/reports/:id/assign` | `team_id, due_date?, instructions?` → Assigned (also reassigns active work) |
| POST | `/api/admin/reports/:id/unassign` | `note?` → back to Verified |
| POST | `/api/admin/reports/:id/approve-completion` | `note?` → Resolved (requires crew completion and an after photo) |
| POST | `/api/admin/reports/:id/return-completion` | `reason` → stays In Progress, crew notified |
| PATCH | `/api/admin/reports/:id` | `severity, agency_id, road_type, road_name, barangay, landmark` (open reports only; recorded in history) |
| POST | `/api/admin/reports/:id/notes` | `message, is_public` (public notes notify the reporter) |
| GET | `/api/admin/stats?from&to` | dashboard statistics (see below) |
| GET/POST | `/api/admin/users` | LGU admin only: tenant-scoped list (`q`, `role`, `status`) / create `citizen, admin, staff,` or `maintenance` account: `full_name, email, phone?, role, team_id?, temporary_password` |
| PATCH | `/api/admin/users/:id` | `full_name, phone, role, team_id, is_active` (cannot remove own admin access or the last admin) |
| POST | `/api/admin/users/:id/reset-password` | `temporary_password` |
| GET/POST/PATCH | `/api/admin/teams[/:id]` | `name, agency_id?, description?, is_active?` |
| GET/POST/PATCH | `/api/admin/agencies[/:id]` | `name, jurisdiction, contact_email?, contact_phone?, is_active?` |
| GET/PUT | `/api/admin/settings` | `lgu_name, duplicate_radius_m, duplicate_window_days, max_photos_per_report, map_center{lat,lng,zoom}, road_type_agency{road_type: agency_id}, public_resolved_days` |
| GET | `/api/admin/audit` | administrative activity log |
| GET | `/api/admin/exports/reports.csv` | same filters as the reports list, up to 10,000 rows |
| GET | `/api/admin/exports/reports.pdf` | same filters, up to 2,000 rows, A4 landscape |
| GET | `/api/admin/exports/summary.pdf?from&to` | one-page statistics summary |

## Maintenance personnel

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/maintenance/tasks?scope=active\|history` | the team's tasks, with counts |
| POST | `/api/maintenance/tasks/:id/start` | Assigned → In Progress |
| POST | `/api/maintenance/tasks/:id/updates` | multipart: `note, photo_kind (before/progress), photos[0..6]`; starts work if still Assigned |
| POST | `/api/maintenance/tasks/:id/complete` | multipart: `note, photos[1..6]` (after photos) → awaiting LGU verification |

## Dashboard metric definitions (`/api/admin/stats`)

All counts are computed live from `reports`, optionally limited to reports
created between `from` and `to`.

| Metric | Definition |
| --- | --- |
| `total` | number of reports |
| `pending_review` | status Submitted or Under Review |
| `awaiting_assignment` | status Verified |
| `active_repairs` | status Assigned or In Progress |
| `awaiting_verification` | In Progress with `work_completed_at` set (crew finished, LGU not yet checked) |
| `resolved` | status Resolved |
| `closed_invalid` | status Rejected or Duplicate |
| `high_open_over_7_days` | open, high severity, created more than 7 days ago |
| `avg_resolution_days` | mean of `resolved_at − created_at` in days, resolved reports only |
| `by_status`, `by_severity` | counts per status; per severity: total and open |
| `monthly` | last 6 calendar months (`APP_TIMEZONE`): reports created and reports resolved in each month |
| `top_barangays` | open reports per barangay, top 8 |
| `teams` | per active team: active assignments, assignments completed |
| `feedback` | number of ratings and average rating |
