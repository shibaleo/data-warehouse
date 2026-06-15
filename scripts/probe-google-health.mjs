#!/usr/bin/env node
// Google Health API v4 probe.
//
// Reads stored google_health credentials from data_warehouse.credentials,
// refreshes the access token if needed, and lists dataPoints for each
// dataType we plan to sync, for a recent window (default: last 7 days).
//
// Dumps each response as JSON to scripts/probe-out/<dataType>.json so we can
// see actual response shape before writing api-client.ts / sync.ts.
//
// Usage:
//   node scripts/probe-google-health.mjs [DAYS]
//   DAYS: how many days back from today (default 7)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://health.googleapis.com/v4';
const SERVICE_NAME = 'google_health';

const DATA_TYPES = [
  'sleep',
  'steps',
  'active-minutes',
  'distance',
  'exercise',
  'daily-resting-heart-rate',
  'daily-heart-rate-variability',
  'daily-oxygen-saturation',
  'respiratory-rate-sleep-summary',
  'daily-vo2-max',
  'daily-sleep-temperature-derivations',
];

function loadEnv(envPath) {
  const text = readFileSync(envPath, 'utf8');
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[k] = v;
  }
  return env;
}

async function neonSql(databaseUrl, query, params = []) {
  const m = databaseUrl.match(/@([^:/]+)/);
  if (!m) throw new Error('Cannot parse hostname from DATABASE_URL');
  const res = await fetch(`https://${m[1]}/sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Neon-Connection-String': databaseUrl,
      'Neon-Raw-Text-Output': 'true',
      'Neon-Array-Mode': 'true',
    },
    body: JSON.stringify({ query, params }),
  });
  if (!res.ok) throw new Error(`Neon SQL ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getAccessToken(databaseUrl) {
  const r = await neonSql(
    databaseUrl,
    `SELECT client_id, client_secret, access_token, refresh_token, expires_at
       FROM data_warehouse.credentials WHERE service_name=$1`,
    [SERVICE_NAME],
  );
  const row = r.rows[0];
  if (!row) throw new Error('No google_health credentials in DB');
  const [clientId, clientSecret, accessToken, refreshToken, expiresAt] = row;

  if (expiresAt && new Date(expiresAt).getTime() - Date.now() > 60_000) {
    return accessToken;
  }

  // Refresh
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const tr = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const tt = await tr.text();
  if (!tr.ok) throw new Error(`Refresh failed (${tr.status}): ${tt}`);
  const data = JSON.parse(tt);
  const newExpiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString();
  await neonSql(
    databaseUrl,
    `UPDATE data_warehouse.credentials
        SET access_token=$1, expires_at=$2, updated_at=now()
      WHERE service_name=$3`,
    [data.access_token, newExpiresAt, SERVICE_NAME],
  );
  console.log(`[refresh] new access_token, expires ${newExpiresAt}`);
  return data.access_token;
}

async function probe(accessToken, dataType, startTime, endTime) {
  // Different dataTypes support different filter fields. Try in order:
  //   1. {snake}.interval.start_time (UTC instant, e.g. steps)
  //   2. {snake}.interval.end_time   (sleep uses end_time)
  //   3. {snake}.interval.civil_start_time (daily-* date-bucketed)
  const snake = dataType.replace(/-/g, '_');
  const startCivil = startTime.slice(0, 19); // strip ".sssZ"
  const endCivil = endTime.slice(0, 19);
  const startDate = startTime.slice(0, 10);
  const endDate = endTime.slice(0, 10);
  const candidates = [
    `${snake}.interval.start_time >= "${startTime}" AND ${snake}.interval.start_time < "${endTime}"`,
    `${snake}.interval.end_time >= "${startTime}" AND ${snake}.interval.end_time < "${endTime}"`,
    `${snake}.interval.civil_start_time >= "${startCivil}" AND ${snake}.interval.civil_start_time < "${endCivil}"`,
    `${snake}.date >= "${startDate}" AND ${snake}.date < "${endDate}"`,
    `${snake}.civil_date >= "${startDate}" AND ${snake}.civil_date < "${endDate}"`,
    `${snake}.sample_time >= "${startTime}" AND ${snake}.sample_time < "${endTime}"`,
    `${snake}.civil_sample_time >= "${startCivil}" AND ${snake}.civil_sample_time < "${endCivil}"`,
    `${snake}.sample_time.physical_time >= "${startTime}" AND ${snake}.sample_time.physical_time < "${endTime}"`,
  ];
  let last;
  for (const filter of candidates) {
    const url = new URL(`${API_BASE}/users/me/dataTypes/${dataType}/dataPoints`);
    url.searchParams.set('pageSize', '50');
    url.searchParams.set('filter', filter);
    const res = await fetch(url.toString(), { headers: { 'Authorization': `Bearer ${accessToken}` } });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    last = { status: res.status, url: url.toString(), filter, body: parsed ?? text };
    if (res.ok) return last;
    // Only continue if it's the "not supported for filtering" error
    const msg = parsed?.error?.details?.[0]?.metadata?.detailedReasons ?? '';
    if (!msg.includes('DATA_TYPE_MEMBER')) return last;
  }
  return last;
}

async function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const env = loadEnv(resolve(__dirname, '..', '.env'));
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL missing');

  const days = parseInt(process.argv[2] ?? '7', 10);
  const endTime = new Date().toISOString();
  const startTime = new Date(Date.now() - days * 86400 * 1000).toISOString();
  console.log(`Window: ${startTime} → ${endTime}`);

  const accessToken = await getAccessToken(env.DATABASE_URL);
  console.log('access_token acquired\n');

  const outDir = resolve(__dirname, 'probe-out');
  mkdirSync(outDir, { recursive: true });

  const summary = [];
  for (const dt of DATA_TYPES) {
    process.stdout.write(`[${dt}] `);
    try {
      const r = await probe(accessToken, dt, startTime, endTime);
      const fp = resolve(outDir, `${dt}.json`);
      writeFileSync(fp, JSON.stringify({ url: r.url, status: r.status, body: r.body }, null, 2));
      const count = r.body && Array.isArray(r.body.dataPoints) ? r.body.dataPoints.length : null;
      console.log(`status=${r.status}${count !== null ? ` points=${count}` : ''}`);
      summary.push({ dataType: dt, status: r.status, points: count });
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
      summary.push({ dataType: dt, error: e.message });
    }
  }

  console.log('\nSummary:');
  console.table(summary);
  console.log(`\nResponses written to ${outDir}`);
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
