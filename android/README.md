# android/ — client natif from scratch (phase 4, issue #13)

Règle d'or réseau : aucun hôte tiers ici. Un seul hôte serveur allowlist
(jamais en dur), un seul OkHttp (`data/ApiClient`), médias via proxy serveur,
pas de WebView distante. Voir `docs/architecture/INVARIANTS.md` (I1) et
`core/ServerConfig`.

Modules : `app/` (Activity + navigation), `core/` (config allowlist),
`data/` (client HTTP unique), `ui/` (écrans Compose Material3).

## Serveur : choisi à l'exécution, le build fournit le défaut

L'adresse est saisie à l'étape 1 de l'**assistant de connexion** (on ne peut pas
se connecter sans connaitre son serveur) et persistée par `data/ServerStore`. La
valeur `BuildConfig` ci-dessous n'est plus qu'une **graine** : elle sert quand
rien n'est choisi.

## Assistant de connexion (3 étapes, un seul appel)

Lancement → **1. ton serveur** (validé, puis `GET /v1/health` : sa version de
contrat s'affiche) → **2. ton compte EduConnect** (adresse de l'établissement +
identifiants, ou « j'ai seulement un QR ») → **3. le QR de l'application de
l'établissement** (contenu `login`+`jeton` + son PIN, ou les identifiants de
l'étape 2). Un seul `POST /v1/setup` ouvre la session de l'établissement ET rend
le jeton d'appareil, stocké chiffré. Sans jeton appairé, le démarrage ouvre
l'assistant au lieu de l'accueil ; après un 401 ou un redémarrage du serveur,
c'est lui qui rouvre la session **et** le credential.

Aucun mot de passe n'est écrit sur le téléphone : il part dans le POST, le
serveur le garde en mémoire pour renouveler la session. Le QR se colle pour
l'instant (scan caméra : issue suivante).

L'allowlist est donc `core/ServerConfig.validateBaseUrl` (et `isAllowed` en
préfixe strict), pas une constante de build : `https` obligatoire, `http` uni-
quement pour `10.0.2.2`/`localhost`, hôte IPv4/IPv6-littérale/nom DNS borné,
port 1-65535, et refus de tout identifiant, chemin, query, fragment, espace ou
caractère de contrôle. Un changement de serveur invalide la session et purge
les caches par le chemin existant `AccountStore.logout()` (le jeton d'appareil
est un bearer pour l'ancien serveur), AVANT d'utiliser la nouvelle adresse.

## Config hôte serveur (jamais commité, jamais en dur)

`local.properties` (non commité, modèle ci-dessous) ou env `SERVER_HOST` :

```properties
server.host=10.0.2.2:3000
```

Défaut émulateur `10.0.2.2:3000` (http local). Hors émulateur : HTTPS-only
(`app/build.gradle.kts` force `https` sauf `10.0.2.2`/`localhost`).
`./gradlew installDebug` utilise le défaut sans config ; l'utilisateur peut le
remplacer ensuite depuis l'app.

## Build debug (SDK requis, pas de réseau tiers)

```sh
cd android
./gradlew assembleDebug
```

Versions figées (ADR-001) : Gradle 8.7, AGP 8.5.2, Kotlin 1.9.24,
compileSdk/targetSdk 34, minSdk 26, Compose BOM 2024.06.00, OkHttp 4.12.0.
Zéro dépendance ajoutée au-delà de la stack (Compose Material3 +
navigation-compose + OkHttp + core-ktx/activity, licences Apache-2.0).

## Release signée (issue #32, clé hors repo)

Voir `docs/RELEASE.md` (procédure complète) :

```sh
cd android
./gradlew assembleRelease   # signé si STORE_FILE (+ mots de passe/alias) présent, sinon non signé
```

Keystore généré une fois hors repo (`keytool -genkeypair ...`), config via
`~/.gradle/gradle.properties` (`release.storeFile/storePassword/keyAlias/
keyPassword`) ou env `STORE_FILE/STORE_PASSWORD/KEY_ALIAS/KEY_PASSWORD`.
Jamais commité (`.gitignore` `*.keystore/*.jks`, APK `*.apk` ignoré).
Vérifier : `jarsigner -verify`, `check-secrets` OK.

## Renvoyé phases suivantes (hors scope #13)

- #14 offline : cache Room + affichage sans réseau.
- Scan caméra du QR (colle seule pour l'instant) : le parseur `parseSchoolQr`
  est déjà en place, il ne manque que la capture.
- Persistance serveur (SQLite) : aujourd'hui un redémarrage fait refaire le setup.
- Phase 10 : pinning cert (reste hors scope, release #32 faite).

