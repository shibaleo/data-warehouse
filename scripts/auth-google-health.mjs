#!/usr/bin/env node
// One-off Google Health API OAuth bootstrap.
//
// Usage:
//   node scripts/auth-google-health.mjs url        # print the authorization URL
//   node scripts/auth-google-health.mjs exchange <code>
//                                                 # exchange auth code → tokens,
//                                                 # then upsert into data_warehouse.credentials
//                                                 # with service_name='google_health'
//
// Flow:
//   1. Run `node scripts/auth-google-health.mjs url`
//   2. Open the printed URL in a browser, log in with the Google account that
//      owns the Fitbit data, accept the consent screen.
//   3. After redirect, the address bar shows
//        https://www.google.com/?code=4/0AX...&scope=...
//      Copy the value of `code` (URL-decode if needed).
//   4. Run `node scripts/auth-google-health.mjs exchange <code>`
//
// Requires: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, DATABASE_URL in repo-root .env.
// Node 18+ (built-in fetch). Zero npm deps.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REDIRECT_URI = 'https://www.google.com';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SERVICE_NAME = 'google_health';

// All the scopes our connector needs. Sleep / activity / health metrics cover
// the 8 entities currently synced from Fitbit (sleep, activity, heart rate,
// hrv, spo2, breathing rate, cardio score, skin temp). location is optional
// — included so GPS-bearing activities are usable later.
const SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  'https://www.googleapis.com/auth/googlehealth.location.readonly',
];

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
  if (!res.ok) throw new Error(`Neon SQL ${res.status}: ${await res.text()}`);
  return res.json();
}

function buildAuthUrl(clientId) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',     // <- required to get a refresh_token
    prompt: 'consent',          // <- force consent screen so refresh_token is always issued
    include_granted_scopes: 'true',
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function exchangeCode(clientId, clientSecret, code) {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Token exchange failed (${res.status}): ${text}`);
  return JSON.parse(text);
}

async function saveCredentials(databaseUrl, clientId, clientSecret, tokens) {
  const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();
  await neonSql(
    databaseUrl,
    `INSERT INTO data_warehouse.credentials
       (service_name, client_id, client_secret, access_token, refresh_token,
        token_type, expires_at, scope, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (service_name) DO UPDATE SET
       client_id = EXCLUDED.client_id,
       client_secret = EXCLUDED.client_secret,
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       token_type = EXCLUDED.token_type,
       expires_at = EXCLUDED.expires_at,
       scope = EXCLUDED.scope,
       updated_at = now()`,
    [
      SERVICE_NAME,
      clientId,
      clientSecret,
      tokens.access_token,
      tokens.refresh_token ?? null,
      tokens.token_type ?? 'Bearer',
      expiresAt,
      tokens.scope ?? SCOPES.join(' '),
    ],
  );
  return expiresAt;
}

async function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const env = loadEnv(resolve(__dirname, '..', '.env'));
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const databaseUrl = env.DATABASE_URL;
  if (!clientId || !clientSecret) throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing in .env');
  if (!databaseUrl) throw new Error('DATABASE_URL missing in .env');

  const cmd = process.argv[2];

  if (cmd === 'url') {
    const url = buildAuthUrl(clientId);
    console.log('\nOpen this URL in a browser:\n');
    console.log(url);
    console.log('\nAfter consent you will be redirected to https://www.google.com/?code=...');
    console.log('Copy the value of the `code` query parameter, then run:');
    console.log('  node scripts/auth-google-health.mjs exchange <code>\n');
    return;
  }

  if (cmd === 'exchange') {
    const code = process.argv[3];
    if (!code) throw new Error('Usage: node scripts/auth-google-health.mjs exchange <code>');
    const tokens = await exchangeCode(clientId, clientSecret, decodeURIComponent(code));
    if (!tokens.refresh_token) {
      console.error('WARNING: response did not include refresh_token. This usually means the consent screen was bypassed.');
      console.error('Revoke access at https://myaccount.google.com/permissions and retry with `prompt=consent` (already set).');
    }
    const expiresAt = await saveCredentials(databaseUrl, clientId, clientSecret, tokens);
    console.log('Saved to data_warehouse.credentials (service_name=google_health).');
    console.log(`  access_token expires at: ${expiresAt}`);
    console.log(`  refresh_token: ${tokens.refresh_token ? 'stored' : 'NOT received'}`);
    console.log(`  scope: ${tokens.scope}`);
    return;
  }

  console.error('Usage:');
  console.error('  node scripts/auth-google-health.mjs url');
  console.error('  node scripts/auth-google-health.mjs exchange <code>');
  process.exit(1);
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
