# 5. User manual

Wayguard works in any modern browser on a computer or phone. On a phone you
can install it: open Wayguard, then choose **Add to Home Screen** (iPhone,
Safari share menu) or **Install app** (Android, Chrome menu).

## Landing page and sign-in

The landing page (`/`) explains Wayguard, shows the latest verified potholes on a map, and has a **One sign-in for everyone** section. Everybody — citizens, LGU administrators and road crews — uses the same **Sign in** page. After you sign in, Wayguard recognises the kind of account, shows it for a moment (for example *LGU administrator account — Opening the LGU dashboard…*) and opens the right place: citizens their reports app, administrators the dashboard, road crews their repair tasks. Only citizens can create their own account; staff accounts are created by an administrator.

## 5.1 Citizens

### Create an account
1. Open Wayguard and choose **Report a pothole** or **Sign in → Create a citizen account**.
2. Enter your name, e-mail, an optional mobile number and a password (8+ characters with a letter and a number).

Your name and contact details are seen only by LGU personnel, never on the public map.

### Report a pothole
Stay safe: report from the roadside, never while driving or in traffic.

1. Tap the amber **Report** button.
2. **Where is it?** Tap **Use my current location** (allow location when the browser asks), search for an address or landmark, or tap the map. Drag the pin to the exact spot. If someone already reported a pothole nearby, Wayguard shows it so you can check whether it is the same one.
3. **Photos** — tap **Take photo** to use the camera, or **Add photo** to choose from your gallery (up to 5). Location data stored inside photos is removed.
4. **Describe it** — road or street name (often filled in for you), barangay, nearest landmark, type of road if you know it, a description, and any hazards.
5. **How severe is it?** Low, Medium or High.
6. Tap **Send report**. Keep the reference code (for example `WG-2026-00012`).

### Follow your reports
- **My reports** lists your reports. Each shows its progress along the road: Submitted → Under review → Verified → Assigned → In progress → Resolved.
- Open a report to see your photos, the repair photos, and the full history.
- **Alerts** (the bell) lists every update. A number on the bell means unread notifications. If e-mail is enabled by your LGU you also get e-mails; you can turn them off in **Profile**.
- If a report is **Rejected**, the reason is shown. If it is a **Duplicate**, you will see which report the LGU is tracking instead.

### Rate the repair
When a report is **Resolved**, open it and choose 1–5 stars, with an optional comment.

### Public map
**Map** fills the screen, like a driving app. Potholes verified by the LGU and recently repaired ones appear as report bubbles: red **H** high, amber **M** medium, blue **L** low severity; a white bubble with a check mark is repaired, and an hourglass means the repair is waiting for the LGU's check.

- **Tap a bubble** — its details slide up from the bottom. Tap **×** or press Esc to close.
- **Search** (top) — find a report by road, barangay or code; signed-in users can also search places.
- **Filter chips** — show only potholes not yet fixed, repaired ones, or one severity.
- **Locate button** — shows where you are (blue dot) and sorts the list by distance.
- **3D** — tilts the map; tap **2D** to flatten it. Two-finger drag also tilts and rotates.
- **Sun / moon** — switches between the night map (default) and the day map. Your choice is remembered on that device.
- **Car (drive mode)** — like a driving app: your position becomes an amber arrow, the map follows you heading-up and tilted, your speed shows in km/h, and a red or amber **Pothole ahead** banner appears when a reported, unfixed pothole is within about 500 m in front of you. Drag the map to look around; tap the arrow button to **recenter**. Tap **Stop** at the bottom to leave drive mode. Do not handle the phone while driving — mount it, or let a passenger use it.
- **List** — the bar at the bottom opens the list of all reports on the map, with the legend.
- **Report** (big amber button) — choose **Where I am** (GPS) or **Map centre** (move the map under the target), then tap how bad it is. The report form opens with the location and severity already filled in; add a photo and a short description.

## 5.2 LGU administrators

Sign in with the account created for you. If the account was created with a temporary password, you must choose a new one first.

### Dashboard
The queue strip shows work waiting at each stage — **To review**, **To assign**, **Being repaired**, **To check**, **Resolved**. Select any number to open the matching list. Below are the monthly trend, open reports by severity and barangay, team workload, average repair time, reporter ratings, a map of open potholes and recent activity. Pick a date range to limit the figures, or download the **Summary PDF**.

### Reviewing a report
1. **Reports** lists everything, most urgent first. Search by code, road, barangay, landmark or description; filter by status, severity, barangay, team, dates, **Possible duplicates** or **Awaiting repair check**.
2. Open a report. Check the photos, map and description. The **Possible duplicates** panel lists open reports nearby with a match rating.
3. **Start review** (the reporter is notified).
4. Then either:
   - **Verify report** — confirm the severity and choose the responsible agency;
   - **Reject** — give the reason the reporter will see (for example outside LGU jurisdiction);
   - **Mark as duplicate** — choose the report that already covers this pothole.
5. Rejected or duplicate reports can be reopened with a note.

Use **Edit details** to correct severity, agency, road type, road name, barangay or landmark; changes are recorded. **Add a note** keeps an internal note, or sends an update to the reporter when you tick "Visible to the reporter".

### Assigning repairs
On a verified report, choose a **maintenance team**, an optional due date and instructions, then **Assign repair**. You can **Reassign** active work to another team, or **Remove assignment** to send it back to Verified.

### Checking completed repairs
Reports the crew marked as finished appear under **To check** / **Awaiting repair check**. Compare the after photos with the reported damage, then **Approve and close report** (status Resolved, the reporter can rate it) or **Send back to crew** with what still needs doing.

### Map
**Map** shows all reports, including unverified ones, with filters. Select a marker and then **Open report**.

### Exports and summaries
**Exports and summaries** downloads the report list as **CSV** (Excel, Google Sheets) or **PDF** using filters, and a one-page **summary report**. The Reports page has the same CSV/PDF buttons for the current filters. Exports leave out reporter names and contact details.

### Users, teams, agencies, settings
- **Users** — add staff accounts (administrator or maintenance personnel with a team). Wayguard suggests a temporary password; give it to the person, who must change it at first sign-in. Edit roles and teams, deactivate accounts, reset passwords. You cannot remove your own administrator access or the last administrator.
- **Teams and agencies** — create maintenance teams and the agencies responsible for roads (national, provincial, city/municipal, barangay).
- **System settings** — LGU name, photos per report, how long repaired potholes stay on the public map, duplicate radius and time window, which agency each road type is routed to, and the default map position.
- **Activity log** — who changed users, settings and teams, and who exported data.

## 5.3 Road maintenance personnel

Sign in with the account created by your LGU and choose your own password the first time.

### Your tasks
**Tasks** lists the potholes assigned to your team, with severity, location, landmark, status and due date (overdue tasks are marked). **Map** shows them on a map; **History** lists finished or reassigned tasks. You are notified when a task is assigned.

### Doing a repair
1. Open a task. Check the photos, description, hazards and the LGU's instructions.
2. **Directions** opens Google Maps directions when the LGU uses Google Maps, otherwise OpenStreetMap directions. The **Map** tab shows your tasks full screen; tap a bubble, then **Open task** or **Directions**; **Open in maps app** opens your phone's map app at the location.
3. Tap **Start work** when the crew begins (the reporter is notified).
4. **Progress update** — write a short note and add **Before repair** or **Work in progress** photos.
5. When finished, choose **Repair finished**, add at least one **after** photo and repair notes, and tap **Submit repair for verification**.
6. The task shows **Waiting for LGU verification**. If the LGU sends it back, you are notified with the reason and can submit again.
