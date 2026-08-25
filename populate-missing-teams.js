'use strict';
// Eenmalig herstelscript: vult teams van clubs die nog 0 teams hebben in Turso.
// Praat met de live KNHB HAPI (zelfde signing-logica als refresh-matches.js) en
// schrijft naar Turso via de HTTP-pipeline (fetch), niet @libsql/client — zie README.md.
const crypto = require('crypto');
const { randomUUID } = require('crypto');

const BASE_URL = 'https://app.hockeyweerelt.nl';
const TURSO_URL = (process.env.TURSO_URL || '').replace(/^libsql:\/\//, 'https://');
const TURSO_TOKEN = process.env.TURSO_TOKEN;

let deviceUUID = null, deviceApiToken = null;

function sig(path, q, ts, uuid) {
  const sp = path.replace(/[^a-zA-Z0-9\-/]+/g, '');
  const sq = Object.entries(q).filter(([k]) => k.length > 0)
    .map(([k, v]) => `${k.replace(/[^a-zA-Z0-9\-/=]+/g, '')}=${String(v).replace(/[^a-zA-Z0-9\-/=]+/g, '')}`).join('');
  return crypto.createHash('sha1').update(`${ts}${sp}${sq}${uuid.split('').reverse().join('')}`).digest('hex');
}
function H(path, q = {}) {
  const ts = Math.floor(Date.now() / 1000).toString();
  return { 'X-HAPI-Authorization': deviceApiToken ?? '', 'X-HAPI-Timestamp': ts, 'X-HAPI-Signature': sig(path, q, ts, deviceUUID), 'X-HAPI-Version': '7', 'Content-Type': 'application/json', 'Accept': 'application/json' };
}
async function reg() {
  deviceUUID = randomUUID(); deviceApiToken = null;
  const ts = Math.floor(Date.now() / 1000).toString();
  const s = sig('/device/register', {}, ts, deviceUUID);
  const r = await fetch(`${BASE_URL}/device/register`, { method: 'POST', headers: { 'X-HAPI-Authorization': '', 'X-HAPI-Timestamp': ts, 'X-HAPI-Signature': s, 'X-HAPI-Version': '7', 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify({ uuid: deviceUUID, os: 'Web' }) });
  deviceApiToken = (await r.json()).token;
}
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
async function get(path, attempt = 0) {
  if (!deviceApiToken) await reg();
  let r = await fetch(new URL(path, BASE_URL).toString(), { headers: H(path) });
  if (r.status === 401) { await reg(); r = await fetch(new URL(path, BASE_URL).toString(), { headers: H(path) }); }
  if (r.status === 429) { if (attempt >= 6) throw new Error('429 max'); const w = 1000 * Math.pow(2, attempt); await sleep(w); return get(path, attempt + 1); }
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
}

async function tursoQuery(sql, args) {
  const stmt = args ? { sql, args: args.map((v) => ({ type: typeof v === 'number' ? 'integer' : 'text', value: String(v) })) } : { sql };
  const r = await fetch(`${TURSO_URL}/v2/pipeline`, {
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

async function main() {
  if (!TURSO_URL || !TURSO_TOKEN) throw new Error('env TURSO_URL/TURSO_TOKEN nodig');
  console.log('Zoek clubs zonder teams...');

  const clubs = await tursoQuery(
    `SELECT c.id, c.name FROM clubs c WHERE (SELECT COUNT(*) FROM teams t WHERE t.club_id = c.id) = 0`
  );
  console.log(`  ${clubs.length} clubs zonder teams gevonden`);

  let totalInserted = 0, failed = 0;
  for (let i = 0; i < clubs.length; i++) {
    const club = clubs[i];
    try {
      const data = await get(`/clubs/${club.id}`);
      const clubData = data.data || data;
      const teams = (clubData.teams || [])
        .filter((t) => (t.hockey_type === 'VE' || !t.hockey_type) && t.recent_poule_id);

      for (const t of teams) {
        await tursoQuery(
          `INSERT OR REPLACE INTO teams (id, club_id, name, category, poule_id) VALUES (?, ?, ?, ?, ?)`,
          [t.id, club.id, t.name || '', t.category_group_name || '', t.recent_poule_id]
        );
        totalInserted++;
      }
      console.log(`  [${i + 1}/${clubs.length}] ${club.name}: ${teams.length} teams`);
    } catch (e) {
      failed++;
      console.error(`  ! ${club.name} (${club.id}): ${e.message}`);
    }
    await sleep(300);
  }

  console.log(`\n✅ KLAAR: ${totalInserted} teams toegevoegd, ${failed} clubs mislukt`);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
