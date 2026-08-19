# Club-teams 26/27 — KNHB veldhockey clubs, teams & wedstrijden

Live database (Turso) + API met **alle KNHB-veldhockeyclubs**, hun **veldteams**
en hun **wedstrijdschema's**, zoals MoetIkFluiten (MIF) en andere bots ze kunnen
gebruiken. Seizoen **2026/2027**.

---

## Status (laatst bijgewerkt: zie hieronder)

- ✅ **327 clubs** in Turso (322 met logo)
- ✅ **4709 teams** in Turso
- ✅ **Wedstrijden**: worden ververst door `refresh-matches.js` (thuiswedstrijden, toekomstig)
- ✅ **API live** op MIF: `/api/clubs`, `/api/clubs/:ref`, `/api/teams/:id/matches`
  (zie `API.md` voor volledige documentatie)
- ⚠️ **Nog niet automatisch dagelijks** — de GitHub Actions workflow staat klaar
  (`.github-workflows-refresh.yml`) maar moet nog naar een echte GitHub-repo.
  **Dit is de enige stap die handmatig moet gebeuren — zie onderaan.**

---

## Architectuur

```
KNHB HAPI (app.hockeyweerelt.nl)
        │
        │  refresh-knhb.js (clubs+teams, wekelijks)
        │  refresh-matches.js (wedstrijden, dagelijks)
        ▼
Turso database (libsql://knhb-matchen-...aws-eu-west-1.turso.io)
   tabellen: clubs, teams, poules (ongebruikt), matches
        │
        │  HTTP fetch naar Turso's /v2/pipeline API
        ▼
MIF server/routes/turso.js  →  /api/clubs, /api/clubs/:ref, /api/teams/:id/matches
        │
        ▼
Andere bots (GoeieScheids, RefRota, ...) kunnen dezelfde MIF-endpoints aanroepen.
```

**Belangrijk:** de Turso-verbinding gaat via plain `fetch()` naar Turso's HTTP-
pipeline-API, **niet** via het `@libsql/client` npm-pakket. Dat pakket bleek
onbetrouwbaar zodra het in hetzelfde proces draait als een luisterende Express-
server (zie `API.md` voor de volledige uitleg — dit kostte een lange debug-sessie,
dus niet zomaar terugveranderen zonder eerst grondig te testen).

---

## Bestanden

| Bestand | Wat |
|---|---|
| `club-teams-26-27.json` | Statische dump van clubs+teams (zelfde data als in Turso, handig als offline seed). |
| `refresh-knhb.js` | Haalt clubs+teams opnieuw op bij KNHB, schrijft naar de JSON én kan gebruikt worden om Turso opnieuw te seeden. |
| `refresh-matches.js` | Haalt wedstrijden op bij KNHB per team en schrijft ze direct naar Turso (HTTP, geen JSON-tussenstap). Dit is het script dat dagelijks moet draaien. |
| `.github-workflows-refresh.yml` | Kant-en-klare GitHub Actions workflow voor de dagelijkse matches-refresh. **Moet nog naar `.github/workflows/` in een echte repo** (zie onderaan). |
| `API.md` | Volledige API-documentatie: endpoints, response-formaten, Turso-schema, codevoorbeelden. |
| `README.md` | Dit bestand. |

---

## Turso-credentials

```
TURSO_URL=libsql://knhb-matchen-fjdfksadhfljsf.aws-eu-west-1.turso.io
TURSO_TOKEN=<staat in MIF/.env>
```

Beide scripts (`refresh-knhb.js` seed-functie, `refresh-matches.js`) lezen deze
uit `process.env.TURSO_URL` / `process.env.TURSO_TOKEN` (met de `libsql://`
default als fallback in de code).

---

## Verversen — handmatig

```bash
# Clubs + teams opnieuw ophalen (JSON + kan naar Turso geseed worden)
node refresh-knhb.js full club-teams-26-27.json

# Wedstrijden opnieuw ophalen en direct naar Turso schrijven (~30-40 min voor alle 4709 teams)
TURSO_TOKEN=<token> node refresh-matches.js
```

---

## ⚠️ Wat jij (Julius) morgenochtend nog moet doen voor volledige automatisering

