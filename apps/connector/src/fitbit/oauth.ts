// Fitbit OAuth2 token management via Neon oauth2_credentials table

const FITBIT_TOKEN_URL = 'https://api.fitbit.com/oauth2/token';
const TOKEN_REFRESH_THRESHOLD_MIN = 60;

interface FitbitCredentials {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string | null;
}

// In-memory cache for current execution
let cachedCredentials: FitbitCredentials | null = null;

function getFitbitCredentials(): FitbitCredentials {
  if (cachedCredentials) return cachedCredentials;

  const result = neonQuery(
    `SELECT client_id, client_secret, access_token, refresh_token, expires_at
     FROM data_warehouse.oauth2_credentials
     WHERE service_name = $1`,
    ['fitbit']
  ) as { fields: unknown[]; rows: unknown[][] };

  if (!result.rows || result.rows.length === 0) {
    throw new Error('Fitbit credentials not found in oauth2_credentials');
  }

  const row = result.rows[0];
  cachedCredentials = {
    clientId: String(row[0]),
    clientSecret: String(row[1]),
    accessToken: String(row[2]),
    refreshToken: String(row[3]),
    expiresAt: row[4] ? String(row[4]) : null,
  };

  return cachedCredentials;
}

function refreshFitbitToken(): void {
  const creds = getFitbitCredentials();
  const encoded = Utilities.base64Encode(`${creds.clientId}:${creds.clientSecret}`);

  const response = httpFetch(FITBIT_TOKEN_URL, {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    headers: { 'Authorization': `Basic ${encoded}` },
    payload: `grant_type=refresh_token&refresh_token=${creds.refreshToken}`,
  });

  const data = JSON.parse(response.getContentText());

  if (!data.access_token) {
    throw new Error(`Token refresh failed: ${response.getContentText()}`);
  }

  // Fitbit tokens expire in 8 hours
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();

  // Update Neon
  neonQuery(
    `UPDATE data_warehouse.oauth2_credentials
     SET access_token = $1, refresh_token = $2, expires_at = $3, updated_at = now()
     WHERE service_name = $4`,
    [data.access_token, data.refresh_token, expiresAt, 'fitbit']
  );

  // Update cache
  cachedCredentials = {
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
  };

  log(`Fitbit token refreshed (expires: ${expiresAt})`);
}

function getFitbitAccessToken(): string {
  const creds = getFitbitCredentials();

  // Check expiry
  if (creds.expiresAt) {
    const minutesUntilExpiry = (new Date(creds.expiresAt).getTime() - Date.now()) / 1000 / 60;
    if (minutesUntilExpiry > TOKEN_REFRESH_THRESHOLD_MIN) {
      return creds.accessToken;
    }
  }

  // Refresh needed
  refreshFitbitToken();
  return cachedCredentials!.accessToken;
}
