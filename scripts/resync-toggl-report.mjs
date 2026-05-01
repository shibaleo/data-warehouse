#!/usr/bin/env node
// Local one-off re-sync of Toggl Reports API v3 → data_warehouse_v2
// (append-only). Mirrors the GAS appendRaw / cleanupStaleTrackEntries
// behaviour so manual full-history resyncs and the scheduled weekly sync
// produce identical raw state.
//
// Usage:
//   node scripts/resync-toggl-report.mjs [START] [END]
//   START / END: YYYY-MM-DD (defaults: 2023-11-01 to tomorrow UTC)
// Requires: DATABASE_URL in repo-root .env, Node 18+ (built-in fetch).
// Zero npm deps.
//
// Toggl rate limit: 30 req/h. The script minimises requests by:
//   - PAGE_SIZE = 1000 (highest value Toggl Reports API v3 has accepted in practice)
//   - CHUNK_DAYS = 365 (largest range Toggl accepts per detailed-report query)
//   - Inter-page pause = 100ms
// Total cost for full 2.5-year resync ≈ 18 requests (well under quota).
//
// Append-only semantics:
//   - Each chunk: append a new revision only when md5((data - 'at')::text)
//     differs from the latest revision (DB-side hashing for parity with
//     migration 007). Unchanged content is a no-op.
//   - Per-chunk diff-tombstone: source_ids missing from the just-fetched
//     response get a deleted=true revision appended.
//   - Cross-table cleanup: tombstone Track v9 rows whose deletion the
//     Reports authority has just confirmed.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOGGL_REPORTS_V3 = 'https://api.track.toggl.com/reports/api/v3';
const PAGE_SIZE = 1000;
const RATE_LIMIT_MS = 100;
const CHUNK_DAYS = 365;
const BATCH_SIZE = 100;
const RAW_SCHEMA = 'data_warehouse_v2';

let apiRequestCount = 0;

// ---- helpers --------------------------------------------------------------