Ik kon dit niet autonoom afmaken omdat er geen GitHub CLI (`gh`) beschikbaar
was op dit systeem om in te loggen op jouw account. Zonder dat kan ik geen
GitHub-repo aanmaken of secrets instellen. Drie stappen, ~5 minuten:

1. **Maak een GitHub-repo** (kan private) voor deze map, bijvoorbeeld `knhb-club-teams`.
   ```bash
   cd "Takie/Club-teams 26-27"
   git init
   git add .
   git commit -m "initial"
   gh repo create knhb-club-teams --private --source=. --push
   # of handmatig: repo aanmaken op github.com, dan git remote add origin ... && git push
   ```
2. **Verplaats de workflow** naar de juiste plek (GitHub Actions leest alleen `.github/workflows/`):
   ```bash
   mkdir -p .github/workflows
   mv .github-workflows-refresh.yml .github/workflows/refresh-knhb.yml
   git add .github && git commit -m "add daily refresh workflow" && git push
   ```
3. **Zet het secret**:
   ```bash
   gh secret set TURSO_TOKEN --body "<de token uit MIF/.env>"
   ```

Daarna draait `refresh-matches.js` vanzelf elke dag om 06:00 UTC en houdt de
wedstrijden actueel. Tot die tijd blijft de data van de laatste handmatige run
staan (nog steeds bruikbaar, alleen niet dagelijks vers).

---

## Structuur van `club-teams-26-27.json`

```jsonc
{
  "season": "2026/2027",
  "generated_at": "2026-08-18T...Z",
  "source": "KNHB HAPI (app.hockeyweerelt.nl)",
  "club_count": 327,
  "team_count": 16175,
  "failed_clubs": 0,
  "clubs": [
    {
      "club_ref": "HH11AR3",               // KNHB federation_reference_id — DE sleutel voor een club
      "name": "Amsterdam",
      "city": "Amstelveen",
      "teams": [
        {
          "id": 771,                       // team-id (nodig voor wedstrijden)
          "name": "Amsterdam D1",
          "category": "Senioren",
          "poule_id": 180863               // recent_poule_id — nodig om wedstrijden op te halen
        }
      ]
    }
  ]
}
```

### Belangrijke velden
- **`club_ref`** = KNHB `federation_reference_id` (bijv. `"HH11AR3"`) — de sleutel voor een club, geen numeriek id.
- **`team.id`** = numeriek team-id.
- **`team.poule_id`** = `recent_poule_id`. Samen met `team.id` haal je hiermee de wedstrijden op.
- Alleen **veldteams** (`hockey_type === "VE"` of leeg) — zaalhockey (`ZA`) is gefilterd.
  Let op: dit filtert flink — bijv. Amsterdam heeft 229 teams totaal maar maar 145 veldteams.

---

## Gebruik in code (via de live API, aanbevolen)

Zie `API.md` voor de volledige documentatie. Kort:

```js
const clubs = await fetch('https://<mif-domein>/api/clubs').then(r => r.json());
const { club, teams } = await fetch('https://<mif-domein>/api/clubs/HH11AR3').then(r => r.json());
const { matches } = await fetch('https://<mif-domein>/api/teams/771/matches').then(r => r.json());
```

## Gebruik in code (via de statische JSON, offline/seed)

```js
const data = require('./club-teams-26-27.json');
const club = data.clubs.find(c => c.name.toLowerCase() === 'amsterdam');
club.teams.map(t => t.name);
```

---

## KNHB API-details (voor wie refresh-knhb.js / refresh-matches.js aanpast)

- **Base URL:** `https://app.hockeyweerelt.nl`
- **Auth:** eerst `POST /device/register` met `{uuid, os:"Web"}` → geeft een `token`.
- **Signature per request** (headers `X-HAPI-*`):
  - `input = timestamp + sanitizedPath + sanitizedQuery + reverse(uuid)`
  - `signature = sha1(input)` (hex)
  - sanitize = alle tekens weg behalve `a-zA-Z0-9-/` (query ook `=`)
  - headers: `X-HAPI-Authorization: <token>`, `X-HAPI-Timestamp`, `X-HAPI-Signature`, `X-HAPI-Version: 7`
- Bij `401` → opnieuw `registerDevice()` en de request herhalen.
- Bij `429` → exponentiële backoff (beide scripts doen dit al: 1s, 2s, 4s, ... tot ~32s).
