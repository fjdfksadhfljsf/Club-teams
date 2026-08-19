'use strict';
// Standalone KNHB-dump: registreert device, haalt alle clubs + per club de teams.
// Signature-logica 1-op-1 uit MIF/server/routes/knhb.js.
const crypto = require('crypto');
const { randomUUID } = require('crypto');
const fs = require('fs');

const BASE_URL = 'https://app.hockeyweerelt.nl';
let deviceUUID = null;
let deviceApiToken = null;

function computeSignature(path, queryParams, timestamp, uuid) {
  const sanitizedPath = path.replace(/[^a-zA-Z0-9\-/]+/g, '');
  const sanitizedQuery = Object.entries(queryParams)
    .filter(([k]) => k.length > 0)
    .map(([k, v]) => {
      const sk = k.replace(/[^a-zA-Z0-9\-/=]+/g, '');
      const sv = String(v).replace(/[^a-zA-Z0-9\-/=]+/g, '');
      return `${sk}=${sv}`;
    })
    .join('');
  const reversedUUID = uuid.split('').reverse().join('');
  const input = `${timestamp}${sanitizedPath}${sanitizedQuery}${reversedUUID}`;
  return crypto.createHash('sha1').update(input).digest('hex');
}

function makeHeaders(path, queryParams = {}) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const sig = computeSignature(path, queryParams, timestamp, deviceUUID);
  return {
    'X-HAPI-Authorization': deviceApiToken ?? '',
    'X-HAPI-Timestamp': timestamp,
    'X-HAPI-Signature': sig,
    'X-HAPI-Version': '7',
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

async function registerDevice() {
  deviceUUID = randomUUID();
  deviceApiToken = null;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const sig = computeSignature('/device/register', {}, timestamp, deviceUUID);
  const r = await fetch(`${BASE_URL}/device/register`, {
    method: 'POST',
    headers: {
      'X-HAPI-Authorization': '', 'X-HAPI-Timestamp': timestamp,
      'X-HAPI-Signature': sig, 'X-HAPI-Version': '7',
      'Content-Type': 'application/json', 'Accept': 'application/json',
    },
    body: JSON.stringify({ uuid: deviceUUID, os: 'Web' }),
  });
  if (!r.ok) throw new Error(`device registratie mislukt (${r.status}): ${await r.text()}`);
  deviceApiToken = (await r.json()).token;
  console.error(`device geregistreerd: ${deviceUUID}`);
}

async function hapiGet(path, queryParams = {}, retries = 4) {
  if (!deviceApiToken) await registerDevice();
  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(queryParams)) url.searchParams.set(k, v);
  let r = await fetch(url.toString(), { headers: makeHeaders(path, queryParams) });
  if (r.status === 401) { await registerDevice(); r = await fetch(url.toString(), { headers: makeHeaders(path, queryParams) }); }
  if (r.status === 429 && retries > 0) {
    await sleep(2000);
    return hapiGet(path, queryParams, retries - 1);
  }
  if (!r.ok) throw new Error(`API fout ${r.status} voor ${path}: ${(await r.text()).slice(0,200)}`);
  return r.json();
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function main() {
  const mode = process.argv[2] || 'probe';
  const data = await hapiGet('/clubs');
  const clubs = (data.data || []).filter(c => c.type !== 'business');
  console.error(`clubs totaal (excl. business): ${clubs.length}`);

  if (mode === 'probe') {
    console.error('voorbeeld eerste 3:', JSON.stringify(clubs.slice(0,3).map(c => ({id:c.id, name:c.friendly_name, city:c.city})), null, 2));
    return;
  }

  // Full dump — clubs worden geïdentificeerd via federation_reference_id (bijv. "HH11AR3")
  // logo komt al mee in de /clubs lijst-response, dus geen extra call nodig daarvoor
  const out = [];
  let done = 0, failed = 0;
  for (const c of clubs) {
    const clubRef = c.federation_reference_id;
    try {
      const d = await hapiGet(`/clubs/${clubRef}`);
      const club = d.data || d;
      const teams = (club.teams || [])
        .filter(t => (t.hockey_type === 'VE' || !t.hockey_type) && t.recent_poule_id)
        .map(t => ({ id: t.id, name: t.name, category: t.category_group_name || '', poule_id: t.recent_poule_id }));
      out.push({ club_ref: clubRef, name: club.friendly_name || club.name || c.friendly_name, city: club.city || c.city || '', logo: c.logo || '', teams });
    } catch (e) {
      failed++;
      out.push({ club_ref: clubRef, name: c.friendly_name, city: c.city || '', logo: c.logo || '', teams: [], error: e.message });
      console.error(`  ! ${c.friendly_name}: ${e.message}`);
    }
    done++;
    if (done % 25 === 0) console.error(`  ${done}/${clubs.length} clubs...`);
    await sleep(350); // vriendelijk voor de API (verhoogd na 429's bij 120ms)
  }
  const totalTeams = out.reduce((s, c) => s + c.teams.length, 0);
  const result = {
    season: '2026/2027',
    generated_at: new Date().toISOString(),
    source: 'KNHB HAPI (app.hockeyweerelt.nl)',
    club_count: out.length,
    team_count: totalTeams,
    failed_clubs: failed,
    clubs: out.sort((a,b) => (a.name||'').localeCompare(b.name||'', 'nl')),
  };
  const outPath = process.argv[3] || 'club-teams-26-27.json';
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
  console.error(`\nKLAAR: ${out.length} clubs, ${totalTeams} teams, ${failed} mislukt -> ${outPath}`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
