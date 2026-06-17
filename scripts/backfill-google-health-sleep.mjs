#!/usr/bin/env node
// Backfill Google Health sleep over a long window.
//
// Sleep is low-volume (~1 session/night), so 5 years ≈ ~2k sessions ≈ ~40
// pages. Well below the 1000-page cap and the API's per-minute quota. We
// chunk by month anyway so that (a) progress is visible and (b) an aborted
// run resumes cheaply via append-only dedup (DB-side content_hash skips
// unchanged source_ids).
//
// Usage:
//   node scripts/backfill-google-health-sleep.mjs [YEARS]
//   YEARS: lookback from now (default 5)

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://health.googleapis.com/v4';
const SERVICE_NAME = 'google_health';
const PAGE_SIZE = 50;
const RAW_SCHEMA = 'data_warehouse_v2';
const TABLE_NAME = 'raw_google_health__sleep';

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

async function listSleepDataPoints(accessToken, startIso, endIso) {
  const filter = `sleep.interval.end_time >= "${startIso}" AND sleep.interval.end_time < "${endIso}"`;
  const out = [];
  let pageToken;
  let pageCount = 0;
  do {
    let qs = `pageSize=${PAGE_SIZE}&filter=${encodeURIComponent(filter)}`;
    if (pageToken) qs += `&pageToken=${encodeURIComponent(pageToken)}`;
    const url = `${API_BASE}/users/me/dataTypes/sleep/dataPoints?${qs}`;
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    const text = await res.text();
    if (!res.ok) throw new Error(`sleep HTTP ${res.status}: ${text.slice(0, 300)}`);
    const body = JSON.parse(text);
    if (body.dataPoints) out.push(...body.dataPoints);
    pageToken = body.nextPageToken;
    pageCount++;
    if (pageCount > 1000) { console.warn('sleep: hit 1000-page cap'); break; }
  } while (pageToken);
  return out;
}

async function appendRaw(databaseUrl, records, apiVersion = 'v4') {
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
        FROM ${RAW_SCHEMA}.${TABLE_NAME}
        WHERE source_id IN (SELECT source_id FROM input)
        ORDER BY source_id, revision DESC
      ),
      inserted AS (
        INSERT INTO ${RAW_SCHEMA}.${TABLE_NAME}
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

function nameLast(name) {
  if (typeof name !== 'string' || !name) return null;
  const idx = name.lastIndexOf('/');
  return idx >= 0 ? name.slice(idx + 1) : name;
}

function* monthWindows(startDate, endDate) {
  // Yield [windowStartIso, windowEndIso] half-open monthly chunks covering
  // [startDate, endDate).
  const cur = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
  while (cur < endDate) {
    const next = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    const winEnd = next < endDate ? next : endDate;
    yield [cur.toISOString(), winEnd.toISOString()];
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
}

async function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const env = loadEnv(resolve(__dirname, '..', '.env'));
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL missing');

  const years = parseInt(process.argv[2] ?? '5', 10);
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const start = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()));
  console.log(`Sleep backfill: ${start.toISOString()} → ${end.toISOString()} (${years}y)\n`);

  const accessToken = await getAccessToken(env.DATABASE_URL);

  let totalFetched = 0;
  let totalAppended = 0;
  let totalSkipped = 0;
  for (const [s, e] of monthWindows(start, end)) {
    process.stdout.write(`[${s.slice(0, 7)}] `);
    try {
      const points = await listSleepDataPoints(accessToken, s, e);
      const records = [];
      let skipped = 0;
      for (const p of points) {
        const id = nameLast(p.name);
        if (!id) { skipped++; continue; }
        records.push({ sourceId: String(id), data: p });
      }
      const appended = await appendRaw(env.DATABASE_URL, records);
      console.log(`fetched=${points.length} skipped=${skipped} appended=${appended}`);
      totalFetched += points.length;
      totalAppended += appended;
      totalSkipped += skipped;
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
    }
  }

  console.log(`\nTotal: fetched=${totalFetched} skipped=${totalSkipped} appended=${totalAppended}`);
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
