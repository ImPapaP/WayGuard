// PostgreSQL connection using the `postgres` driver (Postgres.js).
// Every query is written with tagged templates — sql`... ${value}` — so values
// are always sent as bound parameters, never concatenated into SQL text.
import postgres from 'postgres';
import { config, assertConfig } from '../config.js';

let sqlInstance = null;

// Hosted databases (e.g. Neon) add URL options the driver would otherwise
// send to the server as settings; drop those, and turn off prepared
// statements behind a transaction-pooling endpoint ("-pooler" hosts).
export function connectionOptions(databaseUrl) {
  let url = databaseUrl;
  let pooled = false;
  try {
    const u = new URL(databaseUrl);
    for (const p of ['channel_binding', 'pgbouncer', 'connection_limit']) u.searchParams.delete(p);
    pooled = /-pooler\./.test(u.hostname);
    url = u.toString();
  } catch {
    // not a URL: let the driver report it
  }
  return { url, prepare: !pooled };
}

export function getSql() {
  if (!sqlInstance) {
    assertConfig();
    const { url, prepare } = connectionOptions(config.databaseUrl);
    sqlInstance = postgres(url, {
      prepare,
      max: config.isTest ? 4 : 10,
      idle_timeout: 30,
      connect_timeout: 15,
      onnotice: () => {},
      // Return BIGINT values (e.g. from count(*)) as JS numbers; counts here
      // never approach 2^53.
      types: {
        bigint: { to: 20, from: [20], serialize: (x) => String(x), parse: (x) => Number(x) },
        // DATE columns (e.g. due dates) stay plain 'YYYY-MM-DD' strings so no
        // time-zone conversion can shift them by a day.
        date: { to: 1082, from: [1082], serialize: (x) => String(x).slice(0, 10), parse: (x) => x },
      },
    });
  }
  return sqlInstance;
}

export async function closeSql() {
  if (sqlInstance) {
    const s = sqlInstance;
    sqlInstance = null;
    await s.end({ timeout: 5 });
  }
}

// Lazily-connected proxy so modules can `import { sql } from '../db/index.js'`
// and use it exactly like the Postgres.js `sql` function.
export const sql = new Proxy(function sqlProxy() {}, {
  apply(_target, _thisArg, args) {
    return getSql()(...args);
  },
  get(_target, prop) {
    const s = getSql();
    const value = s[prop];
    return typeof value === 'function' ? value.bind(s) : value;
  },
});
