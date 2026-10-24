// Entry point: `npm start` (production) or `npm run dev`.
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import { config, configWarnings } from './config.js';
import { createApp } from './app.js';
import { closeSql, getSql } from './db/index.js';
import { purgeExpiredSessions } from './services/sessions.js';
import { startMailer } from './services/mailer.js';
import { ensureInitialAdmin } from './services/bootstrap.js';

async function main() {
  // Fail fast with a clear message if the database is unreachable.
  try {
    await getSql()`SELECT 1`;
    const [{ n }] = await getSql()`
      SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'reports'`;
    if (!n) {
      console.error('The database has no Wayguard tables yet. Run `npm run db:migrate` first.');
      process.exit(1);
    }
  } catch (err) {
    console.error(`Cannot connect to PostgreSQL (${err.message}). Check DATABASE_URL in your .env file.`);
    process.exit(1);
  }

  await ensureInitialAdmin();

  const handler = createApp();
  const server = config.https.enabled
    ? https.createServer(
        { key: fs.readFileSync(config.https.keyFile), cert: fs.readFileSync(config.https.certFile) },
        handler,
      )
    : http.createServer(handler);
  server.requestTimeout = 120_000;
  server.headersTimeout = 30_000;

  server.listen(config.port, config.host, () => {
    const scheme = config.https.enabled ? 'https' : 'http';
    console.log(`Wayguard is running at ${scheme}://localhost:${config.port} (${config.env})`);
    console.log(
      `Maps: ${{ google: 'Google Maps', vector: 'Wayguard road map (OpenFreeMap vector tiles)', osm: 'OpenStreetMap raster tiles' }[config.maps.provider]}; address search: ${
        config.geocoder.enabled ? (config.geocoder.provider === 'google' ? 'Google Geocoding' : 'Nominatim') : 'off'
      }`,
    );
    for (const w of configWarnings()) console.log(`Warning: ${w}`);
    if (!fs.existsSync(config.clientDist)) {
      console.log('Note: the web client is not built yet — run `npm run build`, or use `npm run dev`.');
    }
  });

  const sessionTimer = setInterval(() => purgeExpiredSessions().catch(() => {}), 60 * 60 * 1000);
  sessionTimer.unref();
  const stopMailer = startMailer();

  const shutdown = async (signal) => {
    console.log(`\n${signal} received, shutting down...`);
    stopMailer();
    server.close();
    await closeSql().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
