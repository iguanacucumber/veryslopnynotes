# android/ — client natif from scratch (phase 4, issue #13)

Règle d'or réseau : aucun hôte tiers ici. Un seul hôte serveur allowlist
(configuré au build, jamais en dur), un seul OkHttp (`data/ApiClient`),
médias via proxy serveur, pas de WebView distante. Voir
`docs/architecture/INVARIANTS.md` (I1) et `core/ServerConfig`.

Modules : `app/` (Activity + navigation), `core/` (config allowlist),
`data/` (client HTTP unique), `ui/` (écrans Compose Material3).

## Config hôte serveur (jamais commité, jamais en dur)

`local.properties` (non commité, modèle ci-dessous) ou env `SERVER_HOST` :

```properties
server.host=10.0.2.2:3000
```

Défaut émulateur `10.0.2.2:3000` (http local). Hors émulateur : HTTPS-only
(`app/build.gradle.kts` force `https` sauf `10.0.2.2`/`localhost`).
`./gradlew installDebug` utilise le défaut sans config.

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
- #15 pairing/SSE : QR+PIN côté app, SSE reconnect, token sécurisé.
- Phase 10 : pinning cert (reste hors scope, release #32 faite).

