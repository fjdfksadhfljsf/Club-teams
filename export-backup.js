'use strict';
// Volledige export van de Turso-database naar JSON — backup naast de live database.
// Gebruik: TURSO_URL=... TURSO_TOKEN=... node export-backup.js
const fs = require('fs');

const TURSO_URL = (process.env.TURSO_URL || '').replace(/^libsql:\/\//, 'https://');
const TURSO_TOKEN = process.env.TURSO_TOKEN;

async function query(sql) {
  const r = await fetch(`${TURSO_URL}/v2/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TURSO_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql } }, { type: 'close' }] }),
  });
  if (!r.ok) throw new Error(`Turso HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  const result = data.results?.[0];
  if (result?.type === 'error') throw new Error(result.error?.message);
  const { cols, rows } = result.response.result;
  return rows.map((row) => Object.fromEntries(cols.map((c, i) => [c.name, row[i]?.value ?? null])));
}

(async () => {
  if (!TURSO_URL || !TURSO_TOKEN) throw new Error('env TURSO_URL en TURSO_TOKEN nodig');
  console.log('Export gestart...');
  const clubs = await query('SELECT * FROM clubs ORDER BY id');
  const teams = await query('SELECT * FROM teams ORDER BY id');
  const matches = await query('SELECT * FROM matches ORDER BY id');
  console.log(`  clubs: ${clubs.length}, teams: ${teams.length}, matches: ${matches.length}`);

  const backup = {
    exported_at: new Date().toISOString(),
    counts: { clubs: clubs.length, teams: teams.length, matches: matches.length },
    clubs, teams, matches,
  };

  fs.writeFileSync('turso-backup.json', JSON.stringify(backup), 'utf8');
  const sizeMB = (fs.statSync('turso-backup.json').size / 1024 / 1024).toFixed(2);
  console.log(`✅ Backup geschreven: turso-backup.json (${sizeMB} MB)`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
