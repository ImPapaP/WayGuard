# 10. Go live — run the real Wayguard

The live preview link is only a demo that runs inside your browser with sample
data, so it cannot load real map data and nothing is saved. The real
Wayguard (the code in this folder) is a full system — accounts, PostgreSQL
database, photo uploads, notifications, and the Waze-style map with real
Philippine streets. It only needs to run somewhere with internet:

- **Part A — on your computer**: good for building, testing and presenting
  from your laptop. Works offline except for the map.
- **Part B — online**: anyone opens a web address on their phone, with real
  GPS and drive mode. Free, using **Render** (runs the app) and **Neon**
  (keeps the database).

Do Part A first; it proves everything works before you put it online.

---

## Part A — On your computer (Windows, about 20 minutes)

1. **Install Node.js 22 LTS** from <https://nodejs.org> (the "LTS" button).
   Keep the default options.
2. **Install PostgreSQL 16 or 17** from
   <https://www.postgresql.org/download/windows/> (EDB installer). When it asks
   for a password for the **postgres** user, choose one and **write it down**.
   Keep port **5432**. You can skip "Stack Builder" at the end.
3. **Unzip** `wayguard-project.zip`, e.g. to `C:\wayguard`.
4. Open **Windows PowerShell** in that folder: in File Explorer open the
   `wayguard` folder, click the address bar, type `powershell`, press Enter.
5. Install the packages (needs internet, takes a few minutes):

   ```powershell
   npm install
   ```

6. Run the one-time setup and answer its questions:

   ```powershell
   npm run first-run
   ```

   It asks for the postgres password from step 2, a contact e-mail (needed by
   the free address search), whether to load the **demo data** (116 sample
   reports; say **y** for practice/presentations), and whether to create your
   own administrator account.
7. Start Wayguard:

   ```powershell
   npm start
   ```

   Open <http://localhost:3000>. The map shows real streets. To stop, press
   `Ctrl + C` in PowerShell; next time only `npm start` is needed.

**Phones on the same Wi-Fi** can open `http://<your-PC-IP>:3000`, but phones
only allow GPS and drive mode on `https://` addresses — use Part B (or see
README "Testing on a phone").

If something fails, the message says what to fix; you can run
`npm run first-run` again safely.

---

## Part B — Online for free (Render + Neon, about 30 minutes)

You need three free accounts: **GitHub** (stores the code), **Neon** (the
database) and **Render** (runs the app; you already have it). No credit card
is needed for any of them.

### B1. Put the code on GitHub

1. Create an account at <https://github.com/signup>.
2. Install **GitHub Desktop** from <https://desktop.github.com> and sign in.
3. In GitHub Desktop: **File → Add local repository…** → choose your
   `wayguard` folder → it says it is not a repository → click **create a
   repository** → **Create repository**.
4. Click **Publish repository**. Keep **"Keep this code private"** ticked.
   (Your `.env` file with passwords is excluded automatically by
   `.gitignore` — check it is not in the list of files.)

### B2. Create the database on Neon

1. Sign up at <https://neon.tech> (you can use your GitHub account).
2. **Create project** → name `wayguard` → PostgreSQL **17** → region
   **AWS Asia Pacific (Singapore)** → Create.
3. On the project dashboard click **Connect**. Make sure **Connection
   pooling** is **off**, then copy the connection string. It looks like
   `postgresql://neondb_owner:...@ep-....ap-southeast-1.aws.neon.tech/neondb?sslmode=require`.
   Keep it secret — it contains the database password.

### B3. Deploy on Render

1. In Render: **New + → Blueprint** → connect your GitHub account → pick the
   `wayguard` repository. Render reads `render.yaml` and shows one web service
   called **wayguard** (free, Singapore).
