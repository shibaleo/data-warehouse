interface RawRecord {
  sourceId: string;
  data: Record<string, unknown>;
}

interface AppendResult {
  tableName: string;
  appended: number;   // new revisions inserted (content change OR new entity)
  tombstoned: number; // diff-delete tombstones inserted
}

/**
 * Optional differential-delete window for appendRaw.
 *
 * After appending, any row whose source_id is currently "live" (latest
 * revision has deleted=false) but does NOT appear in the just-fetched
 * records gets a tombstone revision (deleted=true) appended. This keeps
 * the *_current view in sync with what the API considers valid.
 *
 * For tables without a meaningful date (masters: tags/projects/clients),
 * use { fullTable: true }. For time-entry tables, use a date window so
 * deletes outside the just-synced range are not accidentally tombstoned.
 */
type DiffWindow =
  | { fullTable: true }
  | { dateField: string; start: string; end: string; protectInProgress?: boolean };

const RAW_SCHEMA = 'data_warehouse_v2';

/** Extract hostname from DATABASE_URL for the SQL over HTTP endpoint */
function getNeonSqlEndpoint(): string {
  const config = getConfig();
  const match = config.neonDatabaseUrl.match(/@([^:/]+)/);
  if (!match) throw new Error('Cannot parse hostname from DATABASE_URL');
  return `https://${match[1]}/sql`;
}

/** Execute SQL via Neon SQL over HTTP */
function neonQuery(query: string, params: unknown[] = []): unknown {
  const config = getConfig();
  const endpoint = getNeonSqlEndpoint();

  const response = httpFetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Neon-Connection-String': config.neonDatabaseUrl,
      'Neon-Raw-Text-Output': 'true',
      'Neon-Array-Mode': 'true',
    },
    payload: JSON.stringify({ query, params }),
  });

  return JSON.parse(response.getContentText());
}

/**
 * Append-only write into a data_warehouse_v2 raw table.
 *
 * Semantics:
 *   - For each record, compare md5((data - 'at')::text) to the latest
 *     revision's content_hash. If different OR latest is deleted, INSERT a
 *     new row with revision = latest + 1 and deleted = false. Else no-op.
 *   - Hash is computed in PostgreSQL (not JS) so backfill and runtime
 *     produce identical canonicalisation — the migration's `synced_at →
 *     revision=1` snapshot stays consistent with subsequent appends.
 *   - The `at` field is stripped from the hash because Toggl bumps it on
 *     every fetch even when no real change happened; including it would
 *     create a new revision every hour for every entry.
 *
 * If `diff` is provided, also tombstones source_ids that have disappeared
 * from the API response within the configured window.
 */
function appendRaw(
  tableName: string,
  records: RawRecord[],
  apiVersion: string,
  diff?: DiffWindow,
): AppendResult {
  let appended = 0;

  if (records.length > 0) {
    const batchSize = 100;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      appended += appendBatch(tableName, batch, apiVersion);
    }
  }

  let tombstoned = 0;
  if (diff) {
    if (records.length === 0) {
      // Empty API response is far more often a transient blip than a real
      // wholesale deletion. Skip tombstoning to avoid burying the table.
      log(`Skipping diff-tombstone on ${tableName}: no records returned by API`);
    } else {
      tombstoned = tombstoneMissing(tableName, records, apiVersion, diff);
    }
  }

  log(`Sync ${tableName}: appended=${appended} tombstoned=${tombstoned}`);
  return { tableName, appended, tombstoned };
}

/**
 * Insert new revisions for a batch. Each row goes in only if its hash
 * differs from the current latest, or the current latest is deleted (= a
 * restore should land as a fresh revision).
 *
 * The query uses a single round trip per batch; revision numbers are
 * computed server-side from the latest existing row per source_id.
 */
function appendBatch(tableName: string, batch: RawRecord[], apiVersion: string): number {
  const valuePlaceholders: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  for (const r of batch) {
    valuePlaceholders.push(`($${p}, $${p + 1}::jsonb, $${p + 2})`);
    params.push(r.sourceId, JSON.stringify(r.data), apiVersion);
    p += 3;
  }

  const query = `
    WITH input(source_id, data, api_version) AS (
      VALUES ${valuePlaceholders.join(', ')}
    ),
    input_hashed AS (
      SELECT
        source_id,
        data,
        api_version,
        md5((data - 'at')::text) AS new_hash
      FROM input
    ),
    latest AS (
      SELECT DISTINCT ON (source_id)
        source_id, revision, content_hash, deleted
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
      WHERE l.source_id IS NULL                 -- never seen before
         OR l.deleted = true                    -- restoring a tombstoned entity
         OR l.content_hash IS DISTINCT FROM i.new_hash
      RETURNING 1
    )
    SELECT count(*) AS appended FROM inserted
  `;

  const result = neonQuery(query, params) as { rows?: unknown[][] };
  if (!result.rows || result.rows.length === 0) return 0;
  // Neon-Array-Mode + Raw-Text-Output → rows[0][0] is a string
  return parseInt(String(result.rows[0][0]), 10) || 0;
}

/**
 * Append a tombstone revision for every "currently live" row that is no
 * longer in the just-fetched API response within the configured window.
 *
 * The carry-forward of `data` and `content_hash` from the latest revision
 * is intentional: tombstones describe lifecycle ("we observed this gone"),
 * not new content. Consumers that want the last known body can read the
 * tombstone row directly.
 *
 * Safety:
 *   - 5-minute grace on `created_at` prevents nuking rows another sync
 *     just inserted concurrently
 *   - protectInProgress (Track v9) keeps stop-IS-NULL rows alive — those
 *     are running timers, not deletions
 */
function tombstoneMissing(
  tableName: string,
  records: RawRecord[],
  apiVersion: string,
  diff: DiffWindow,
): number {
  const presentIds = records.map(r => r.sourceId);
  const params: unknown[] = [apiVersion];
  let p = 2;

  let windowClause = '';
  if (!('fullTable' in diff)) {
    windowClause = `
      AND (cur.data->>$${p})::timestamptz >= ($${p + 1})::timestamptz
      AND (cur.data->>$${p})::timestamptz <  ($${p + 2})::timestamptz
    `;
    params.push(diff.dateField, diff.start, diff.end);
    p += 3;

    if (diff.protectInProgress) {
      windowClause += `AND (cur.data->>'stop') IS NOT NULL `;
    }
  }

  let presentClause = '';
  if (presentIds.length > 0) {
    const placeholders = presentIds.map(() => `$${p++}`).join(',');
    presentClause = `AND cur.source_id NOT IN (${placeholders})`;
    params.push(...presentIds);
  }

  const query = `
    WITH targets AS (
      SELECT cur.source_id, cur.data, cur.content_hash, cur.revision
      FROM ${RAW_SCHEMA}.${tableName}_current cur
      WHERE cur.created_at < now() - interval '5 minutes'
        ${windowClause}
        ${presentClause}
    ),
    tombstones AS (
      INSERT INTO ${RAW_SCHEMA}.${tableName}
        (source_id, revision, data, content_hash, deleted, purged, api_version)
      SELECT
        t.source_id,
        t.revision + 1,
        t.data,
        t.content_hash,
        true,
        false,
        $1
      FROM targets t
      RETURNING 1
    )
    SELECT count(*) AS tombstoned FROM tombstones
  `;

  const result = neonQuery(query, params) as { rows?: unknown[][] };
  if (!result.rows || result.rows.length === 0) return 0;
  return parseInt(String(result.rows[0][0]), 10) || 0;
}
