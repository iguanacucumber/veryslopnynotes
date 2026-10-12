# server/ — scraper manuels + legacy capture (#210)

Le serveur applicatif est mort (app device-only, ADR-003). Reste :

- `infrastructure/http.ts` + `manuals.ts` + `manuals-scrape.ts` : le scraper
  manuels (#209) — plain HTTPS, sans auth, GET /v1/health +
  POST /v1/manuals/scrape. Seul process servi (`make runServer`, Dockerfile).
- `integrations/` (sauf lectures supprimées) + `domain/ports.ts` +
  `domain/averages.ts` + `domain/capabilities.ts` + `api/setup.ts`
  (`accountIdFrom` seul) : le client Pronote TS, dépendance de l'outil de
  capture du corpus (#199, encore ouvert : `agents/runtime/capture-pronote.ts`).
  Hors process, jamais servi. Meurt avec #199.

Tout le reste (`server/ai/`, `server/jobs/`, le reste de `server/api/`,
`server/domain/attendance.ts`, les 31 routes et leurs contrats) est supprimé
en #210 : voir `shared/contracts/api.ts` (2 routes) et `docs/architecture/INVARIANTS.md`.
