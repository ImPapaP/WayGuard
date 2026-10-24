# 7. Demonstration checklist

A 10–15 minute walk-through that shows every requirement. Use three browser
windows (or one normal + two private windows): **Citizen** (phone-sized, use
the browser's device toolbar), **Admin** (desktop), **Crew** (phone-sized).

## Before the demo

- [ ] PostgreSQL running; `npm run db:migrate`
- [ ] `npm run db:seed -- --fresh` (fresh demo data; note the password in `.env`)
- [ ] `npm run build && npm start`; open <http://localhost:3000>
- [ ] Internet connection available (map tiles, address search)
- [ ] A pothole photo (or any photo) on the presenting computer/phone
- [ ] Optional for GPS on a real phone: HTTPS set up (README)
- [ ] Optional for e-mail: SMTP settings in `.env`

## Script

| # | Window | Action | Shows |
| --- | --- | --- | --- |
| 1 | Public | Open `/`: hero with live map, "What happens after you report", footer logo | Branding, public map, process |
| 2 | Public | Open **Pothole map**, filter "Repaired", select a marker | FR-12, privacy (no names/photos) |
| 3 | Citizen | **Create a citizen account** | FR-01 |
| 4 | Citizen | **Report**: try **Send report** empty (validation), **Use my current location** (or search an address / tap map), note the "already reported nearby" warning if near a demo pothole, add a photo, describe, choose severity, send | FR-02–FR-07, FR-16 |
| 5 | Citizen | **Track this report**: progress road and history | FR-09, FR-15 |
| 6 | Admin | Sign in `admin@demo.wayguard.test`: dashboard queues, charts, open potholes, recent activity, date filter | FR-14 |
| 7 | Admin | **Reports**: search, filter "Possible duplicates", sort; open the new report | FR-08, FR-16 |
| 8 | Admin | **Start review** → **Verify** (severity, agency) → **Assign** to Road Crew Alpha with due date | FR-08, FR-10, constraint 5 |
| 9 | Citizen | Bell shows unread notifications | FR-11 |
| 10 | Crew | Sign in `crew.alpha@demo.wayguard.test`: tasks, open the new one, **Directions**, **Start work**, progress update with a before photo, **Repair finished** with an after photo | FR-13, crew UI |
| 11 | Admin | Dashboard **To check** → open → compare photos → **Approve and close report** (optionally first **Send back to crew**) | Workflow steps 5–6 |
| 12 | Citizen | Open the report: Resolved, after photos, **rate the repair** | FR-17 |
| 13 | Admin | Open a report with "nearby" flag → **Mark as duplicate**; another → **Reject** with a reason | FR-08, FR-16 |
| 14 | Admin | **Exports and summaries**: CSV, PDF, summary PDF | FR-18, statistics |
| 15 | Admin | **Users** (add staff, temporary password), **Teams and agencies**, **System settings**, **Activity log** | User management, settings, audit |
| 16 | Any | Phone: install the app (Add to Home Screen); turn on airplane mode → app opens with offline notice | Mobile/PWA |
| 17 | Citizen | Try to open `/admin` → redirected (server also refuses: 403) | Role-based access |

## Points to mention

- Statuses: Submitted → Under Review → Verified → Assigned → In Progress → Resolved, plus Rejected and Duplicate; transitions enforced on the server.
- Reports are never public until an administrator verifies them.
- Photos have location metadata removed; the public map and exports never show reporter details.
- Map data © OpenStreetMap contributors; address search through Nominatim with caching and 1 request/second.
- Demo records are tagged "Demo" and demo photos are labelled illustrations.
