interface RawRecord {
  sourceId: string;
  data: Record<string, unknown>;
}

interface UpsertResult {
  tableName: string;
  count: number;
}

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

/** Upsert raw records into a data_warehouse table */
function upsertRaw(tableName: string, records: RawRecord[], apiVersion: string): UpsertResult {
  if (records.length === 0) {
    return { tableName, count: 0 };
  }

  const batchSize = 100;
  let totalUpserted = 0;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);

    // Build parameterized INSERT ... ON CONFLICT
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
    totalUpserted += batch.length;
  }

  log(`Upserted ${totalUpserted} records to ${tableName}`);
  return { tableName, count: totalUpserted };
}
