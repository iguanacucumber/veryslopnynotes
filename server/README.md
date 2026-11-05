# server/ — scraper de manuels

L'app parle directement à Pronote et à OpenRouter ; ce serveur ne participe pas
à ces flux (ADR-003). Il ne sert que quatre routes :

- `GET /v1/health` pour la vivacité : le process répond, même en drain.
- `GET /v1/ready` pour la disponibilité RÉELLE : 200 seulement si le jar est
  inscriptible, Chromium DÉMARRE (lancement court, mis en cache) et l'instance
  n'est pas en drain ; sinon 503 avec les booleans `jar`, `browser`,
  `accepting`. Sonde le trafic avec `/v1/ready`, pas `/v1/health`.
- `POST /v1/manuals/scrape` pour extraire une page de manuel.
- `POST /v1/web/scrape` pour extraire une page web publique choisie par
  l'élève (#634). Même moteur et même garde SSRF, mais AUCUN cookie jar :
  une page web ne s'authentifie pas et ne porte aucun cookie de l'élève.
  Le contenu non textuel est refusé (`415 not_text`) et une page trop
  volumineuse est refusée avant lecture (`413 too_large`).

Sur la boucle locale, le scraper est sans authentification. Les identifiants de
portail (`username` / `password`) sont REFUSÉS (400) : le scraper ne
s'authentifie pas — la session est celle du serveur (son cookie jar), donc un
identifiant reçu ne serait collecté pour rien (#526). Risque SSRF et
d'épuisement du compte : garder sur la boucle locale. Hors loopback, le
démarrage est REFUSÉ sans `ALLOW_PUBLIC=1` + `SCRAPER_TOKEN` (Bearer exigé sur
toutes les routes, comparé à temps constant), avec un proxy authentifié devant.
`make runServer` écoute sur la boucle locale ; TLS obligatoire, échec = arrêt.
En mode public, un seau par jeton borne les scrapes (6 en rafale, 10/min, 4
en file, 2 simultanés) ; au-delà, `429 rate_limited` + `Retry-After` (secondes).
`/v1/health` et `/v1/ready` restent hors quota. mTLS n'est pas terminé ici : un
proxy termine mTLS puis injecte `Authorization: Bearer`, ou fait foi comme
authentificateur ; le service garde TLS obligatoire et ne lit aucun certificat
client.

L'IMAGE Docker suit la même règle (#533, #921) : la commande documentée publie
sur la boucle locale par défaut, sans `TLS_CERT_FILE`/`TLS_KEY_FILE` (volume)
elle ne démarre pas, un couple blanc est REFUSÉ, elle ne force pas `HOST` et
tourne non privilégiée. Sa base est épinglée par digest.
Le sandbox de Chromium est ACTIF : Playwright le désactive par défaut, donc
`CHROMIUM_LAUNCH_OPTIONS` l'impose et la commande fournit le profil seccomp
étroit `server/chromium-seccomp.json`. La commande
ci-dessous durcit le conteneur (racine en lecture seule, capabilities retirées,
escalade interdite, sandbox Chromium) : `/tmp` et le HOME sont des tmpfs, le jar
un volume nommé. Le couple TLS vient de la préparation locale
(`~/.cache/veryslopnynotes/tls`, hors dépôt) :

```sh
docker run --rm -p 127.0.0.1:3000:3000 \
  --read-only --cap-drop=ALL --security-opt no-new-privileges \
  --security-opt seccomp=./server/chromium-seccomp.json \
  --memory=1g --memory-swap=1g --cpus=1 --pids-limit=256 --stop-timeout=40 \
  --tmpfs /tmp --tmpfs /home/vsn:rw,nosuid,nodev,size=64m,mode=1777 \
  -v veryslopnynotes-jar:/app/playwright/.auth \
  -e HOST=0.0.0.0 -e ALLOW_PUBLIC=1 -e SCRAPER_TOKEN="$SCRAPER_TOKEN" \
  -e TLS_CERT_FILE=/tls/cert.pem -e TLS_KEY_FILE=/tls/key.pem \
  -v ~/.cache/veryslopnynotes/tls:/tls:ro \
  veryslopnynotes-server:local
```

L'image déclare `HEALTHCHECK` sur `/v1/ready` (30 s, 20 s de démarrage,
3 échecs) et sonde `127.0.0.1` si `HOST` vaut `0.0.0.0`/vide, sinon `HOST`.
Elle est `unhealthy` si le jar manque ou si Chromium ne DÉMARRE pas (sandbox
comprise), pas seulement si le process est mort. Docker n'arrête pas un
conteneur `unhealthy` tout seul : un orchestrateur ou `--restart` doit le faire.