2. Fill in the values it asks for:

   | Setting | What to put |
   | --- | --- |
   | `DATABASE_URL` | the Neon connection string from B2 |
   | `GEOCODER_EMAIL` | a real e-mail of your team (OpenStreetMap's address search requires it) |
   | `INITIAL_ADMIN_EMAIL` | the e-mail you will sign in with as the LGU administrator |
   | `INITIAL_ADMIN_NAME` | your name |
   | `INITIAL_ADMIN_PASSWORD` | a temporary password, at least 8 characters with letters and numbers |

3. Click **Apply**. The first build takes about 5–10 minutes. When the log
   shows `Wayguard is running`, open the address at the top of the page
   (like `https://wayguard-xxxx.onrender.com`).
4. **Sign in** with `INITIAL_ADMIN_EMAIL` and the temporary password.
   Wayguard makes you choose a new password straight away.
5. In Render → your service → **Environment**, **delete
   `INITIAL_ADMIN_PASSWORD`** and save (the account stays; the variable is no
   longer needed).
6. As administrator: **System settings** — set your LGU name and default map
   position; **Teams and agencies** — add your road crews and offices;
   **Users** — create staff accounts. Citizens register themselves.

### Adding multiple LGUs

The service start command applies the database migrations and synchronizes the official Philippine Standard Geographic Code (PSGC) hierarchy before starting the web app. The sync is safe to repeat and matches existing LGU rows where possible so user accounts, reports and history keep their original database IDs.

The bundled geographic snapshot is derived from the Philippine Statistics Authority's [PSGC publication](https://psa.gov.ph/classification/psgc), dated 30 June 2026 (Q2 2026), and checked against the [Q3 2026 release](https://psa.gov.ph/classification/psgc/node/1684084314), dated 30 September 2026. The Q3 release's recorded change affects a barangay name; the regions, provinces, cities and municipalities used by this hierarchy were unchanged. Island groups (Luzon, Visayas and Mindanao) are grouping nodes in WayGuard rather than official PSGC administrative levels. To synchronize the bundled snapshot manually against your configured database, run `npm run psgc:sync`.

After the first deployment, create a separate platform administrator once. In a terminal or Render Shell connected to the **same production database**, run:

```bash
npm run create-platform-admin
```

Choose a unique platform-admin e-mail and a strong password. Do not use the ordinary `create-admin` command for this step; that creates an administrator inside a local LGU. Sign in using the platform administrator and open `/platform/lgus` to see the full hierarchy:

`Island Group → Region → Province / Independent City → Municipality / Component City`

Use the tree to review jurisdiction placement and active status. Then open `/platform/accounts`. The **Create an area administrator** form lets you select an area through cascading island-group, region, province/city and locality selectors. Creating the account attaches it to that PSGC node and records the assignment in the audit history. The administrator receives access to the selected node and all descendants (for example, a province administrator can manage its municipalities and component cities, but not a neighbouring province). You can also edit an existing administrator's assigned areas on that page; changed permissions revoke existing sessions. New area administrators must change their temporary password on first sign-in.

Local LGU administrators can continue to create staff and maintenance crew accounts for their own locality. Citizen registration offers local city/municipality destinations, rather than island groups or regions. Reports currently belong to the locality selected when a citizen registers. Automatic GPS-to-jurisdiction matching or a hard geographic boundary check on report coordinates is not included in this change.

Open the address on a phone (Chrome or Safari): GPS, the camera and drive
mode work because the site is `https://`. Use **Add to Home screen** to
install it like an app.

### What the free plans mean

- **Render free** stops the app after 15 minutes without visitors; the next
  visitor waits about a minute while it starts again. Upgrading to a paid
  instance removes this. Render's own disk is wiped on every restart, so
  Wayguard keeps **photos inside the database** (`PHOTO_STORAGE=database` in
  `render.yaml`).
- **Neon free** is permanent with 1 GB of storage — roughly a few thousand
  reports with photos — and pauses the database when unused (it wakes in a
  second).
- The **map** (OpenFreeMap, free, no key) and **address search** (OpenStreetMap
  Nominatim, free) need no accounts. For heavy real-world use see
  `docs/08-deployment.md` §8.2.
- **E-mail notifications** are optional: add `SMTP_HOST`, `SMTP_PORT`,
  `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` in Render → Environment
  (see `.env.example`). In-app notifications always work.

### Updating later

Change the code, then in GitHub Desktop **Commit** and **Push**. Render
rebuilds and redeploys automatically; the database and photos are kept.

### Sample data online (for a class demonstration)

Production mode loads no demo data unless you switch it on. To fill the live
site with the labelled sample data (116 reports around Malolos in every stage,
4 road crews, 15 demo accounts, illustrated "DEMO PHOTO" pictures):

1. Render → your service → **Environment** → add
   - `DEMO_DATA` = `on`
   - `SEED_DEMO_PASSWORD` = a password for all demo accounts (10+ characters
     with letters and numbers). Choose your own; anyone who knows it can sign
     in as the demo administrator.
2. **Save, rebuild, and deploy**. The log shows `Demo data loaded` and the
   list of demo accounts (all `@demo.wayguard.test`, e.g.
   `admin@demo.wayguard.test`, `crew.alpha@demo.wayguard.test`,
   `maria@demo.wayguard.test`).

It loads once; restarts keep it. Settings your administrator already saved are
kept. **Before real use**, set `DEMO_DATA` = `remove` and deploy: every demo
account, demo report and demo photo is deleted (real accounts and reports are
untouched). Then delete `DEMO_DATA` and `SEED_DEMO_PASSWORD`.
