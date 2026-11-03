# Politique d'égression du scraper (I8)

La garde applicative (garde SSRF + épinglage DNS, `server/infrastructure/`)
borne ce que le navigateur *demande*. Elle ne peut pas prouver ce que le noyau
*émet* : une sous-ressource dont l'hôte n'est connu qu'à la requête est résolue
par Chromium, et un enregistrement DNS qui change entre la vérification et la
connexion garde une fenêtre TOCTOU. Cette politique ferme cette fenêtre au
niveau réseau, où elle devient mesurable.

## Règles

Le conteneur du scraper n'a AUCUNE route directe vers l'extérieur. Seul un
proxy sortant contrôlé est joignable, et il applique :

1. **HTTP(S) seulement**, vers le port 80/443. Tout autre protocole ou port est
   refusé (pas de SMTP, SSH, Redis, IMDS).
2. **Refus des destinations non publiques** : `127.0.0.0/8`, `10.0.0.0/8`,
   `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` (dont
   `169.254.169.254`), `100.64.0.0/10`, `0.0.0.0/8`, multicast et réservé,
   `::1/128`, `fc00::/7`, `fe80::/10`, IPv4-mapped et NAT64. Le refus porte
   sur l'ADRESSE CONNECTÉE, après résolution par le proxy, pas sur le nom.
3. **Résolution unique** : le proxy résout, valide, puis connecte l'adresse
   validée. Il ne délègue pas la résolution au client et ne re-résout pas.
4. **Journal** : hôte, adresse connectée, verdict, sans URL complète ni
   cookie ; alerte sur tout refus de destination privée.

Sans proxy disponible, le scraper reste sur un réseau Docker `internal` (aucune
route sortante) : il échoue, il ne bascule pas en direct.

## Application (exemple)

```sh
# 1. Réseau sans passerelle : aucune sortie directe.
docker network create --internal scraper-egress
# 2. Proxy à liste blanche, double-homed : scraper-egress + uplink.
docker network create scraper-uplink
docker run -d --name scraper-egress-proxy \
  --network scraper-uplink \
  --cap-drop=ALL --security-opt no-new-privileges \
  <proxy-à-liste-blanche>
docker network connect scraper-egress scraper-egress-proxy
# 3. Le scraper n'a que ce réseau. Le proxy est imposé à Chromium par
#    SCRAPER_EGRESS_PROXY (loopback compris) ; sans proxy joignable, le scrape
#    échoue, jamais en direct.
docker run --rm --network scraper-egress \
  -e SCRAPER_EGRESS_PROXY=http://scraper-egress-proxy:3128 \
  veryslopnynotes-server:local
```

`SCRAPER_EGRESS_PROXY` est lu dans l'environnement du service, jamais dans un
corps de requête. Une valeur illisible ou non `http(s)` REFUSE le scrape : pas
de repli direct.

Sur un hôte sans Docker, la même règle s'exprime en `nftables`/`iptables` :
chaîne `output` du compte de service, `drop` par défaut, `accept` uniquement
vers l'adresse du proxy, plus les plages privées refusées même via le proxy.

## Ce que le code ferme déjà

- `context.route` couvre toutes les pages du contexte, popups comprises ; une
  popup est fermée dès sa création.
- Seul `http(s)` continue : `file:`, `ftp:`, `data:` et `blob:` sont coupés.
- Le document et chaque hôte de la chaîne de redirections sont épinglés par
  `--host-resolver-rules` à une adresse déjà validée.
- `SCRAPER_EGRESS_PROXY` fait passer TOUT le trafic Chromium (loopback compris)
  par le proxy contrôlé ; une valeur invalide refuse le scrape.
- WebSocket gardés (`routeWebSocket`), service workers bloqués, URL finale
  re-vérifiée, téléchargements coupés.

## Risque résiduel

Les sous-ressources (images, scripts, XHR) ne sont pas épinglées : leur hôte
n'est connu qu'au moment de la requête. La garde les résout et les refuse, mais
Chromium re-résout ; seule la règle réseau ci-dessus supprime la fenêtre. Un
proxy mal configuré (résolution côté client, liste blanche de noms au lieu
d'adresses) rouvre le trou : la validation doit porter sur l'adresse connectée.
