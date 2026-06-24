#!/usr/bin/env node
// One-off probe: fetch a few rows from TB__ORGASM to inspect the raw shape
// before designing the warehouse schema.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATABASE_ID = '2a62cd76e35b8092bfcedadc537c9efc';

function loadEnv(envPath) {
  const text = readFileSync(envPath, 'utf8');
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

async function neonSql(databaseUrl, query, params = []) {
  const m = databaseUrl.match(/@([^:/]+)/);
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

async function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const env = loadEnv(resolve(__dirname, '..', '.env'));
  const databaseUrl = env.DATABASE_URL;

  const cred = await neonSql(
    databaseUrl,
    `SELECT access_token FROM data_warehouse.credentials WHERE service_name = 'notion'`
  );
  const token = cred.rows[0][0];

  const res = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ page_size: 3 }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`Notion query failed (${res.status}): ${text}`);
    process.exit(1);
  }
  const data = JSON.parse(text);
  console.log(`Total in page: ${data.results.length} / has_more=${data.has_more}`);
  console.log('---');
  for (const page of data.results) {
    console.log(JSON.stringify({
      id: page.id,
      created_time: page.created_time,
      last_edited_time: page.last_edited_time,
      archived: page.archived,
      properties: page.properties,
    }, null, 2));
    console.log('---');
  }
}

main().catch(e => { console.error(e.stack || e.message); process.exit(1); });
