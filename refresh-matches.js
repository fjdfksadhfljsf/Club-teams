'use strict';
// Dagelijks refresh: haalt alle wedstrijden van KNHB op en zet ze in Turso.
// Praat rechtstreeks met Turso's HTTP-pipeline-API (fetch), geen @libsql/client
// nodig — dat voorkomt afhankelijkheid van de native addon en werkt overal
// hetzelfde (lokaal, GitHub Actions, Vercel).
const crypto = require('crypto');
const { randomUUID } = require('crypto');

const BASE_URL = 'https://app.hockeyweerelt.nl';
const TURSO_URL = (process.env.TURSO_URL || 'libsql://knhb-matchen-fjdfksadhfljsf.aws-eu-west-1.turso.io').replace(/^libsql:\/\//, 'https://');
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

// -- Turso HTTP pipeline helper --
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
  if (!TURSO_TOKEN) throw new Error('env TURSO_TOKEN nodig');
  console.log('Refresh wedstrijden...');

  const teams = await tursoQuery('SELECT id, poule_id FROM teams WHERE poule_id IS NOT NULL');
  console.log(`  ${teams.length} teams gevonden`);

  let inserted = 0, failed = 0;
  const vandaag = new Date().toISOString().split('T')[0];
  for (let i = 0; i < teams.length; i++) {
    const teamId = teams[i].id, pouleId = teams[i].poule_id;

    try {
      const data = await get(`/poules/${pouleId}/teams/${teamId}`);
      const payload = data.data || data;
      const matches = payload.poule?.matches || [];

      for (const m of matches) {
        const dateStr = (m.date || '').split('T')[0];
        if (dateStr < vandaag) continue; // skip verleden
        const timeStr = m.date?.includes('T') ? m.date.split('T')[1].slice(0, 5) : '';
        const isHome = String(m.home?.id) === String(teamId);
        if (!isHome) continue; // alleen thuis

        try {
          await tursoQuery(
            `INSERT OR REPLACE INTO matches (id, poule_id, team_id, date, time, home_name, away_name, is_home) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [m.id, pouleId, teamId, dateStr, timeStr, m.home?.name || '', m.away?.name || '', isHome ? 1 : 0]
          );
          inserted++;
        } catch (e) { console.error(`    ! insert match ${m.id}: ${e.message}`); }
      }
    } catch (e) {
      failed++;
      console.error(`  ! team ${teamId}: ${e.message}`);
    }

    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${teams.length} teams verwerkt, ${inserted} wedstrijden tot nu toe`);
    await sleep(250);
  }

  console.log(`\n✅ KLAAR: ${inserted} wedstrijden opgeslagen, ${failed} teams mislukt`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
