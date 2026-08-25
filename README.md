# KNHB API

Publieke, read-only API voor KNHB veldhockey clubs, teams en thuiswedstrijden.
Data komt uit een Turso-database die elke ochtend automatisch ververst wordt
vanuit de KNHB. Gebouwd voor moetikfluiten.nl (MIF), maar bruikbaar door elke
bot of app die deze data nodig heeft.

**Live**: https://knhb-api.vercel.app

## Wat staat waar

Dit is nu één map met alles erin (voorheen verdeeld over `Club-teams 26-27`
en `knhb-api` — samengevoegd op 2026-08-25):

- `api/` + `lib/` — de live Vercel serverless API (wat op knhb-api.vercel.app draait)
- `refresh-matches.js` — het dagelijkse refresh-script (KNHB → Turso)
- `.github/workflows/refresh-knhb.yml` — GitHub Actions cron die refresh-matches.js elke dag om 06:00 UTC draait
- `turso-backup.json` — volledige JSON-export van de database (backup, handmatig te vernieuwen)
- `.vercel/` — lokale Vercel-projectkoppeling (niet in git, per machine anders)

## Endpoints

### `GET /api/clubs`
Alle clubs. Geen query-parameters (327 clubs, klein genoeg om in één keer te laden).
```json
[{ "id": "HH11AA4", "name": "Abcoude", "city": "Abcoude", "logo": "https://..." }]
```

### `GET /api/clubs/:ref`
Eén club + al zijn teams. `:ref` is de `federation_reference_id` (bijv. `HH11AR3`), niet een numeriek id.
```json
{
  "club": { "id": "HH11AR3", "name": "Amsterdam", "city": "Amsterdam", "logo": "https://..." },
  "teams": [{ "id": 771, "name": "Amsterdam D1", "category": "Senioren", "poule_id": 180863 }]
}
```
`404` als de club niet bestaat, `400` bij een ongeldig `:ref`-formaat.

### `GET /api/teams/:teamId/matches?days=90`
Toekomstige **thuis**wedstrijden van dat team (uitwedstrijden zitten niet in de
database — zie hieronder). `days` is optioneel, default 90.
```json
{
  "team_id": 771,
  "matches": [{ "id": 2079158, "date": "2026-09-27", "time": "12:45", "home_name": "Amsterdam D1", "away_name": "Oranje-Rood D1", "is_home": 1 }]
}
```

Alle endpoints hebben CORS (`Access-Control-Allow-Origin: *`) — vrij aan te roepen vanuit een browser of andere bot.

## Waarom alleen thuiswedstrijden?

`refresh-matches.js` slaat bewust alleen thuiswedstrijden op — voor een
fluit-planner zijn dat de enige wedstrijden die relevant zijn. Uitwedstrijden
worden bij het verversen genegeerd, niet gefilterd bij het opvragen.

## Turso-schema

```sql
CREATE TABLE clubs  (id TEXT PRIMARY KEY, name TEXT, city TEXT, logo TEXT);
CREATE TABLE teams  (id INTEGER PRIMARY KEY, club_id TEXT, name TEXT, category TEXT, poule_id INTEGER,
                      FOREIGN KEY(club_id) REFERENCES clubs(id));
CREATE TABLE matches (id INTEGER PRIMARY KEY, poule_id INTEGER, team_id INTEGER NOT NULL,
                       date TEXT, time TEXT, home_name TEXT, away_name TEXT, is_home BOOLEAN,
                       FOREIGN KEY(team_id) REFERENCES teams(id));
-- Let op: matches.poule_id heeft GEEN foreign key naar poules — die tabel bestaat
-- maar wordt nooit gevuld. Een FK daarnaar liet destijds élke insert falen.
```
Huidige omvang (laatste refresh): 327 clubs, 4709 teams, ~17.500 wedstrijden.

## Belangrijk: waarom fetch() en niet @libsql/client

`refresh-matches.js` en `lib/turso.js` praten rechtstreeks met Turso's HTTP
pipeline-API (`POST {url}/v2/pipeline`) via kale `fetch()`, in plaats van het
officiële `@libsql/client` npm-pakket te gebruiken.

**Reden**: `@libsql/client` (de native Node-addon) bleek tijdens ontwikkeling
permanent vast te lopen (geen error, geen timeout — gewoon nooit klaar) zodra
hetzelfde proces ook een actieve Express `app.listen()` had draaien, bij
resultsets groter dan ~200-250 rijen. Dit is uitgebreid gereproduceerd en
geïsoleerd. De HTTP-fetch aanpak heeft dit probleem niet en is bovendien
overal identiek te gebruiken (lokaal, GitHub Actions, Vercel serverless).

**Verander dit niet terug** zonder eerst te testen of het probleem nog
bestaat — het kostte een hele sessie om te vinden.

## Refresh-pipeline

- `.github/workflows/refresh-knhb.yml` draait `refresh-matches.js` dagelijks om 06:00 UTC via `workflow_dispatch`/`schedule`.
- Secrets nodig in GitHub repo settings: `TURSO_TOKEN` (alleen de JWT-waarde, geen `TURSO_TOKEN=` prefix!).
- Handmatig draaien: `gh workflow run refresh-knhb.yml` of via de Actions-tab op GitHub.
- Duurt ~1,5 uur (4709 teams, met rate-limit-vriendelijke pauzes tussen KNHB-calls).

## Deployen

```bash
vercel --prod --yes   # vanuit deze map, .vercel/ bevat de projectkoppeling
```
Env vars op Vercel (production + development): `TURSO_URL`, `TURSO_TOKEN`.

## Backup verversen

```bash
TURSO_URL=libsql://knhb-matchen-fjdfksadhfljsf.aws-eu-west-1.turso.io TURSO_TOKEN=<token> node export-backup.js
```
`turso-backup.json` is een snapshot, geen live sync — ververs 'm handmatig als
je een recente stand als vangnet wilt hebben naast de live Turso-database.
