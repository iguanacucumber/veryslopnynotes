# server/ — ports/adaptateurs (phases 2-3+)
`domain/` = interfaces + métier pur. `api/` = REST/SSE vers `shared/contracts/`. `infrastructure/` = HTTP/SQLite/push/stockage. `integrations/` = Pronote (unique `PronoteHttpClient`). `ai/` = LLM sans outils/réseau/secrets. `jobs/` = sync/notifs via domaine uniquement.

#209 : le process servi (`infrastructure/http.ts`) n'est plus qu'un scraper de
manuels (plain HTTPS, sans auth — GET /v1/health + POST /v1/manuals/scrape).
Le reste de l'arbre est mort côté process ; suppression physique en #210.
