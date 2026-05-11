#!/usr/bin/env node
// Local one-shot sync of Toggl Track masters (projects / clients / tags /
// me / workspaces / users / groups) → data_warehouse_v2 raw tables
// (append-only). Mirrors the GAS syncMasters() so a fresh server-side
// snapshot can be appended without waiting for the next dailySync.
//
// Usage:
//   node scripts/resync-toggl-masters.mjs
//
// Requires: DATABASE_URL in repo-root .env, Node 18+ (built-in fetch).
// Zero npm deps. Idempotent: unchanged content → no new revision.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOGGL_API_V9 = 'https://api.track.toggl.com/api/v9';
const RAW_SCHEMA = 'data_warehouse_v2';
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

async function togglGet(auth, path) {
  apiRequestCount++;
  const res = await fetch(`${TOGGL_API_V9}${path}`, {
    headers: { 'Authorization': auth },
  });
  if (res.status === 429) {
    throw new Error(`Toggl 429 Too Many Requests. Made ${apiRequestCount} requests this run.`);
  }
  if (!res.ok) {
    throw new Error(`Toggl API ${res.status} on ${path}: ${await res.text()}`);
  }
  return res.json();
}

// ---- append-only writes ---------------------------------------------------

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
  return parseInt(String(result.rows?.[0]?.[0] ?? 0), 10) || 0;
}

async function tombstoneMissing(databaseUrl, tableName, presentSourceIds, apiVersion) {
  if (presentSourceIds.length === 0) return 0;

  const placeholders = presentSourceIds.map((_, i) => `$${i + 2}`).join(',');
  const params = [apiVersion, ...presentSourceIds];

  const sql = `
    WITH targets AS (
      SELECT cur.source_id, cur.data, cur.content_hash, cur.revision
      FROM ${RAW_SCHEMA}.${tableName}_current cur
      WHERE cur.created_at < now() - interval '5 minutes'
        AND cur.source_id NOT IN (${placeholders})
    ),
    tombstoned AS (
      INSERT INTO ${RAW_SCHEMA}.${tableName}
        (source_id, revision, data, content_hash, deleted, purged, api_version)
      SELECT t.source_id, t.revision + 1, t.data, t.content_hash, true, false, $1
      FROM targets t
      RETURNING 1
    )
    SELECT count(*) AS tombstoned FROM tombstoned
  `;

  const result = await neonSql(databaseUrl, sql, params);
  return parseInt(String(result.rows?.[0]?.[0] ?? 0), 10) || 0;
}

// records: [{ sourceId, data }, ...]
async function appendAll(databaseUrl, tableName, records, apiVersion, opts = {}) {
  let appended = 0;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    appended += await appendBatch(databaseUrl, tableName, batch, apiVersion);
  }
  let tombstoned = 0;
  if (opts.fullTable && records.length > 0) {
    tombstoned = await tombstoneMissing(databaseUrl, tableName, records.map(r => r.sourceId), apiVersion);
  }
  console.log(`  ${tableName}: fetched=${records.length} appended=${appended} tombstoned=${tombstoned}`);
}

// Volatile fields stripped before storage to keep content_hash stable
// (see apps/connector/src/toggl/sync-masters.ts for rationale).
const VOLATILE_PROJECT_FIELDS = ['actual_hours', 'actual_seconds', 'total_count'];
const VOLATILE_WORKSPACE_FIELDS = ['last_modified'];
const VOLATILE_ME_FIELDS = ['authorization_updated_at'];

function stripFields(item, fields) {
  const out = { ...item };
  for (const f of fields) delete out[f];
  return out;
}

function toRecords(items, idField = 'id', strip = []) {
  return items.map(item => ({
    sourceId: String(item[idField]),
    data: strip.length > 0 ? stripFields(item, strip) : item,
  }));
}

// ---- main -----------------------------------------------------------------

async function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const env = loadEnv(resolve(__dirname, '..', '.env'));
  const databaseUrl = env.DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL not set');

  const credResult = await neonSql(
    databaseUrl,
    `SELECT access_token, metadata->>'workspace_id' AS workspace_id
     FROM data_warehouse.credentials WHERE service_name = $1`,
    ['toggl_track'],
  );
  const [token, workspaceId] = credResult.rows[0];
  const auth = 'Basic ' + Buffer.from(`${token}:api_token`).toString('base64');

  console.log('Syncing Toggl masters → data_warehouse_v2 (append-only)');

  // Projects / clients / tags: full-table diff (deletions tombstone)
  await appendAll(databaseUrl, 'raw_toggl_track__projects',
    toRecords(await togglGet(auth, `/workspaces/${workspaceId}/projects`), 'id', VOLATILE_PROJECT_FIELDS),
    'v9', { fullTable: true });
  await appendAll(databaseUrl, 'raw_toggl_track__clients',
    toRecords(await togglGet(auth, `/workspaces/${workspaceId}/clients`)), 'v9', { fullTable: true });
  await appendAll(databaseUrl, 'raw_toggl_track__tags',
    toRecords(await togglGet(auth, `/workspaces/${workspaceId}/tags`) || []), 'v9', { fullTable: true });

  // me / workspaces / users / groups: append only, no diff
  const me = await togglGet(auth, '/me');
  await appendAll(databaseUrl, 'raw_toggl_track__me',
    [{ sourceId: String(me.id), data: stripFields(me, VOLATILE_ME_FIELDS) }], 'v9');
  await appendAll(databaseUrl, 'raw_toggl_track__workspaces',
    toRecords(await togglGet(auth, '/workspaces') || [], 'id', VOLATILE_WORKSPACE_FIELDS), 'v9');
  await appendAll(databaseUrl, 'raw_toggl_track__users',
    toRecords(await togglGet(auth, `/workspaces/${workspaceId}/users`) || []), 'v9');
  await appendAll(databaseUrl, 'raw_toggl_track__groups',
    toRecords(await togglGet(auth, `/workspaces/${workspaceId}/groups`) || []), 'v9');

  console.log(`Done. Toggl API requests used: ${apiRequestCount}`);
}

main().catch(err => { console.error(err); process.exit(1); });
