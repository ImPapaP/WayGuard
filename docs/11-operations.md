# 11. Running the live site: uptime, e-mail and phone testing

These steps need your own accounts, so they are done by the team, not in code.
Each takes 5–15 minutes.

---

## 11.1 Keep the free Render site awake (UptimeRobot)

Render's free web service sleeps after 15 minutes without visitors; the next
visit then waits about a minute. A free monitor that opens the site every
5 minutes keeps it awake and e-mails you if it goes down.

1. Sign up at <https://uptimerobot.com> (free plan: up to 50 monitors,
   checked every 5 minutes).
2. **Add New Monitor**:
   - Monitor type: **HTTP(s)**
   - Friendly name: `Wayguard`
   - URL: `https://wayguard-i2oz.onrender.com/api/health` (your Render address
     followed by `/api/health`; it answers `{"status":"ok"}` and touches no data)
   - Monitoring interval: **5 minutes**
   - Alert contacts: your e-mail
3. **Create Monitor**. After a few minutes it shows **Up**.

Render's free plan allows 750 running hours per month per workspace. One site
kept awake all month uses about 744, so this works for **one** free service.
Pause the monitor when you do not need the site (e.g. between semesters).

---

## 11.2 Turn on e-mail (notifications and password reset)

Without e-mail, Wayguard still shows every update inside the app, but it cannot
e-mail citizens or send "Forgot your password?" links. Any SMTP service works;
two free options:

### Option A — Brevo (recommended, 300 e-mails per day free)

1. Sign up at <https://www.brevo.com>.
2. **Senders, domains & dedicated IPs → Senders → Add a sender**: use the team
   e-mail that should appear as the sender and confirm the e-mail Brevo sends.
3. **SMTP & API → SMTP**: note the **SMTP server**, **port** (587) and
   **login**, then **Generate a new SMTP key** and copy it.
4. Render → your **wayguard** service → **Environment** → add:

   | Key | Value |
   | --- | --- |
   | `SMTP_HOST` | the SMTP server shown by Brevo (e.g. `smtp-relay.brevo.com`) |
   | `SMTP_PORT` | `587` |
   | `SMTP_SECURE` | `false` (587 upgrades to TLS with STARTTLS) |
   | `SMTP_USER` | the SMTP login shown by Brevo |
   | `SMTP_PASS` | the SMTP key (keep it secret) |
   | `MAIL_FROM` | `Wayguard <the-sender-you-verified@example.com>` |

5. **Save, rebuild, and deploy**.

### Option B — a Gmail account with an app password

Turn on 2-Step Verification for the Google account, create an **App password**
(Google Account → Security → App passwords), then use `SMTP_HOST=smtp.gmail.com`,
`SMTP_PORT=587`, `SMTP_SECURE=false`, `SMTP_USER=` the Gmail address,
`SMTP_PASS=` the 16-letter app password, `MAIL_FROM=Wayguard <that Gmail address>`.
Gmail limits how many messages a personal account can send per day, so use it
for demonstrations only.

### Check it works

1. Sign in as a citizen → **Profile** → tick **Also send my notifications by
   e-mail** → Save.
2. As an administrator, move one of that citizen's reports to the next status.
   The e-mail arrives within a minute.
3. Sign out → **Forgot your password?** → enter the citizen's e-mail → the
   reset link arrives; it works once and expires after 60 minutes.

If nothing arrives: check the spam folder, then Render → **Logs** for lines
starting with `[mailer]` or `[password reset]`, which show the SMTP error.

---

## 11.3 Test on real phones

Use one Android phone (Chrome) and one iPhone (Safari), on mobile data, with
the live `https://` address. Tick each item; note the phone model if
something fails.

| # | Check | Android | iPhone |
| --- | --- | --- | --- |
| 1 | Landing page loads, animations smooth, **EN / FIL** switch works | ☐ | ☐ |
| 2 | **Create a citizen account**: city search finds your city; Show password works | ☐ | ☐ |
| 3 | **Report a pothole** → **Use my current location**: the browser asks for permission, the pin lands where you are | ☐ | ☐ |
| 4 | **Take photo** opens the camera; **Add photo** opens the gallery; the photo shows in the form | ☐ | ☐ |
| 5 | Send the report → you get a WG- code | ☐ | ☐ |
| 6 | Turn on **airplane mode**, fill a report, Send → "Saved on this phone"; turn airplane mode off → it sends by itself within a minute | ☐ | ☐ |
| 7 | **Map** → **Report** button, severity sheet, form pre-filled | ☐ | ☐ |
| 8 | **Drive mode** (as a passenger!): the arrow follows you, speed shows, a "Pothole ahead" alert appears near a report, and the voice says it | ☐ | ☐ |
| 9 | Near an existing report, **I saw this too** works and its count goes up | ☐ | ☐ |
| 10 | **Add to Home screen**, open it from the icon: it opens full-screen | ☐ | ☐ |
| 11 | As a road crew account: open a task, **Directions** opens Google Maps / Waze, upload before and after photos | ☐ | ☐ |
| 12 | Notifications appear after an administrator changes the report | ☐ | ☐ |

Known platform limits: iPhones only allow location and camera on `https://`
sites (the live Render address is fine); some phones mute speech when the ringer
switch is silent; voice alerts use the phone's own voices, so Filipino speech
depends on a Filipino voice being installed.
