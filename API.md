# Clubs/Teams/Matches API

**Host:** `https://mif.vercel.app` (wanneer live)  
**Database:** Turso (libSQL)  
**Data:** KNHB veldhockey clubs, teams, wedstrijdschema's

---

## Endpoints

### GET `/api/clubs`
Alle clubs + basis info.

**Response:**
```json
[
  {
    "id": "HH11AR3",
    "name": "Amsterdam",
    "city": "Amstelveen",
    "logo": "https://images.static-hw.nl/..."
  }
]
```

---

### GET `/api/clubs/:club_ref`
Alle teams van een club.

**Params:**
- `club_ref` — KNHB federation_reference_id (bijv. `HH11AR3`)

**Response:**
```json
{
  "club": {
    "id": "HH11AR3",
    "name": "Amsterdam",
    "city": "Amstelveen",
    "logo": "..."
  },
  "teams": [
    {
      "id": 771,
      "name": "Amsterdam D1",
      "category": "Senioren",
      "poule_id": 180863
    }
  ]
}
```

---

### GET `/api/teams/:team_id/matches`
Toekomstige **thuis**wedstrijden van een team.

**Params:**
- `team_id` — team-id (bijv. `771`)

**Query:**
- `days` (opt.) — max dagen vooruit (default 90)

**Response:**
```json
{
  "team_id": 771,
  "team_name": "Amsterdam D1",
  "matches": [
    {
      "id": 12345,
      "date": "2026-09-15",
      "time": "19:30",
      "home_name": "Amsterdam D1",
      "away_name": "Utrecht D1",
      "is_home": true
    }
  ]
}
```

---

## Gebruik in code

### Cliënt-zijde (bijv. MIF front-end)
```javascript
// Clubs laden
const clubs = await fetch('https://mif.vercel.app/api/clubs').then(r => r.json());

// Teams van een club
const { teams } = await fetch(`https://mif.vercel.app/api/clubs/HH11AR3`).then(r => r.json());

// Wedstrijden van een team
const { matches } = await fetch(`https://mif.vercel.app/api/teams/771/matches`).then(r => r.json());
```

### Server/Bot (bijv. RefRota, GoeieScheids)
Zelfde endpoints, geen auth nodig (publiek). Cache de response 12h voor clubs, 6h voor wedstrijden.

```javascript
const refreshClubs = async () => {
  const clubs = await fetch('https://mif.vercel.app/api/clubs').then(r => r.json());
  // store in cache / DB
};

const getMatches = async (teamId) => {
  return fetch(`https://mif.vercel.app/api/teams/${teamId}/matches`).then(r => r.json());
};
```

---

## Data-update schema

| Resource | Vernieuwd | Bron |
|---|---|---|
| Clubs | 1x per week (zaterdag 06:00) | KNHB API |
| Teams | 1x per week (zaterdag 06:00) | KNHB API |
| Wedstrijden | Dagelijks 06:00 UTC | KNHB API |

**GitHub Actions** triggert `refresh-matches.js` dagelijks.

---

## Errors

| Status | Betekenis |
|---|---|
| 200 | OK |
| 404 | Club/team niet gevonden |
| 500 | Server error (check logs) |

---

## Rate limits

Geen officiële limits (statische DB), maar:
- Max 1000 teams per call
- Max 90 dagen vooruit voor matches
- Clients mogen cachen

---

## Turso DB Schema

```sql
CREATE TABLE clubs (
  id TEXT PRIMARY KEY,              -- KNHB federation_reference_id
  name TEXT,
  city TEXT,
  logo TEXT
);

CREATE TABLE teams (
  id INTEGER PRIMARY KEY,
  club_id TEXT,
  name TEXT,
  category TEXT,
  poule_id INTEGER,
  FOREIGN KEY(club_id) REFERENCES clubs(id)
);

CREATE TABLE poules (
  id INTEGER PRIMARY KEY,
  name TEXT,
  season TEXT
);

CREATE TABLE matches (
  id INTEGER PRIMARY KEY,
  poule_id INTEGER,                 -- géén FK: poules-tabel wordt niet gevuld
  team_id INTEGER NOT NULL,
  date TEXT,
  time TEXT,
  home_name TEXT,
  away_name TEXT,
  is_home BOOLEAN,
  FOREIGN KEY(team_id) REFERENCES teams(id)
);
```

> `poules` staat in het schema maar wordt momenteel niet gevuld — hij dient
> geen functie voor de API. `matches.poule_id` heeft daarom bewust **geen**
> foreign key ernaartoe (die brak eerder elke insert: `FOREIGN KEY constraint
> failed`, want er stond niets in `poules`).

---

## Implementatie-detail: waarom HTTP en niet @libsql/client

De MIF-routes (`server/routes/turso.js`) en `refresh-matches.js` praten met
Turso via **plain `fetch()` naar de HTTP-pipeline-API** (`POST {url}/v2/pipeline`),
niet via het `@libsql/client` npm-pakket.

**Reden:** op het ontwikkelsysteem bleek `@libsql/client` (de native Node-addon)
onbetrouwbaar zodra hij draaide **in hetzelfde proces als een luisterende
Express-server**: query's met veel rijen (>~200) liepen permanent vast, en
zelfs kleinere batches op een hergebruikte client-instantie raakten corrupt
(rijen ontbraken zonder foutmelding). Dit was reproduceerbaar en onafhankelijk
van `libsql://` vs `https://` scheme, `UV_THREADPOOL_SIZE`, of client-hergebruik
vs. verse client per query. Overstappen op plain HTTP fetch (hetzelfde patroon
dat de KNHB-routes al gebruiken) loste het volledig en betrouwbaar op.

**Voor een volgende sessie:** als je ooit teruggaat naar `@libsql/client`
(bijv. voor transacties of embedded replicas), test dat eerst grondig onder
een draaiende Express-server met >200 rijen resultaten voordat je het vertrouwt.

---

## Build MIF API endpoints

**Server-side (MIF)** — zie `server/routes/turso.js` voor de volledige,
werkende implementatie. Kernpatroon:
```javascript
async function query(sql, args) {
  const stmt = args ? { sql, args: args.map(v => ({ type: typeof v === 'number' ? 'integer' : 'text', value: String(v) })) } : { sql };
  const r = await fetch(`${TURSO_HTTP_URL}/v2/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TURSO_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt }, { type: 'close' }] }),
  });
  const data = await r.json();
  const result = data.results[0];
  if (result.type === 'error') throw new Error(result.error.message);
  const { cols, rows } = result.response.result;
  return rows.map(row => Object.fromEntries(cols.map((c, i) => [c.name, row[i]?.value ?? null])));
}

// GET /api/clubs
const clubs = await query('SELECT id, name, city, logo FROM clubs ORDER BY name COLLATE NOCASE');
res.json(clubs);

// GET /api/clubs/:ref
const club = await query('SELECT * FROM clubs WHERE id = ?', [req.params.ref]);
const teams = await query('SELECT * FROM teams WHERE club_id = ?', [req.params.ref]);
res.json({ club: club.rows[0], teams: teams.rows });

// GET /api/teams/:id/matches
const matches = await db.execute(
  'SELECT * FROM matches WHERE team_id = ? AND date >= date("now") ORDER BY date LIMIT 50',
  [req.params.id]
);
res.json({ team_id: req.params.id, matches: matches.rows });
```

---

## Contact

Voor vragen/updates: zie `../README.md`
