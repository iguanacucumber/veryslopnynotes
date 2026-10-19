# server/ — scraper de manuels

L'app parle directement à Pronote et à OpenRouter ; ce serveur ne participe pas
à ces flux (ADR-003). Il ne sert que deux routes :

- `GET /v1/health` pour la sonde.
- `POST /v1/manuals/scrape` pour extraire une page de manuel.

Le scraper est sans authentification et accepte identifiants éditeur dans le
corps de requête. Risque SSRF et d'épuisement du compte : garder sur réseau de
confiance ou placer un proxy authentifié devant. `make runServer` et Docker
lancent ce seul service. `make runServer` écoute par défaut sur la boucle
locale (`HOST=0.0.0.0` pour l'exposer, sur un réseau de confiance), et sa
préparation TLS est obligatoire : un échec arrête le lancement, jamais de
repli en clair. Sans `TLS_CERT_FILE`/`TLS_KEY_FILE` (Docker), le serveur sert
en clair et le dit bruyamment (`[server] ATTENTION : service en CLAIR`).

Garde-fous côté serveur (#362) : la navigation ne va que vers un hôte public
(IP privée refusée, forme IPv4-mapped IPv6 comprise), la chaîne de
redirections est vérifiée avant le navigateur et l'URL finale après ; le
chemin du cookie jar n'est plus fourni par l'appelant (seulement son nom, dans
`playwright/.auth/`).

Le nom de l'hôte est aussi RÉSOLU (#419) : un nom public qui pointe vers une
IP interne (rebinding DNS) est refusé avant la navigation, avec un motif
explicite (`403 private_host`) — jamais un échec muet. Un nom introuvable est
refusé de même (`502 unresolved_host`). Il reste la fenêtre TOCTOU : le
navigateur résout de son côté, au moment de la connexion.

Le service est borné (#422) : 2 scrapes simultanés (les suivants = `503
busy`, avec `Retry-After`), 30 s de délai (dépassé = `504 timeout`, le code
exact), et le HTML lu est plafonné à 1 Mo de caractères avant reparse, avec
son propre délai de lecture (10 s) — une page de 50 Mo n'est plus reparsée
en entier, et une page qui ne finit pas de streamer ne garde plus le
Chromium vivant.

Le navigateur n'est pas téléchargé par `bun install` (le paquet `playwright`
n'a aucun script d'installation) : hors Docker, lancer `bunx playwright install
chromium` une fois, sinon le scrape répond 501 « scraper sans navigateur ».
Dans l'image Docker, Chromium est installé au build (`Dockerfile.server`).
