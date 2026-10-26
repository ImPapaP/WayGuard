# Wayguard mobile apps (Android)

| Folder | App name | For | Opens |
| --- | --- | --- | --- |
| `citizen-app/` | **Wayguard** | Residents / citizens | `https://wayguard-i2oz.onrender.com/app` |
| `crew-app/` | **Wayguard Crew** | Road crews / responders | `https://wayguard-i2oz.onrender.com/crew` |

Both are [Capacitor](https://capacitorjs.com) apps: a native Android shell that
runs the live Wayguard web app (the same code as the website) with Android
location and camera permissions. Everything a user does in the app — sign in,
report with GPS and camera, offline outbox, drive mode, crew tasks — is the
Wayguard web app itself, so the website and the apps always stay in step.

## Getting the APKs

GitHub builds them automatically (`.github/workflows/android-apk.yml`) whenever
`mobile/` changes on `main`, or by hand: GitHub → **Actions** → **Build Android
APKs** → **Run workflow**. The results go to:

- the **`apk-builds`** branch: `wayguard-citizen-app.apk`, `wayguard-crew-app.apk`,
  the generated Android Studio projects (`*-android-project.zip`) and `BUILD.txt`
  with SHA-256 checksums;
- the workflow run's **Artifacts** section.

The APKs are **debug-signed** (fine for testing and class evaluation; Play Store
publishing needs a release key).

## Installing on a phone

1. Copy the APK to the phone (or download it from GitHub on the phone).
2. Open it; allow **Install unknown apps** for the browser / file manager when asked.
3. Open **Wayguard** (or **Wayguard Crew**) and sign in with a matching account.
4. Allow **Location** and **Camera** when asked.

The first open after the free server has slept takes up to a minute; the app
shows a "Can't reach Wayguard" page with **Try again** if there is no connection.

## Building on your own computer

Needs Node.js 22, JDK 21 and Android Studio (Android SDK 35).

```bash
cd mobile/citizen-app        # or crew-app
npm install
npx cap add android          # first time only
npm run assets               # app icon and splash from assets/
npx cap sync android
npx cap open android         # Build > Build APK(s), or: npm run build:apk
```

Add the location and camera permissions to
`android/app/src/main/AndroidManifest.xml` exactly as the workflow does (see the
`sed` line in `.github/workflows/android-apk.yml`).

To point the apps at a different address, change `server.url` and
`server.allowNavigation` in `capacitor.config.json`.