**Cgroup.** Les quatre plafonds ci-dessus sont des limites DURES, pas des
conseils : 1 Gio de RAM (swap compris), 1 CPU, 256 PID. Chromium coûte ~300 Mo
par scrape, deux scrapes simultanés plus le runtime dépassent 1 Gio : garder
1 Gio pour un usage séquentiel, monter à 2 Gio si le plafond est atteint.
Dépassement mémoire = OOM-kill du conteneur (le scrape en cours meurt), pas un
ralentissement ; un `pids-limit` trop bas donne des `fork` refusés dans
Chromium. Vérifier sur cgroup v2 (`/sys/fs/cgroup/memory.max`,
`cpu.max`, `pids.max`) et augmenter la mémoire plutôt que retirer la limite.
Sous Compose : `mem_limit`, `memswap_limit`, `cpus`, `pids_limit`,
`stop_grace_period: 40s`.

**Arrêt gracieux.** `STOPSIGNAL SIGTERM` : au signal, `/v1/ready` passe 503,
le serveur cesse d'accepter, laisse finir les scrapes en cours puis s'arrête
(35 s au plus, au-delà arrêt forcé). `docker stop` n'attend que 10 s par
défaut : utiliser `--stop-timeout=40` (ci-dessus) ou `stop_grace_period`.
`/v1/health` continue de répondre 200 pendant le drain ; c'est voulu, la
vivacité n'est pas la disponibilité.

Le profil seccomp est le profil par défaut de Docker (moby/profiles,
Apache-2.0) plus trois règles : `clone` pour les namespaces user/PID/net,
`unshare(CLONE_NEWUSER)` seul, et `chroot` ; mount, cgroup, UTS et IPC restent
refusés. L'hôte doit autoriser les user namespaces non privilégiés
(sysctl/AppArmor) ; sinon le scrape ÉCHOUE (501 « sandbox Chromium
indisponible »), sans repli vers un Chromium non sandboxé. Renouveler le profil
quand le défaut Docker évolue. Ce n'est PAS une isolation VM : une faille du
processus navigateur ou du noyau reste hors du sandbox ; gVisor ou une VM
dédiée est le cran supérieur.

`-p 127.0.0.1:3000:3000` borne l'exposition à la boucle locale ;
`HOST=0.0.0.0` est requis DANS le conteneur, d'où `ALLOW_PUBLIC=1` et un
`SCRAPER_TOKEN` exporté. Hors boucle locale, proxy authentifié OBLIGATOIRE.

Public = opt-in explicite : `-p 3000:3000` publie partout (compte épuisable,
usage détourné) ; uniquement derrière un proxy qui injecte
`Authorization: Bearer $SCRAPER_TOKEN`. Le client Android n'envoie pas de jeton.

Sans couple TLS, le conteneur ne démarre pas : un point d'entrée qui monte la
session du serveur ne se sert pas en clair. Hors image, un lancement local sans
couple TLS sert en clair UNIQUEMENT sur la boucle locale et le dit
(`[server] ATTENTION : service en CLAIR`) ; un bind non-loopback sans TLS est
REFUSÉ (override de test seulement).