function loadEnv(envPath) {
  const text = readFileSync(envPath, 'utf8');
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function splitDateRange(start, end, maxDays) {
  const chunks = [];
  let cur = new Date(start + 'T00:00:00Z');
  const e = new Date(end + 'T00:00:00Z');
  while (cur < e) {
    const chunkEnd = new Date(cur.getTime() + maxDays * 86400000);
    const actual = chunkEnd < e ? chunkEnd : e;
    chunks.push({ start: isoDate(cur), end: isoDate(actual) });
    cur = new Date(actual.getTime() + 86400000);
  }
  return chunks;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- Neon SQL over HTTP ---------------------------------------------------

async function neonSql(databaseUrl, query, params = []) {
  const m = databaseUrl.match(/@([^:/]+)/);
  if (!m) throw new Error('Cannot parse hostname from DATABASE_URL');
  const endpoint = `https://${m[1]}/sql`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Neon-Connection-String': databaseUrl,
      'Neon-Raw-Text-Output': 'true',
      'Neon-Array-Mode': 'true',
    },
    body: JSON.stringify({ query, params }),
  });
  if (!res.ok) {
    throw new Error(`Neon SQL ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// ---- Toggl Reports API v3 -------------------------------------------------

async function fetchAllDetailedReport(workspaceId, auth, startDate, endDate) {
  const all = [];
  let firstRow = 1;

  while (true) {
    apiRequestCount++;
    const res = await fetch(
      `${TOGGL_REPORTS_V3}/workspace/${workspaceId}/search/time_entries`,
      {
        method: 'POST',
        headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_date: startDate,
          end_date: endDate,
          first_row_number: firstRow,
          page_size: PAGE_SIZE,
        }),
      },
    );
    if (res.status === 429) {
      throw new Error(`Toggl 429 Too Many Requests (rate limit: 30 req/h). Already made ${apiRequestCount} requests this run. Wait an hour before retrying.`);
    }
    if (!res.ok) {
      throw new Error(`Toggl Reports API ${res.status}: ${await res.text()}`);
    }
    const groups = await res.json();

    let pageCount = 0;
    for (const g of groups) {
      for (const te of (g.time_entries || [])) {
        all.push({
          ...te,
          user_id: g.user_id,
          username: g.username,
          project_id: g.project_id,
          task_id: g.task_id,
          billable: g.billable,
          description: g.description,
          tag_ids: g.tag_ids,
        });
        pageCount++;
      }
    }

    if (pageCount < PAGE_SIZE) break;
    firstRow += PAGE_SIZE;
    await sleep(RATE_LIMIT_MS);
  }

  return all;
}

// ---- Append-only writes ---------------------------------------------------

/**
 * Append a new revision per record only when the content hash differs from
 * the latest, or the latest is a tombstone. Unchanged content is a no-op.
 */
async function appendBatch(databaseUrl, tableName, batch, apiVersion) {
  if (batch.length === 0) return 0;

  const placeholders = [];
  const params = [];
  let p = 1;
  for (const r of batch) {
    placeholders.push(`($${p}, $${p + 1}::jsonb, $${p + 2})`);
    params.push(r.sourceId, JSON.stringify(r.data), apiVersion);
    p += 3;
  }

  const sql = `
    WITH input(source_id, data, api_version) AS (
      VALUES ${placeholders.join(',')}
    ),
    input_hashed AS (
      SELECT source_id, data, api_version, md5((data - 'at')::text) AS new_hash
      FROM input
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
      SELECT
        i.source_id,
        COALESCE(l.revision, 0) + 1,
        i.data,
        i.new_hash,
        false,
        false,
        i.api_version
      FROM input_hashed i
      LEFT JOIN latest l ON l.source_id = i.source_id
      WHERE l.source_id IS NULL
         OR l.deleted = true
         OR l.content_hash IS DISTINCT FROM i.new_hash
      RETURNING 1
    )
    SELECT count(*) AS appended FROM inserted
  `;

  const result = await neonSql(databaseUrl, sql, params);
  if (!result.rows || result.rows.length === 0) return 0;
  return parseInt(String(result.rows[0][0]), 10) || 0;
}

async function appendEntries(databaseUrl, entries) {
  if (entries.length === 0) return { appended: 0, unique: [] };

  const seen = new Set();
  const unique = [];
  for (const e of entries) {
    const id = String(e.id);
    if (!seen.has(id)) {
      seen.add(id);
      unique.push({ sourceId: id, data: e });
    }
  }

  let appended = 0;
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    appended += await appendBatch(
      databaseUrl,
      'raw_toggl_track__time_entries_report',
      batch,
      'v3',
    );
  }

  return { appended, unique };
}

/**
 * Per-chunk diff-tombstone on Reports table: source_ids in the window that
 * are still "live" but missing from the just-fetched response get a
 * deleted=true revision appended.
 */
async function tombstoneMissingReport(databaseUrl, chunkStart, chunkEnd, presentSourceIds) {
  // Empty response = transient blip, not wholesale deletion. Skip.
  if (presentSourceIds.length === 0) return 0;

  const placeholders = presentSourceIds.map((_, i) => `$${i + 3}`).join(',');
  const params = [`${chunkStart}T00:00:00Z`, `${chunkEnd}T00:00:00Z`, ...presentSourceIds];

  const sql = `
    WITH targets AS (
      SELECT cur.source_id, cur.data, cur.content_hash, cur.revision
      FROM ${RAW_SCHEMA}.raw_toggl_track__time_entries_report_current cur
      WHERE (cur.data->>'start')::timestamptz >= ($1)::timestamptz
        AND (cur.data->>'start')::timestamptz <  ($2)::timestamptz
        AND cur.created_at < now() - interval '5 minutes'
        AND cur.source_id NOT IN (${placeholders})
    ),
    tombstoned AS (
      INSERT INTO ${RAW_SCHEMA}.raw_toggl_track__time_entries_report
        (source_id, revision, data, content_hash, deleted, purged, api_version)
      SELECT t.source_id, t.revision + 1, t.data, t.content_hash, true, false, 'v3'
      FROM targets t
      RETURNING 1
    )
    SELECT count(*) AS tombstoned FROM tombstoned
  `;

  const result = await neonSql(databaseUrl, sql, params);
  if (!result.rows || result.rows.length === 0) return 0;
  return parseInt(String(result.rows[0][0]), 10) || 0;
}

/**
 * Cross-table cleanup: tombstone Track v9 rows whose source_id is now
 * confirmed missing from the freshly-synced Reports authority.
 * In-progress rows (stop IS NULL) are protected.
 */
async function cleanupStaleTrackEntries(databaseUrl, startDate, endDate) {
  const sql = `
    WITH targets AS (
      SELECT cur.source_id, cur.data, cur.content_hash, cur.revision
      FROM ${RAW_SCHEMA}.raw_toggl_track__time_entries_current cur
      WHERE (cur.data->>'start')::timestamptz >= ($1)::timestamptz
        AND (cur.data->>'start')::timestamptz <  ($2)::timestamptz
        AND (cur.data->>'stop') IS NOT NULL
        AND cur.created_at < now() - interval '5 minutes'
        AND NOT EXISTS (
          SELECT 1 FROM ${RAW_SCHEMA}.raw_toggl_track__time_entries_report_current r
          WHERE r.source_id = cur.source_id
        )
    ),
    tombstoned AS (
      INSERT INTO ${RAW_SCHEMA}.raw_toggl_track__time_entries
        (source_id, revision, data, content_hash, deleted, purged, api_version)
      SELECT t.source_id, t.revision + 1, t.data, t.content_hash, true, false, 'v9'
      FROM targets t
      RETURNING 1
    )
    SELECT count(*) AS tombstoned FROM tombstoned
  `;

  const result = await neonSql(databaseUrl, sql, [`${startDate}T00:00:00Z`, `${endDate}T00:00:00Z`]);
  if (!result.rows || result.rows.length === 0) return 0;
  return parseInt(String(result.rows[0][0]), 10) || 0;
}

// ---- main -----------------------------------------------------------------

async function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(__dirname, '..', '.env');
  const env = loadEnv(envPath);
  const databaseUrl = env.DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL not set in .env or environment');

  const start = process.argv[2] || '2023-11-01';
  const end = process.argv[3] || isoDate(new Date(Date.now() + 86400000));

  console.log(`Re-sync target: ${start} → ${end}`);

  const credResult = await neonSql(
    databaseUrl,
    `SELECT access_token, metadata->>'workspace_id' AS workspace_id
     FROM data_warehouse.credentials WHERE service_name = $1`,
    ['toggl_track'],
  );
  const rows = credResult.rows || [];
  if (rows.length === 0) throw new Error('Toggl credentials not found');
  const [token, workspaceId] = rows[0];
  const auth = 'Basic ' + Buffer.from(`${token}:api_token`).toString('base64');

  const chunks = splitDateRange(start, end, CHUNK_DAYS);
  console.log(`Split into ${chunks.length} chunk(s) of up to ${CHUNK_DAYS} days`);

  let totalAppended = 0;
  let totalReportTombstoned = 0;
  for (const chunk of chunks) {
    const t0 = Date.now();
    const entries = await fetchAllDetailedReport(workspaceId, auth, chunk.start, chunk.end);
    const t1 = Date.now();
    const { appended, unique } = await appendEntries(databaseUrl, entries);
    const t2 = Date.now();
    const tombstoned = await tombstoneMissingReport(
      databaseUrl,
      chunk.start,
      chunk.end,
      unique.map((u) => u.sourceId),
    );
    const t3 = Date.now();
    console.log(
      `  ${chunk.start}..${chunk.end}: fetched=${entries.length} appended=${appended} ` +
      `tombstoned=${tombstoned} ` +
      `fetch=${((t1 - t0) / 1000).toFixed(1)}s db=${((t3 - t1) / 1000).toFixed(1)}s`
    );
    totalAppended += appended;
    totalReportTombstoned += tombstoned;
  }

  console.log(`Done. Appended=${totalAppended}, report-tombstoned=${totalReportTombstoned}`);
  console.log(`API requests used: ${apiRequestCount} (Toggl rate limit: 30/h)`);

  const trackTombstoned = await cleanupStaleTrackEntries(databaseUrl, start, end);
  console.log(`Cross-table cleanup: tombstoned ${trackTombstoned} stale track entries`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
