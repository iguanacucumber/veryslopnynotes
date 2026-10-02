# server/ — ports/adaptateurs (phases 2-3+)
`domain/` = interfaces + métier pur. `api/` = REST/SSE vers `shared/contracts/`. `infrastructure/` = HTTP/SQLite/push/stockage. `integrations/` = Pronote (unique `PronoteHttpClient`). `ai/` = LLM sans outils/réseau/secrets. `jobs/` = sync/notifs via domaine uniquement.
