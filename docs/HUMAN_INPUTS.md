# HUMAN_INPUTS.md — apports humains, sans valeurs secrètes

- **Compte Pronote** : l'utilisateur scanne le QR de l'application Pronote et saisit son PIN dans l'app. La session ne quitte pas le téléphone.
- **Clé OpenRouter** : saisie dans les réglages de l'app, stockée chiffrée et envoyée directement à OpenRouter. Aucun modèle ni secret à configurer côté serveur.
- **Scraper de manuels (facultatif)** : l'appelant fournit plateforme, identifiants du portail et URL de départ dans le corps de `POST /v1/manuals/scrape`. L'endpoint n'a pas d'authentification ; ne l'exposer qu'avec un proxy authentifié. Le cookie jar est local et gitignoré. Voir le risque SSRF dans [les invariants](architecture/INVARIANTS.md).
- **Signature APK release** : keystore hors du dépôt (voir [`RELEASE.md`](RELEASE.md)).
- **Corpus Pronote** : le replay Kotlin utilise `tests/fixtures/pronote/` si ce répertoire gitignoré existe localement. Il contient des données personnelles : ne jamais le publier.
- **Outillage Android** : si `make check` SKIPpe `android-compile`, fournir un JDK 17–21 et SDK Android 34 :
  le JDK 17-21 vit dans `~/.cache/jdk17` (tarball d'origine souvent encore dans
  `~/.cache/dl/jdk17.tar.gz` — extraire avec `--strip-components=1`), le SDK dans
  `~/.cache/android-sdk`. Un nettoyage de `~/.cache` les efface : la cible SKIPpe
  bruyamment (jamais de faux vert) tant qu'ils manquent.
- `make android-compile` tente Gradle hors-ligne d'abord, puis
  replie EN LIGNE. Sur certaines machines le JVM ne reçoit jamais la réponse de
  `dl.google.com` (3 × 28 s de `SocketTimeoutException` alors que curl y répond en
  0,9 s : environnement JVM/réseau, pas le dépôt) — sans `--offline`, chaque
  configuration Gradle coûte ~95 s au lieu de ~1 s.
