'use strict';

const TURSO_HTTP_URL = (process.env.TURSO_URL || '').replace(/^libsql:\/\//, 'https://');
const TURSO_TOKEN = process.env.TURSO_TOKEN;

// Praat rechtstreeks met Turso's HTTP-pipeline-API via fetch() — bewust GEEN
// @libsql/client, dat bleek onbetrouwbaar zodra het naast een luisterende
// server draait (zie Takie/Club-teams 26-27/API.md voor de volledige uitleg).
async function query(sql, args) {
  if (!TURSO_HTTP_URL || !TURSO_TOKEN) throw new Error('TURSO_URL/TURSO_TOKEN ontbreken');
  const stmt = args
    ? { sql, args: args.map((v) => ({ type: typeof v === 'number' ? 'integer' : 'text', value: String(v) })) }
    : { sql };
  const r = await fetch(`${TURSO_HTTP_URL}/v2/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TURSO_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt }, { type: 'close' }] }),
  });
  if (!r.ok) throw new Error(`Turso HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  const result = data.results?.[0];
  if (result?.type === 'error') throw new Error(result.error?.message || 'Turso query error');
  const { cols, rows } = result.response.result;
  return rows.map((row) => Object.fromEntries(cols.map((c, i) => [c.name, row[i]?.value ?? null])));
}

function withCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = { query, withCors };
