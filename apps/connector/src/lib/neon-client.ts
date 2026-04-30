interface RawRecord {
  sourceId: string;
  data: Record<string, unknown>;
}

interface UpsertResult {
  tableName: string;
  upserted: number;
  deleted: number;
}

/**
 * Optional differential-delete window for upsertRaw.
 *
 * After upserting `records`, any row in the table whose `source_id` is NOT
 * present in `records` and whose date (extracted via `dateField` from the
 * JSONB `data` column) falls within [start, end) will be DELETEd. This
 * keeps raw in sync with "what the API currently considers valid" — without
 * it, entries the user deleted in the source system pile up forever.
 *
 * For tables without a meaningful date (masters: tags/projects/clients), set
 * `fullTable: true` to delete all source_ids not in `records`.
 */
type DiffWindow =
  | { fullTable: true }
  | { dateField: string; start: string; end: string; protectInProgress?: boolean };

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
 * Upsert raw records into a data_warehouse table.
 *
 * If `diff` is provided, performs a differential delete after the upsert:
 * rows in the configured window whose source_id is missing from `records`
 * will be removed. This keeps raw in sync when the user deletes entries in
 * the source system.
 */
function upsertRaw(
  tableName: string,
  records: RawRecord[],
  apiVersion: string,
  diff?: DiffWindow,
): UpsertResult {
  let upserted = 0;

  if (records.length > 0) {
    const batchSize = 100;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);

      const valuePlaceholders: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      for (const r of batch) {
        valuePlaceholders.push(`($${paramIdx}, $${paramIdx + 1}::jsonb, now(), $${paramIdx + 2})`);
        params.push(r.sourceId, JSON.stringify(r.data), apiVersion);
        paramIdx += 3;
      }

      const query = `
        INSERT INTO data_warehouse.${tableName} (source_id, data, synced_at, api_version)
        VALUES ${valuePlaceholders.join(', ')}
        ON CONFLICT (source_id) DO UPDATE SET
          data = EXCLUDED.data,
          synced_at = EXCLUDED.synced_at,
          api_version = EXCLUDED.api_version
      `;

      neonQuery(query, params);
      upserted += batch.length;
    }
  }

  let deleted = 0;
  if (diff) {
    if (records.length === 0) {
      // API returning zero records is far more often "transient failure /
      // empty window" than "user just deleted everything". Skipping diff
      // delete here trades one cycle of staleness for protection against
      // wiping the whole table on an API blip.
      log(`Skipping diff-delete on ${tableName}: no records returned by API`);
    } else {
      deleted = differentialDelete(tableName, records, diff);
    }
  }

  log(`Sync ${tableName}: upserted=${upserted} deleted=${deleted}`);
  return { tableName, upserted, deleted };
}

/**
 * Delete rows whose source_id is NOT in `records`. Window scope:
 *   - fullTable: delete all rows in the table not in records
 *   - dateField: delete only rows where data->>dateField falls in [start, end);
 *     if protectInProgress is true, rows with data->>'stop' IS NULL are kept
 *
 * Source_ids that ARE in records are skipped via NOT IN (...). Empty records
 * means "delete all in window" — caller must be sure that's intended.
 */
function differentialDelete(
  tableName: string,
  records: RawRecord[],
  diff: DiffWindow,
): number {
  const presentIds = records.map(r => r.sourceId);
  const params: unknown[] = [];
  let paramIdx = 1;

  let whereClause: string;
  if ('fullTable' in diff) {
    whereClause = '';
  } else {
    whereClause = `
      AND (data->>$${paramIdx})::timestamptz >= ($${paramIdx + 1})::timestamptz
      AND (data->>$${paramIdx})::timestamptz <  ($${paramIdx + 2})::timestamptz
    `;
    params.push(diff.dateField, diff.start, diff.end);
    paramIdx += 3;

    if (diff.protectInProgress) {
      whereClause += `AND (data->>'stop') IS NOT NULL `;
    }
  }

  let presentClause = '';
  if (presentIds.length > 0) {
    const placeholders = presentIds.map(() => `$${paramIdx++}`).join(',');
    presentClause = `AND source_id NOT IN (${placeholders})`;
    params.push(...presentIds);
  }

  const query = `
    DELETE FROM data_warehouse.${tableName}
    WHERE synced_at < now() - interval '5 minutes'
      ${whereClause}
      ${presentClause}
  `;

  const result = neonQuery(query, params) as { rowCount?: number; rows?: unknown[] };
  return result.rowCount ?? (result.rows ? result.rows.length : 0);
}
