#!/usr/bin/env node
// Local one-off re-sync of Toggl Reports API v3 → raw_toggl_track__time_entries_report.
//
// Mirrors apps/connector/src/toggl/sync-time-entries-report.ts but runs locally
// without the GAS 6-minute limit. The daily/hourly Track API v9 sync continues
// to run in GAS — this script only refreshes historical Reports API v3 data.
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
//   - Inter-page pause = 100ms (quota is per-hour, so bursting within seconds is fine
//     but a small pause keeps server-side queueing healthy)
// Total cost for full 2.5-year resync ≈ 18 requests (well under quota).
//
// After Reports sync completes, the script also removes track entries (Track API v9
// snapshot) that no longer exist in Reports — i.e. the user deleted them in Toggl.
// In-progress entries are protected (Reports never returns those by API design).

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOGGL_REPORTS_V3 = 'https://api.track.toggl.com/reports/api/v3';
const PAGE_SIZE = 1000;
const RATE_LIMIT_MS = 100;
const CHUNK_DAYS = 365;
const BATCH_SIZE = 100;

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

// ---- Neon SQL over HTTP (same endpoint pattern as apps/connector/lib/neon-client.ts) ----

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

// ---- Upsert (idempotent ON CONFLICT) --------------------------------------

async function upsertEntries(databaseUrl, entries) {
  if (entries.length === 0) return { upserted: 0, unique: [] };

  const seen = new Set();
  const unique = [];
  for (const e of entries) {
    const id = String(e.id);
    if (!seen.has(id)) {
      seen.add(id);
      unique.push({ sourceId: id, data: e });
    }
  }

  let upserted = 0;
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    const placeholders = [];
    const params = [];
    let p = 1;
    for (const r of batch) {
      placeholders.push(`($${p}, $${p + 1}::jsonb, now(), $${p + 2})`);
      params.push(r.sourceId, JSON.stringify(r.data), 'v3');
      p += 3;
    }
    await neonSql(
      databaseUrl,
      `INSERT INTO data_warehouse.raw_toggl_track__time_entries_report
         (source_id, data, synced_at, api_version)
       VALUES ${placeholders.join(',')}
       ON CONFLICT (source_id) DO UPDATE SET
         data = EXCLUDED.data,
         synced_at = EXCLUDED.synced_at,
         api_version = EXCLUDED.api_version`,
      params,
    );
    upserted += batch.length;
  }

  return { upserted, unique };
}

/**
 * Per-chunk differential delete: drop entries in [chunkStart, chunkEnd) whose
 * source_id is missing from the just-fetched Reports response. This keeps
 * raw_toggl_track__time_entries_report in sync with Toggl's authoritative
 * state; without it, entries the user later deleted would silently linger.
 */
async function differentialDeleteReport(databaseUrl, chunkStart, chunkEnd, presentSourceIds) {
  // Guard: an empty response is far more often a transient API blip than
  // "user deleted everything in this 1-year window". Skip diff-delete to
  // avoid catastrophic data loss; the next run will catch up.
  if (presentSourceIds.length === 0) {
    return 0;
  }

  const placeholders = presentSourceIds.map((_, i) => `$${i + 3}`).join(',');
  const params = [`${chunkStart}T00:00:00Z`, `${chunkEnd}T00:00:00Z`, ...presentSourceIds];
  const presentClause = `AND source_id NOT IN (${placeholders})`;

  const result = await neonSql(
    databaseUrl,
    `DELETE FROM data_warehouse.raw_toggl_track__time_entries_report
     WHERE (data->>'start')::timestamptz >= ($1)::timestamptz
       AND (data->>'start')::timestamptz <  ($2)::timestamptz
       AND synced_at < now() - interval '5 minutes'
       ${presentClause}`,
    params,
  );
  return result.rowCount ?? 0;
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

  // Fetch Toggl credentials
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

  let totalUpserted = 0;
  let totalReportDeleted = 0;
  for (const chunk of chunks) {
    const t0 = Date.now();
    const entries = await fetchAllDetailedReport(workspaceId, auth, chunk.start, chunk.end);
    const t1 = Date.now();
    const { upserted, unique } = await upsertEntries(databaseUrl, entries);
    const t2 = Date.now();
    const reportDeleted = await differentialDeleteReport(
      databaseUrl,
      chunk.start,
      chunk.end,
      unique.map((u) => u.sourceId),
    );
    const t3 = Date.now();
    console.log(
      `  ${chunk.start}..${chunk.end}: fetched=${entries.length} upserted=${upserted} ` +
      `report-deleted=${reportDeleted} ` +
      `fetch=${((t1 - t0) / 1000).toFixed(1)}s db=${((t3 - t1) / 1000).toFixed(1)}s`
    );
    totalUpserted += upserted;
    totalReportDeleted += reportDeleted;
  }

  console.log(`Done. Upserted=${totalUpserted}, report-deleted=${totalReportDeleted}`);
  console.log(`API requests used: ${apiRequestCount} (Toggl rate limit: 30/h)`);

  const trackDeleted = await cleanupStaleTrackEntries(databaseUrl, start, end);
  console.log(`Cross-table cleanup: removed ${trackDeleted} stale track entries (deleted in Toggl)`);
}

// Remove track entries that no longer exist in Reports — i.e. user deleted them in Toggl.
// In-progress entries (stop IS NULL) are protected: Reports never returns those by design.
// A 5-minute grace on synced_at protects against just-created entries that Reports has not seen yet.
async function cleanupStaleTrackEntries(databaseUrl, startDate, endDate) {
  const result = await neonSql(
    databaseUrl,
    `DELETE FROM data_warehouse.raw_toggl_track__time_entries t
     WHERE (t.data->>'start')::timestamptz >= ($1)::timestamptz
       AND (t.data->>'start')::timestamptz <  ($2)::timestamptz
       AND (t.data->>'stop') IS NOT NULL
       AND (t.data->>'duration')::bigint > 0
       AND t.synced_at < now() - interval '5 minutes'
       AND NOT EXISTS (
         SELECT 1 FROM data_warehouse.raw_toggl_track__time_entries_report r
         WHERE r.source_id = t.source_id
       )`,
    [`${startDate}T00:00:00Z`, `${endDate}T00:00:00Z`],
  );
  return result.rowCount ?? 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