**CA réelle et HSTS.** Un certificat auto-signé ne convient qu'à la boucle
locale. Pour un accès public, deux montages valides :

- terminaison au proxy (RECOMMANDÉ) : le conteneur reste sur `127.0.0.1`, le
  proxy porte le certificat d'une AC publique (ACME/Let's Encrypt, `fullchain`
  + clé renouvelés hors dépôt) ou d'une AC interne de confiance, et injecte le
  jeton Bearer. Le client ne parle qu'au proxy ;
- TLS direct dans le conteneur : monter `fullchain.pem` et `privkey.pem` d'une
  AC réelle en lecture seule, renouveler puis redémarrer le conteneur. Le
  certificat doit couvrir le nom servi ; `127.0.0.1` n'est pas un nom public.

HSTS appartient au terminateur TLS, pas à l'application : ne l'émettre
qu'après avoir vérifié HTTPS et tous les sous-domaines, jamais sur
`localhost`. `includeSubDomains` et `preload` engagent le domaine entier.

```nginx
server {
  listen 443 ssl http2;
  server_name scraper.<votre-domaine>;
  ssl_certificate     /etc/letsencrypt/live/scraper.<votre-domaine>/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/scraper.<votre-domaine>/privkey.pem;
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  location / {
    proxy_pass https://127.0.0.1:3000;
    proxy_set_header Authorization "Bearer <jeton-hors-dépôt>";
    proxy_ssl_verify off; # boucle locale uniquement
  }
}
```

Le jeton reste hors du dépôt (gestionnaire de secrets du proxy) ; un jeton
commité se rotate immédiatement.

Garde-fous (#362, #779, #933) : seuls des hôtes publics sont visités (IP
privée refusée, IPv4-mapped comprise), la chaîne de redirections est vérifiée
avant le navigateur (sonde injoignable = refus) et l'URL finale après ;
`context.route` couvre TOUTES les pages (popup fermée dès sa création), seul
`http(s)` sort (`file:`, `ftp:`, `data:`, `blob:` coupés), WebSocket gardés,
service workers bloqués. Le document et les hôtes de redirection sont ÉPINGLÉS
dans Chromium à l'adresse validée (`--host-resolver-rules`). Jar du SERVEUR
(#538) en 0700, écrit en 0600 par temporaire + `rename`, sérialisé, une seule
sauvegarde, logs sans contenu ; cookies bornés, page web sans jar.

Le nom est aussi RÉSOLU (#419) : un nom public qui pointe vers une IP interne
est refusé avant la navigation (`403 private_host`), un nom introuvable aussi
(`502 unresolved_host`). Les sous-ressources, dont l'hôte n'est connu qu'à la
requête, ne sont pas épinglées : l'égression réseau ferme leur fenêtre TOCTOU
en refusant l'adresse connectée, pas le nom.

Le service est borné (#422) : 2 scrapes simultanés (503 `busy`, avec
`Retry-After`), 30 s AU TOTAL pour corps + DNS + scrape (504 `timeout`), HTML
sérialisé borné DANS le navigateur (1 Mo, jamais `outerHTML` entier) et lu avec
un délai (10 s) ; un `content-length` au-delà de 4 Mo est refusé avant lecture
(mesure compressée).

Une page de CONNEXION (le portail la renvoie en HTTP 200 quand la session du
jar n'est plus valable) n'est jamais ingérée comme un manuel : elle est
refusée (`502 login_required`) avant extraction, et elle n'écrase pas le jar
de session (#526). Un portail qui masque son formulaire (JavaScript) n'est pas
détecté : c'est un défaut accepté, pas un silence.

Le navigateur n'est pas téléchargé par `bun install` (le paquet `playwright`
n'a aucun script d'installation) : hors Docker, lancer `bunx playwright install
chromium` une fois, sinon le scrape répond 501 « scraper sans navigateur ».
Dans l'image Docker, Chromium est installé au build (`Dockerfile.server`).
