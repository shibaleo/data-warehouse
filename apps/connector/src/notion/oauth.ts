// Notion auth — Internal Integration Secret / user-level PAT.
//
// Notion tokens are long-lived Bearer tokens with no refresh flow, so this
// file does not implement OAuth 2.0 handshake; it only fetches the stored
// token from data_warehouse.credentials and caches it for the GAS run.
//
// Storage layout (data_warehouse.credentials):
//   service_name  = 'notion'
//   access_token  = the integration secret / PAT (used as Bearer)
//   client_id     = ''   (unused — kept for NOT NULL constraint)
//   client_secret = ''   (unused — kept for NOT NULL constraint)
//
// Database IDs are NOT secrets and live in source (see sync-strength.ts).

interface NotionCredentials {
  accessToken: string;
}

let cachedNotionCredentials: NotionCredentials | null = null;

function getNotionCredentials(): NotionCredentials {
  if (cachedNotionCredentials) return cachedNotionCredentials;

  const result = neonQuery(
    `SELECT access_token
     FROM data_warehouse.credentials
     WHERE service_name = $1`,
    ['notion']
  ) as { rows?: unknown[][] };

  if (!result.rows || result.rows.length === 0) {
    throw new Error('Notion credentials not found in data_warehouse.credentials');
  }

  cachedNotionCredentials = {
    accessToken: String(result.rows[0][0]),
  };

  return cachedNotionCredentials;
}
