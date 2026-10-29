# HUMAN_INPUTS.md — configuration et apports humains, sans valeurs secrètes

Seule source de la configuration du dépôt : le README y renvoie.

## Configuration

**Pas de `.env` ni de secret côté serveur.** Le QR contient l'adresse de
l'établissement ; le PIN et la session restent sur le téléphone.

| Variable | Usage | Secrète ? |
|---|---|---|
| `PORT`, `HOST` | Écoute du scraper. `make runServer` prend `8080` et `127.0.0.1` par défaut, surchargeables (`PORT=9090 make runServer`) ; sans `HOST`, le binaire écoute sur la boucle locale. | Non |
| `TLS_CERT_FILE`, `TLS_KEY_FILE` | Certificat et clé du scraper. | Non (chemins) |
| `SERVER_HOST` ou `server.host` dans `android/local.properties` | Graine de l'adresse du scraper ; l'adresse se change ensuite dans l'app. | Non |
| `STORE_FILE`, `STORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` | Signature release, toujours hors du dépôt. | **Oui** |
| `ANDROID_HOME`, `ANDROID_JDK_HOME` | Découverte du SDK et du JDK. | Non |

## Apports humains

- **Compte Pronote** : l'utilisateur scanne le QR de l'application Pronote (il porte l'adresse de l'établissement) et saisit son PIN dans l'app. La session ne quitte pas le téléphone.
- **Clé OpenRouter** : saisie dans les réglages de l'app, stockée chiffrée et envoyée directement à OpenRouter. Aucun modèle ni secret à configurer côté serveur.
- **Scraper de manuels (facultatif)** : l'appelant fournit plateforme et URL de départ dans le corps de `POST /v1/manuals/scrape`. Dans l'app, l'adresse du manuel est demandée une seule fois (par défaut le catalogue `https://www.lelivrescolaire.fr/manuels`, modifiable dans Réglages) ; elle est stockée sur l'appareil et n'est envoyée qu'au scraper. La classe et les spécialités sont déduites du profil et des matières suivies pour choisir l'ouvrage de la matière du devoir. Les identifiants du portail ne sont PAS acceptés : le scraper ne s'authentifie pas (sa session est son cookie jar local), un corps qui les porte est refusé. L'endpoint n'a pas d'authentification ; ne l'exposer qu'avec un proxy authentifié. Le cookie jar est local et gitignoré. Voir le risque SSRF dans [les invariants](architecture/INVARIANTS.md).
- **Page web (facultatif, #634)** : une URL http(s) publique peut être confiée à `POST /v1/web/scrape`. Même garde SSRF et même plafond que le manuel, mais aucun cookie jar et aucun identifiant : le contenu non textuel est refusé. La réponse ne contient que titre + texte, jamais l'URL ; l'app en fait une source citée « Web : titre », marquée Untrusted avant l'IA. Sans texte, aucune source n'est ajoutée.
- **Signature APK release** : keystore hors du dépôt (voir [`RELEASE.md`](RELEASE.md)).
- **Corpus Pronote** : le replay Kotlin utilise `tests/fixtures/pronote/` si ce répertoire gitignoré existe localement. Il contient des données personnelles : ne jamais le publier.
- **Outillage Android** : si `make check` échoue sur `android-compile`, fournir un JDK 17–21 et SDK Android 37 :
  le JDK 17-21 vit dans `~/.cache/jdk17` (tarball d'origine souvent encore dans
  `~/.cache/dl/jdk17.tar.gz` — extraire avec `--strip-components=1`), le SDK dans
  `~/.cache/android-sdk`. Un nettoyage de `~/.cache` les efface : la cible
  échoue bruyamment (jamais de faux vert) tant qu'ils manquent —
  `ALLOW_SKIP_ANDROID=1` assume explicitement ce saut (usage local, hors merge).
- `make android-compile` tente Gradle hors-ligne d'abord, puis
  replie EN LIGNE. Sur certaines machines le JVM ne reçoit jamais la réponse de
  `dl.google.com` (3 × 28 s de `SocketTimeoutException` alors que curl y répond en
  0,9 s : environnement JVM/réseau, pas le dépôt) — sans `--offline`, chaque
  configuration Gradle coûte ~95 s au lieu de ~1 s.
