#!/usr/bin/env node
// One-shot Google Health sync runnable from Node (mirror of
// apps/connector/src/google_health/sync.ts; the GAS path is for production).
//
// Useful for:
//   - Validating raw_google_health__* before the first GAS trigger fires
//   - Backfill of historical windows (Phase D in docs/002_google_health_migration.md)
//
// Usage:
//   node scripts/sync-google-health.mjs [DAYS]
//   DAYS: lookback window from "now" (default 7)
//
// Reuses the same data shape, source_id strategy, and append-only semantics
// as the GAS connector (md5((data - 'at')::text) done DB-side, so hashes
// match across both code paths).

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://health.googleapis.com/v4';
const SERVICE_NAME = 'google_health';
const PAGE_SIZE = 50;
const RAW_SCHEMA = 'data_warehouse_v2';

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

  if (expiresAt && new Date(expiresAt).getTime() - Date.now() > 10 * 60 * 1000) {
    return accessToken;
  }

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
  const newRefresh = data.refresh_token ?? refreshToken;
  await neonSql(
    databaseUrl,
    `UPDATE data_warehouse.credentials
        SET access_token=$1, refresh_token=$2, expires_at=$3, updated_at=now()
      WHERE service_name=$4`,
    [data.access_token, newRefresh, newExpiresAt, SERVICE_NAME],
  );
  console.log(`[refresh] new access_token, expires ${newExpiresAt}`);
  return data.access_token;
}

async function listDataPoints(accessToken, dataType, filter) {
  const out = [];
  let pageToken;
  let pageCount = 0;
  do {
    let qs = `pageSize=${PAGE_SIZE}&filter=${encodeURIComponent(filter)}`;
    if (pageToken) qs += `&pageToken=${encodeURIComponent(pageToken)}`;
    const url = `${API_BASE}/users/me/dataTypes/${dataType}/dataPoints?${qs}`;
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    const text = await res.text();
    if (!res.ok) throw new Error(`${dataType} HTTP ${res.status}: ${text.slice(0, 300)}`);
    const body = JSON.parse(text);
    if (body.dataPoints) out.push(...body.dataPoints);
    pageToken = body.nextPageToken;
    pageCount++;
    if (pageCount > 1000) { console.warn(`${dataType}: hit 1000-page cap`); break; }
  } while (pageToken);
  return out;
}

async function appendRaw(databaseUrl, tableName, records, apiVersion = 'v4') {
  if (records.length === 0) return 0;
  const batchSize = 100;
  let appended = 0;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const placeholders = [];
    const params = [];
    let p = 1;
    for (const r of batch) {
      placeholders.push(`($${p}, $${p + 1}::jsonb, $${p + 2})`);
      params.push(r.sourceId, JSON.stringify(r.data), apiVersion);
      p += 3;
    }
    const query = `
      WITH input(source_id, data, api_version) AS (VALUES ${placeholders.join(', ')}),
      input_hashed AS (
        SELECT source_id, data, api_version, md5((data - 'at')::text) AS new_hash FROM input
      ),
      latest AS (
        SELECT DISTINCT ON (source_id) source_id, revision, content_hash, deleted
        FROM ${RAW_SCHEMA}.${tableName}
        WHERE source_id IN (SELECT source_id FROM input)
        ORDER BY source_id, revision DESC
      ),
      inserted AS (
        INSERT INTO ${RAW_SCHEMA}.${tableName}
          (source_id, revision, data, content_hash, deleted, purged, api_version)
        SELECT i.source_id, COALESCE(l.revision, 0) + 1, i.data, i.new_hash, false, false, i.api_version
        FROM input_hashed i LEFT JOIN latest l ON l.source_id = i.source_id
        WHERE l.source_id IS NULL OR l.deleted = true OR l.content_hash IS DISTINCT FROM i.new_hash
        RETURNING 1
      )
      SELECT count(*) AS appended FROM inserted`;
    const r = await neonSql(databaseUrl, query, params);
    appended += parseInt(String(r.rows[0][0]), 10) || 0;
  }
  return appended;
}

// Filter helpers (confirmed via probe-google-health.mjs)
const f = {
  instant: (field, s, e) => `${field} >= "${s}" AND ${field} < "${e}"`,
  civil:   (field, s, e) => `${field} >= "${s.slice(0, 19)}" AND ${field} < "${e.slice(0, 19)}"`,
  date:    (field, s, e) => `${field} >= "${s.slice(0, 10)}" AND ${field} < "${e.slice(0, 10)}"`,
};

