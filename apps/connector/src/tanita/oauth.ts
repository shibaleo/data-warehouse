// Tanita Health Planet OAuth2 token management via Neon oauth2_credentials table

const HEALTH_PLANET_TOKEN_URL = 'https://www.healthplanet.jp/oauth/token';
const TOKEN_REFRESH_THRESHOLD_MIN = 30;

interface TanitaCredentials {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  redirectUri: string;
  expiresAt: string | null;
}

// In-memory cache for current execution
let cachedCredentials: TanitaCredentials | null = null;

function getTanitaCredentials(): TanitaCredentials {
  if (cachedCredentials) return cachedCredentials;

  const result = neonQuery(
    `SELECT client_id, client_secret, access_token, refresh_token, expires_at,
            (metadata->>'redirect_uri') as redirect_uri
     FROM data_warehouse.oauth2_credentials
     WHERE service_name = $1`,
    ['tanita_health_planet']
  ) as { fields: unknown[]; rows: unknown[][] };

  if (!result.rows || result.rows.length === 0) {
    throw new Error('Tanita credentials not found in oauth2_credentials');
  }

  const row = result.rows[0];
  cachedCredentials = {
    clientId: String(row[0]),
    clientSecret: String(row[1]),
    accessToken: String(row[2]),
    refreshToken: String(row[3]),
    expiresAt: row[4] ? String(row[4]) : null,
    redirectUri: row[5] ? String(row[5]) : '',
  };

  return cachedCredentials;
}

function refreshTanitaToken(): void {
  const creds = getTanitaCredentials();

  const response = httpFetch(HEALTH_PLANET_TOKEN_URL, {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: [
      `client_id=${creds.clientId}`,
      `client_secret=${creds.clientSecret}`,
      `refresh_token=${creds.refreshToken}`,
      `redirect_uri=${creds.redirectUri}`,
      `grant_type=refresh_token`,
    ].join('&'),
  });

  const data = JSON.parse(response.getContentText());

  if (!data.access_token) {
    throw new Error(`Token refresh failed: ${response.getContentText()}`);
  }

  // Health Planet tokens expire in 3 hours
  const expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

  // Update Neon
  neonQuery(
    `UPDATE data_warehouse.oauth2_credentials
     SET access_token = $1, expires_at = $2, updated_at = now()
     WHERE service_name = $3`,
    [data.access_token, expiresAt, 'tanita_health_planet']
  );

  // Update cache
  cachedCredentials = {
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    accessToken: data.access_token,
    refreshToken: creds.refreshToken,
    redirectUri: creds.redirectUri,
    expiresAt,
  };

  log(`Tanita token refreshed (expires: ${expiresAt})`);
}

function getTanitaAccessToken(): string {
  const creds = getTanitaCredentials();

  // Check expiry
  if (creds.expiresAt) {
    const minutesUntilExpiry = (new Date(creds.expiresAt).getTime() - Date.now()) / 1000 / 60;
    if (minutesUntilExpiry > TOKEN_REFRESH_THRESHOLD_MIN) {
      return creds.accessToken;
    }
  }

  // Refresh needed
  refreshTanitaToken();
  return cachedCredentials!.accessToken;
}
