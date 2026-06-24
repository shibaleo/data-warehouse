#!/usr/bin/env node
// One-off Notion auth bootstrap.
//
// Notion PATs / Internal Integration Secrets are long-lived Bearer tokens
// with no refresh flow — there is no OAuth handshake to run. This script
// just reads NOTION_TOKEN from .env and upserts it into
// data_warehouse.credentials so the GAS connector can pick it up via
// getNotionCredentials() (apps/connector/src/notion/oauth.ts).
//
// Usage:
//   1. Put NOTION_TOKEN=secret_xxxxxxxx (or ntn_xxx PAT) into repo-root .env
//   2. node scripts/auth-notion.mjs
//
// Requires: DATABASE_URL + NOTION_TOKEN in .env. Node 18+ (built-in fetch).

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVICE_NAME = 'notion';

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

async function verifyToken(token) {
  const res = await fetch('https://api.notion.com/v1/users/me', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Notion /users/me failed (${res.status}): ${text}`);
  return JSON.parse(text);
}

async function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const env = loadEnv(resolve(__dirname, '..', '.env'));
  const token = env.NOTION_TOKEN;
  const databaseUrl = env.DATABASE_URL;
  if (!token) throw new Error('NOTION_TOKEN missing in .env');
  if (!databaseUrl) throw new Error('DATABASE_URL missing in .env');

  // Sanity: confirm the token is accepted by Notion before storing it.
  const me = await verifyToken(token);
  console.log(`Token verified. Notion identity: ${me.name ?? me.bot?.owner?.user?.name ?? me.id}`);

  await neonSql(
    databaseUrl,
    `INSERT INTO data_warehouse.credentials
       (service_name, client_id, client_secret, access_token, token_type, updated_at)
     VALUES ($1, '', '', $2, 'Bearer', now())
     ON CONFLICT (service_name) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       token_type   = EXCLUDED.token_type,
       updated_at   = now()`,
    [SERVICE_NAME, token],
  );

  console.log('Saved to data_warehouse.credentials (service_name=notion).');
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
