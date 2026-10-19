# server/ — scraper de manuels

L'app parle directement à Pronote et à OpenRouter ; ce serveur ne participe pas
à ces flux (ADR-003). Il ne sert que deux routes :

- `GET /v1/health` pour la sonde.
- `POST /v1/manuals/scrape` pour extraire une page de manuel.

Le scraper est sans authentification et accepte identifiants éditeur dans le
corps de requête. Risque SSRF et d'épuisement du compte : garder sur réseau de
confiance ou placer un proxy authentifié devant. `make runServer` et Docker
lancent ce seul service.

Garde-fous côté serveur (#362) : la navigation ne va que vers un hôte public
(IP privée refusée, forme IPv4-mapped IPv6 comprise), la chaîne de
redirections est vérifiée avant le navigateur et l'URL finale après ; le
chemin du cookie jar n'est plus fourni par l'appelant (seulement son nom, dans
`playwright/.auth/`).

Le nom de l'hôte est aussi RÉSOLU (#419) : un nom public qui pointe vers une
IP interne (rebinding DNS) est refusé avant la navigation, avec un motif
explicite (`403 private_host`) — jamais un échec muet.

Le navigateur n'est pas téléchargé par `bun install` (le paquet `playwright`
n'a aucun script d'installation) : hors Docker, lancer `bunx playwright install
chromium` une fois, sinon le scrape répond 501 « scraper sans navigateur ».
Dans l'image Docker, Chromium est installé au build (`Dockerfile.server`).
