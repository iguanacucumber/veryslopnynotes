# Shared contracts

`api.ts` and `api.openapi.yaml` describe the three server routes:
`GET /v1/health`, `POST /v1/manuals/scrape` and `POST /v1/web/scrape`
(page web publique, sans jar de session, #634).

The remaining models, events, cache rules, and response validators are retained
as test mirrors for the Android app. The server does not emit SSE events; the
Android app owns Pronote access and its offline cache.

Route/schema synchronization is checked by `tests/contracts`. Historical API
changes were removed here; use Git history for the retired server API.