function nameLast(name) {
  if (typeof name !== 'string' || !name) return null;
  const idx = name.lastIndexOf('/');
  return idx >= 0 ? name.slice(idx + 1) : name;
}

function dateObjToIso(d) {
  if (!d?.year || !d?.month || !d?.day) return null;
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

// Interval points (steps/active_minutes/distance): startTime alone is NOT
// unique — multiple devices/methods can report the same instant. Composite
// source_id with recordingMethod + device.displayName.
function intervalSrcId(p, startTime) {
  const method = p.dataSource?.recordingMethod ?? 'UNKNOWN_METHOD';
  const device = p.dataSource?.device?.displayName ?? 'UNKNOWN_DEVICE';
  return `${startTime}__${method}__${device}`;
}

// Entity table: filterField -> payloadKey -> sourceIdStrategy
const ENTITIES = [
  // table_short, dataType,                            filterFn, filterField,                                       payloadKey,                          srcId
  ['sleep',                                'sleep',                              f.instant, 'sleep.interval.end_time',                                 'sleep',                             p => nameLast(p.name)],
  ['steps',                                'steps',                              f.instant, 'steps.interval.start_time',                               'steps',                             p => { const t = p.steps?.interval?.startTime; return t ? intervalSrcId(p, t) : null; }],
  ['active_minutes',                       'active-minutes',                     f.instant, 'active_minutes.interval.start_time',                      'activeMinutes',                     p => { const t = p.activeMinutes?.interval?.startTime; return t ? intervalSrcId(p, t) : null; }],
  ['distance',                             'distance',                           f.instant, 'distance.interval.start_time',                            'distance',                          p => { const t = p.distance?.interval?.startTime; return t ? intervalSrcId(p, t) : null; }],
  ['exercise',                             'exercise',                           f.civil,   'exercise.interval.civil_start_time',                      'exercise',                          p => nameLast(p.name)],
  ['daily_resting_heart_rate',             'daily-resting-heart-rate',           f.date,    'daily_resting_heart_rate.date',                           'dailyRestingHeartRate',             p => dateObjToIso(p.dailyRestingHeartRate?.date)],
  ['daily_heart_rate_variability',         'daily-heart-rate-variability',       f.date,    'daily_heart_rate_variability.date',                       'dailyHeartRateVariability',         p => dateObjToIso(p.dailyHeartRateVariability?.date)],
  ['daily_oxygen_saturation',              'daily-oxygen-saturation',            f.date,    'daily_oxygen_saturation.date',                            'dailyOxygenSaturation',             p => dateObjToIso(p.dailyOxygenSaturation?.date)],
  ['daily_vo2_max',                        'daily-vo2-max',                      f.date,    'daily_vo2_max.date',                                      'dailyVo2Max',                       p => dateObjToIso(p.dailyVo2Max?.date)],
  ['daily_sleep_temperature_derivations',  'daily-sleep-temperature-derivations',f.date,    'daily_sleep_temperature_derivations.date',                'dailySleepTemperatureDerivations',  p => dateObjToIso(p.dailySleepTemperatureDerivations?.date)],
  // respiratory_rate_sleep_summary disabled — API rejects every filter
  // candidate we've tried (INVALID_DATA_POINT_FILTER_DATA_TYPE_MEMBER). See
  // docs/002 Unresolved TODOs #1.
];

async function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const env = loadEnv(resolve(__dirname, '..', '.env'));
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL missing');

  const days = parseInt(process.argv[2] ?? '7', 10);
  const now = Date.now();
  const endIso = new Date(now + 24 * 60 * 60 * 1000).toISOString();
  const startIso = new Date(now - days * 86400 * 1000).toISOString();
  console.log(`Window: ${startIso} → ${endIso} (${days} days)\n`);

  const accessToken = await getAccessToken(env.DATABASE_URL);

  const summary = [];
  for (const [shortName, dataType, filterFn, filterField, , extractId] of ENTITIES) {
    const tableName = `raw_google_health__${shortName}`;
    process.stdout.write(`[${shortName}] `);
    try {
      const points = await listDataPoints(accessToken, dataType, filterFn(filterField, startIso, endIso));
      const records = [];
      let skipped = 0;
      for (const p of points) {
        const id = extractId(p);
        if (!id) { skipped++; continue; }
        records.push({ sourceId: String(id), data: p });
      }
      const appended = await appendRaw(env.DATABASE_URL, tableName, records);
      console.log(`fetched=${points.length} skipped=${skipped} appended=${appended}`);
      summary.push({ shortName, fetched: points.length, skipped, appended });
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
      summary.push({ shortName, error: e.message });
    }
  }

  console.log('\nSummary:');
  console.table(summary);
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
