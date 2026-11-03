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
la boucle locale ; toute autre interface exige un proxy authentifié devant.
`make runServer` et Docker lancent ce seul service. `make runServer` écoute par
défaut sur la boucle locale (`HOST=0.0.0.0` seulement derrière ce proxy), et sa
préparation TLS est obligatoire : un échec arrête le lancement, jamais de repli
en clair.

L'IMAGE Docker suit la même règle (#533, #921) : la commande documentée publie
sur la boucle locale par défaut, sans `TLS_CERT_FILE`/`TLS_KEY_FILE` (volume)
elle ne démarre pas, elle ne force pas `HOST` et tourne non privilégiée. Sa base
est épinglée par digest. La commande ci-dessous durcit le conteneur (racine en
lecture seule, capabilities retirées, escalade interdite) : `/tmp` et le HOME
sont des tmpfs, le jar un volume nommé. Le couple TLS vient de la préparation
locale (`~/.cache/veryslopnynotes/tls`, hors dépôt) :

```sh
docker run --rm -p 127.0.0.1:3000:3000 \
  --read-only --cap-drop=ALL --security-opt no-new-privileges \
  --tmpfs /tmp --tmpfs /home/vsn:rw,nosuid,nodev,size=64m,mode=1777 \
  -v veryslopnynotes-jar:/app/playwright/.auth \
  -e HOST=0.0.0.0 \
  -e TLS_CERT_FILE=/tls/cert.pem -e TLS_KEY_FILE=/tls/key.pem \
  -v ~/.cache/veryslopnynotes/tls:/tls:ro \
  veryslopnynotes-server:local
```

`-p 127.0.0.1:3000:3000` publie sur la boucle locale seulement ; c'est `-p`,
pas `HOST=0.0.0.0` (requis dans le conteneur), qui borne l'exposition. Sans
auth : hors boucle locale, proxy authentifié OBLIGATOIRE.

Public = opt-in explicite : `-p 3000:3000` expose sans auth avec la session du
serveur (compte épuisable, usage détourné) ; uniquement derrière ce proxy.

Sans couple TLS, le conteneur ne démarre pas : un point d'entrée sans auth ne se
sert pas en clair. Hors image, un lancement local sans couple TLS sert en clair
et le dit (`[server] ATTENTION : service en CLAIR`).

Garde-fous côté serveur (#362, #779) : seuls des hôtes publics sont visités
(IP privée refusée, IPv4-mapped comprise), la chaîne de redirections est
vérifiée avant le navigateur (sonde injoignable = refus) et l'URL finale
après ; WebSocket gardés par `routeWebSocket`, service workers bloqués, sinon
ils contourneraient `page.route`. Jar du SERVEUR (#538) préparé en 0700 au
démarrage, temporaires nettoyés, écrit en 0600 par temporaire + `rename`,
sérialisé, une seule sauvegarde, logs sans contenu ; cookies bornés à leur
domaine, page web sans jar.

Le nom de l'hôte est aussi RÉSOLU (#419) : un nom public qui pointe vers une
IP interne (rebinding DNS) est refusé avant la navigation, avec un motif
explicite (`403 private_host`) — jamais un échec muet. Un nom introuvable est
refusé de même (`502 unresolved_host`). Il reste la fenêtre TOCTOU : le
navigateur résout de son côté, au moment de la connexion.

Le service est borné (#422) : 2 scrapes simultanés (503 `busy`, avec
`Retry-After`), 30 s (504 `timeout`), HTML sérialisé borné DANS le navigateur
(1 Mo, jamais `outerHTML` entier) et lu avec un délai (10 s) ; un
`content-length` au-delà de 4 Mo est refusé avant lecture (mesure compressée).

Une page de CONNEXION (le portail la renvoie en HTTP 200 quand la session du
jar n'est plus valable) n'est jamais ingérée comme un manuel : elle est
refusée (`502 login_required`) avant extraction, et elle n'écrase pas le jar
de session (#526). Un portail qui masque son formulaire (JavaScript) n'est pas
détecté : c'est un défaut accepté, pas un silence.

Le navigateur n'est pas téléchargé par `bun install` (le paquet `playwright`
n'a aucun script d'installation) : hors Docker, lancer `bunx playwright install
chromium` une fois, sinon le scrape répond 501 « scraper sans navigateur ».
Dans l'image Docker, Chromium est installé au build (`Dockerfile.server`).
