# KNHB Club-teams API

Publieke, read-only API voor KNHB veldhockey clubs/teams/wedstrijden, gebouwd
op Turso. Losse, minimale Vercel-deployment — bewust **niet** onderdeel van
MIF's eigen Express-app, om het serverless-onvriendelijke `node:sqlite`-gebruik
daar niet te raken.

Volledige API-documentatie (endpoints, response-formaten, Turso-schema):
zie `../Club-teams 26-27/API.md`. De implementatie hier is identiek aan
`../MIF/server/routes/turso.js`, alleen verpakt als losse Vercel serverless
functions in plaats van Express-routes.

## Endpoints
- `GET /api/clubs`
- `GET /api/clubs/:ref`
- `GET /api/teams/:teamId/matches?days=90`

## Env vars (Vercel project settings)
```
TURSO_URL=libsql://knhb-matchen-fjdfksadhfljsf.aws-eu-west-1.turso.io
TURSO_TOKEN=<token>
```

## Lokaal testen
```bash
vercel dev
```
