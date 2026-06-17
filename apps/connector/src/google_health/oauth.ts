// Google Health API OAuth2 token management.
//
// Notes:
//   - Token endpoint: oauth2.googleapis.com/token
//   - Refresh request is form-encoded with client_id/client_secret in the
//     body (not HTTP Basic auth)
//   - Access tokens expire in 1 hour → refresh threshold is 10 min before expiry
//   - service_name in data_warehouse.credentials is 'google_health'

const GOOGLE_HEALTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_HEALTH_TOKEN_REFRESH_THRESHOLD_MIN = 10;

interface GoogleHealthCredentials {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string | null;
}

let cachedGoogleHealthCredentials: GoogleHealthCredentials | null = null;

function getGoogleHealthCredentials(): GoogleHealthCredentials {
  if (cachedGoogleHealthCredentials) return cachedGoogleHealthCredentials;

  const result = neonQuery(
    `SELECT client_id, client_secret, access_token, refresh_token, expires_at
     FROM data_warehouse.credentials
     WHERE service_name = $1`,
    ['google_health']
  ) as { fields: unknown[]; rows: unknown[][] };

  if (!result.rows || result.rows.length === 0) {
    throw new Error('Google Health credentials not found in data_warehouse.credentials');
  }

  const row = result.rows[0];
  cachedGoogleHealthCredentials = {
    clientId: String(row[0]),
    clientSecret: String(row[1]),
    accessToken: String(row[2]),
    refreshToken: String(row[3]),
    expiresAt: row[4] ? String(row[4]) : null,
  };

  return cachedGoogleHealthCredentials;
}

function refreshGoogleHealthToken(): void {
  const creds = getGoogleHealthCredentials();

  const payload = `client_id=${encodeURIComponent(creds.clientId)}` +
    `&client_secret=${encodeURIComponent(creds.clientSecret)}` +
    `&refresh_token=${encodeURIComponent(creds.refreshToken)}` +
    `&grant_type=refresh_token`;

  const response = httpFetch(GOOGLE_HEALTH_TOKEN_URL, {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload,
  });

  const data = JSON.parse(response.getContentText()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!data.access_token) {
    throw new Error(`Google Health token refresh failed: ${response.getContentText()}`);
  }

  const expiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString();
  // Google may or may not rotate the refresh_token; keep the old one if not returned.
  const newRefreshToken = data.refresh_token ?? creds.refreshToken;

  neonQuery(
    `UPDATE data_warehouse.credentials
     SET access_token = $1, refresh_token = $2, expires_at = $3, updated_at = now()
     WHERE service_name = $4`,
    [data.access_token, newRefreshToken, expiresAt, 'google_health']
  );

  cachedGoogleHealthCredentials = {
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    accessToken: data.access_token,
    refreshToken: newRefreshToken,
    expiresAt,
  };

  log(`Google Health token refreshed (expires: ${expiresAt})`);
}

function getGoogleHealthAccessToken(): string {
  const creds = getGoogleHealthCredentials();

  if (creds.expiresAt) {
    const minutesUntilExpiry = (new Date(creds.expiresAt).getTime() - Date.now()) / 1000 / 60;
    if (minutesUntilExpiry > GOOGLE_HEALTH_TOKEN_REFRESH_THRESHOLD_MIN) {
      return creds.accessToken;
    }
  }

  refreshGoogleHealthToken();
  return cachedGoogleHealthCredentials!.accessToken;
}
