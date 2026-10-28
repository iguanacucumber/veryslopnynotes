# server/ — scraper de manuels

L'app parle directement à Pronote et à OpenRouter ; ce serveur ne participe pas
à ces flux (ADR-003). Il ne sert que trois routes :

- `GET /v1/health` pour la sonde.
- `POST /v1/manuals/scrape` pour extraire une page de manuel.
- `POST /v1/web/scrape` pour extraire une page web publique choisie par
  l'élève (#634). Même moteur et même garde SSRF, mais AUCUN cookie jar :
  une page web ne s'authentifie pas et ne porte aucun cookie de l'élève.
  Le contenu non textuel est refusé (`415 not_text`) et une page trop
  volumineuse est refusée avant lecture (`413 too_large`).

Le scraper est sans authentification et n'exige que la plateforme et l'URL de
départ dans le corps de requête. Les identifiants de portail (`username` /
`password`) sont REFUSÉS (400) : le scraper ne s'authentifie pas — la session
est celle du serveur (son cookie jar), donc un identifiant reçu ne serait
collecté pour rien (#526). Risque SSRF et d'épuisement du compte : garder sur
réseau de confiance ou placer un proxy authentifié devant. `make runServer` et
Docker lancent ce seul service. `make runServer` écoute par défaut sur la
boucle locale (`HOST=0.0.0.0` pour l'exposer, sur un réseau de confiance), et
sa préparation TLS est obligatoire : un échec arrête le lancement, jamais de
repli en clair.

L'IMAGE Docker suit la même règle (#533) : elle refuse de démarrer sans
`TLS_CERT_FILE`/`TLS_KEY_FILE` (le couple est monté en volume), elle ne force
pas `HOST` (l'exposition est un choix de l'opérateur) et elle tourne sous un
utilisateur non privilégié. Le couple peut venir de la préparation TLS locale
(`~/.cache/veryslopnynotes/tls`, hors dépôt) :

```sh
docker run --rm -p 3000:3000 \
  -e HOST=0.0.0.0 \
  -e TLS_CERT_FILE=/tls/cert.pem -e TLS_KEY_FILE=/tls/key.pem \
  -v ~/.cache/veryslopnynotes/tls:/tls:ro \
  veryslopnynotes-server:local
```

Sans `-e HOST=0.0.0.0`, le service n'écoute que sur la boucle locale du
conteneur (comme `make runServer`). Sans le couple TLS, il ne démarre pas :
un point d'entrée sans authentification ne se sert pas en clair. Hors image,
un lancement local sans couple TLS sert en clair et le dit bruyamment
(`[server] ATTENTION : service en CLAIR`).

Garde-fous côté serveur (#362) : la navigation ne va que vers un hôte public
(IP privée refusée, forme IPv4-mapped IPv6 comprise), la chaîne de
redirections est vérifiée avant le navigateur et l'URL finale après ; le
cookie jar n'est plus fourni par l'appelant : c'est le SERVEUR qui choisit
le sien (#538 — le corps ne peut plus en demander le nom, ce qui appelait la
session d'un autre tenant).

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

Une page de CONNEXION (le portail la renvoie en HTTP 200 quand la session du
jar n'est plus valable) n'est jamais ingérée comme un manuel : elle est
refusée (`502 login_required`) avant extraction, et elle n'écrase pas le jar
de session (#526). Un portail qui masque son formulaire (JavaScript) n'est pas
détecté : c'est un défaut accepté, pas un silence.

Le navigateur n'est pas téléchargé par `bun install` (le paquet `playwright`
n'a aucun script d'installation) : hors Docker, lancer `bunx playwright install
chromium` une fois, sinon le scrape répond 501 « scraper sans navigateur ».
Dans l'image Docker, Chromium est installé au build (`Dockerfile.server`).
