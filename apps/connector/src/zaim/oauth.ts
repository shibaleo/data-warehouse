// Zaim OAuth 1.0a authentication for GAS
// Tokens never expire — no refresh needed

const ZAIM_API_BASE = 'https://api.zaim.net/v2';

interface ZaimCredentials {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

let cachedZaimCredentials: ZaimCredentials | null = null;

function getZaimCredentials(): ZaimCredentials {
  if (cachedZaimCredentials) return cachedZaimCredentials;

  const result = neonQuery(
    `SELECT client_id, client_secret, access_token,
            (metadata->>'access_token_secret') as access_token_secret
     FROM data_warehouse.credentials
     WHERE service_name = $1`,
    ['zaim']
  ) as { fields: unknown[]; rows: unknown[][] };

  if (!result.rows || result.rows.length === 0) {
    throw new Error('Zaim credentials not found in credentials');
  }

  const row = result.rows[0];
  cachedZaimCredentials = {
    consumerKey: String(row[0]),
    consumerSecret: String(row[1]),
    accessToken: String(row[2]),
    accessTokenSecret: String(row[3]),
  };

  return cachedZaimCredentials;
}

// ---------------------------------------------------------------------------
// OAuth 1.0a signature generation
// ---------------------------------------------------------------------------

function zaimPercentEncode(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

function zaimGenerateNonce(): string {
  return Utilities.getUuid().replace(/-/g, '');
}

function zaimGenerateTimestamp(): string {
  return Math.floor(Date.now() / 1000).toString();
}

function zaimGenerateSignature(
  method: string,
  url: string,
  allParams: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string
): string {
  // Sort parameters alphabetically
  const sortedParams = Object.keys(allParams)
    .sort()
    .map((key) => `${zaimPercentEncode(key)}=${zaimPercentEncode(allParams[key])}`)
    .join('&');

  const baseString = [
    method.toUpperCase(),
    zaimPercentEncode(url),
    zaimPercentEncode(sortedParams),
  ].join('&');

  const signingKey = `${zaimPercentEncode(consumerSecret)}&${zaimPercentEncode(tokenSecret)}`;

  const signatureBytes = Utilities.computeHmacSignature(
    Utilities.MacAlgorithm.HMAC_SHA_1,
    baseString,
    signingKey
  );

  return Utilities.base64Encode(signatureBytes);
}

function zaimOAuthHeader(
  method: string,
  url: string,
  queryParams: Record<string, string> = {}
): string {
  const creds = getZaimCredentials();

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: zaimGenerateNonce(),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: zaimGenerateTimestamp(),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  };

  // Combine OAuth params and query params for signature
  const allParams = { ...oauthParams, ...queryParams };

  const signature = zaimGenerateSignature(
    method,
    url,
    allParams,
    creds.consumerSecret,
    creds.accessTokenSecret
  );

  oauthParams['oauth_signature'] = signature;

  // Build Authorization header
  const headerParams = Object.keys(oauthParams)
    .sort()
    .map((key) => `${zaimPercentEncode(key)}="${zaimPercentEncode(oauthParams[key])}"`)
    .join(', ');

  return `OAuth ${headerParams}`;
}
