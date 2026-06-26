#!/usr/bin/env node
// Generic Notion DB probe: prints DB schema (property names + types) and
// 3 sample rows. Usage: node scripts/probe-notion-db.mjs <database_id>

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  const dbId = process.argv[2];
  if (!dbId) { console.error('usage: probe-notion-db.mjs <database_id>'); process.exit(2); }

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const env = loadEnv(resolve(__dirname, '..', '.env'));
  const databaseUrl = env.DATABASE_URL;

  const cred = await neonSql(
    databaseUrl,
    `SELECT access_token FROM data_warehouse.credentials WHERE service_name = 'notion'`
  );
  const token = cred.rows[0][0];
  const headers = {
    Authorization: `Bearer ${token}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };

  // 1. DB schema
  const dbRes = await fetch(`https://api.notion.com/v1/databases/${dbId}`, { headers });
  const dbText = await dbRes.text();
  if (!dbRes.ok) { console.error(`DB fetch failed ${dbRes.status}: ${dbText}`); process.exit(1); }
  const db = JSON.parse(dbText);
  console.log(`# DB: ${(db.title || []).map(t => t.plain_text).join('')}  (id=${db.id})`);
  console.log('## Schema');
  for (const [name, prop] of Object.entries(db.properties)) {
    let extra = '';
    if (prop.type === 'select' || prop.type === 'multi_select') {
      extra = ' opts=[' + (prop[prop.type].options || []).map(o => o.name).join(', ') + ']';
    } else if (prop.type === 'formula') {
      extra = ` -> ${prop.formula.expression}`;
    } else if (prop.type === 'rollup') {
      extra = ` rollup ${JSON.stringify(prop.rollup)}`;
    } else if (prop.type === 'relation') {
      extra = ` -> db ${prop.relation.database_id}`;
    } else if (prop.type === 'number') {
      extra = ` (${prop.number.format})`;
    }
    console.log(`  - ${name}: ${prop.type}${extra}`);
  }

  // 2. Sample rows
  const qRes = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST', headers,
    body: JSON.stringify({ page_size: 3, sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }] }),
  });
  const qText = await qRes.text();
  if (!qRes.ok) { console.error(`Query failed ${qRes.status}: ${qText}`); process.exit(1); }
  const data = JSON.parse(qText);
  console.log(`\n## Sample (latest ${data.results.length}, has_more=${data.has_more})`);
  for (const page of data.results) {
    console.log('---');
    console.log(JSON.stringify({
      id: page.id,
      created_time: page.created_time,
      last_edited_time: page.last_edited_time,
      archived: page.archived,
      properties: page.properties,
    }, null, 2));
  }
}

main().catch(e => { console.error(e.stack || e.message); process.exit(1); });
