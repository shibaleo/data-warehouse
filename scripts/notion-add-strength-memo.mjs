#!/usr/bin/env node
// One-off: add `memo` (rich_text) to TB__STRENGTH.
//
// 既存 property (reps / weight_kg / subject / datetime) は触らず、新規
// プロパティのみ追加。フォームの違和感 / PR 感触のメモ用。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATABASE_ID = '1d32cd76e35b8027b086fbc1d26911e0';

function loadEnv(envPath) {
  const text = readFileSync(envPath, 'utf8');
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

async function neonSql(databaseUrl, query) {
  const m = databaseUrl.match(/@([^:/]+)/);
  const res = await fetch(`https://${m[1]}/sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Neon-Connection-String': databaseUrl,
      'Neon-Raw-Text-Output': 'true',
      'Neon-Array-Mode': 'true',
    },
    body: JSON.stringify({ query, params: [] }),
  });
  if (!res.ok) throw new Error(`Neon SQL ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const env = loadEnv(resolve(__dirname, '..', '.env'));
  const databaseUrl = env.DATABASE_URL;

  const cred = await neonSql(
    databaseUrl,
    `SELECT access_token FROM data_warehouse.credentials WHERE service_name = 'notion'`,
  );
  const token = cred.rows[0][0];

  const res = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ properties: { memo: { rich_text: {} } } }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Notion update failed (${res.status}): ${text}`);

  const parsed = JSON.parse(text);
  console.log('Updated DB properties:');
  for (const [name, def] of Object.entries(parsed.properties)) {
    console.log(`  ${name.padEnd(20)} ${def.type}`);
  }
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
