# Release (issue #32)

Procédure serveur + APK. Règle or : aucun secret, `.env*`, clé, donnée
perso dans le livrable. Clé signature TOUJOURS hors repo.

## Versions épinglées

| Composant | Version | Source | Licence |
|---|---|---|---|
| bun (runtime) | 1.4.4 | `Dockerfile.server` `oven/bun:1.4.4`, ADR-001 | MIT (runtime, ISC-compatible) |
| typescript | 7.0.2 | `package.json` exact + `bun.lock` | Apache-2.0 |
| @types/bun | 1.4.4 | `package.json` exact + `bun.lock` | MIT |
| bun-types (transitif) | 1.4.4 | `bun.lock` | MIT |
| @types/node (transitif) | 26.6.4 | `bun.lock` | MIT |
| undici-types (transitif) | 8.9.0 | `bun.lock` | MIT |
| Gradle / AGP / Kotlin | 9.8.2 / 9.5.0 / 2.4.21 | wrapper + `android/gradle/libs.versions.toml` | Apache-2.0 |
| compileSdk/targetSdk/minSdk | 37 / 37 / 26 | `android/app/build.gradle.kts` | — |
| activity-ktx / OkHttp | 1.13.0 / 5.5.1 | `android/gradle/libs.versions.toml` | Apache-2.0 |
| zxing-android-embedded | 4.3.0 | `android/gradle/libs.versions.toml` | Apache-2.0 |
| react / react-dom | 19.3.1 | `package.json` exact + `bun.lock` | MIT |
| react-router-dom | 7.18.4 | `package.json` exact + `bun.lock` | MIT |
| vite / @vitejs/plugin-react | 8.3.5 / 6.1.2 | `package.json` exact + `bun.lock` | MIT |
| rolldown (transitif) | 1.2.14 | `bun.lock` | MIT |
| lightningcss (transitif) | 1.33.0 | `bun.lock` | MPL-2.0 (build uniquement, non distribué) |
| tough-cookie | 6.0.2 | `package.json` exact + `bun.lock` | BSD-3-Clause |

Les versions des dépendances Android (AGP, Kotlin, AndroidX, OkHttp, zxing)
vivent toutes dans `android/gradle/libs.versions.toml` :
`tests/architecture/gradle-versions.test.ts` verrouille catalogue = classpath
racine = CI, et refuse toute version en dur dans un `build.gradle.kts`.

Les dépendances applicatives sont compatibles GPL-3.0-only (MIT, Apache-2.0,
BSD-3-Clause). `lightningcss` (Vite) et `axe-core` (tests) sont MPL-2.0 mais
restent des outils de build/test, non embarqués : la licence reste
GPL-3.0-only. `bun run check:licenses` refuse toute licence nouvelle ou
inconnue. Nouvelle dép = justifiée, épinglée, compatible (ADR-008).

## Android toolchain

Builds require JDK 17–21 and Android SDK 37 (`platforms;android-37.0`,
`build-tools;36.0.0`, `platform-tools`). Set `ANDROID_HOME` or `sdk.dir` in
`android/local.properties`; JDK detection accepts `ANDROID_JDK_HOME`.

`make check` runs `android-compile` in parallel with other checks: one Gradle
invocation compiles all modules and runs `:app:lintDebug` (Android Lint — a
lint error fails the gate). If JDK or SDK
is missing, it fails: the Kotlin compile is the only check that resolves
symbols and overloads, so skipping it silently would be a false green. Set
`ALLOW_SKIP_ANDROID=1` to assume that skip explicitly (outside merges); APK
build targets fail instead.

## Serveur (Docker)

```sh
make build   # check-secrets + docker build (skip si daemon absent)
```

- Base `oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d`
  (index multi-arch ; corrige CVE-2026-111497). Renouveler : `docker pull`,
  relever `RepoDigests` et reporter tag + digest dans `Dockerfile.server`.
- Install strict `bun install --frozen-lockfile` (aucun fallback).
- Chromium installé AU BUILD : `bunx playwright install --with-deps chromium`
  (le paquet `playwright` n'a aucun script d'installation : sans cette ligne,
  `chromium.launch()` échoue et le scrape répond 501 « scraper sans
  navigateur »). `playwright` est une devDependency : ne pas passer
  `--production` à l'install.
- Utilisateur NON PRIVILÉGIÉ (`USER vsn`) : le service pilote Chromium et
  écrit un jar de session — en root, il laissait des fichiers root, et
  Chromium refuse le sandbox en root. `HOME` est celui de cet utilisateur
  (sinon Chromium n'écrit pas son profil). Le sandbox reste ACTIF : la
  commande de `server/README.md` fournit le profil seccomp étroit
  `server/chromium-seccomp.json` ; sans user namespaces, le scrape échoue au
  lieu de tourner non sandboxé.
- TLS OBLIGATOIRE et exposition LOOPBACK par défaut : le CMD refuse de
  démarrer sans `TLS_CERT_FILE`/`TLS_KEY_FILE` (I8 — jamais de repli en clair) ;
  la commande de `server/README.md` publie `127.0.0.1:3000` et exige un proxy
  authentifié au-delà ; hors loopback, `ALLOW_PUBLIC=1` + jeton Bearer. `HOST`
  non forcé.
- Sonde `HEALTHCHECK` sur `/v1/ready`, drain `SIGTERM` (35 s) et limites
  cgroup documentées : `server/README.md`.
- Contexte minimal (`server/`, `shared/` + manifests) ; `.dockerignore`
  exclut `.env*`, clés (`*.pem/*.key/*.keystore/*.jks`), `secrets/`,
  données (`data/`, `*.db`), `android/`, `tests/`, `agents/`, `docs/`.
- Vérifier : `bun run agents/runtime/check-secrets.ts` OK,
  `bun audit` propre (0 vulnérabilité), `bunx tsc --noEmit` OK.

## Version Android (tag git, #927)

Le tag `vX.Y.Z` posé sur le commit construit fixe les deux champs :
`versionName = X.Y.Z` et `versionCode = X * 1_000_000 + Y * 1_000 + Z`.
`Y` et `Z` doivent rester `< 1000`, et le code sous le plafond Android
`2_100_000_000` ; sinon le build échoue au lieu de publier un code ambigu.
Sans tag, le repli est déterministe : `0.1.0` / `1` (dev seulement).
Les tags de pré-release (`v1.2.3-beta.1`) sont refusés : le `versionCode` ne
peut pas rester croissant entre une pré-release et sa version finale (voir
REL-05). Un build release doit donc partir d'un checkout qui contient le tag
sur `HEAD` (`fetch-depth: 0` ou `fetch-tags: true` en CI).

Le calcul pur vit dans `agents/runtime/android-version.ts`, testé par
`tests/unit/version-from-tags.test.ts` ; Gradle l'appelle une seule fois avec
`providers.exec`, sans réseau.

## APK release (clé hors repo, repli debug #297)

1. Générer keystore une fois, hors repo (jamais commité, `.gitignore`
   `*.keystore/*.jks`) :
   ```sh
   keytool -genkeypair -keystore ~/.keystore/vsn-release.jks -alias vsn -keyalg RSA -keysize 2048 -validity 9125
   ```
2. Configurer sans commiter (`~/.gradle/gradle.properties` ou env) :
   ```properties
   release.storeFile=/home/user/.keystore/vsn-release.jks
   release.storePassword=...
   release.keyAlias=vsn
   release.keyPassword=...
   ```
   ou env `STORE_FILE/STORE_PASSWORD/KEY_ALIAS/KEY_PASSWORD`.
3. Builder :
   ```sh
   make buildRelApk   # equivalent : cd android && ./gradlew assembleRelease
   ```
   L'interface React est construite avant Gradle (`bun run build:web`, tâche
   Gradle `preBuild`) et copiée dans les assets de l'APK ; `MainActivity`
   l'affiche dans la WebView locale (ADR-004). Les notices de licence tierces
   (`web/public/licenses/` : GPL de l'app, MIT, Apache-2.0, SN Pro OFL,
   Papicons MIT) sont copiées dans `assets/web/licenses/` et voyagent donc
   avec l'APK ; l'inventaire versionné est `THIRD_PARTY_NOTICES.md`.
   Produit un APK signé :
   `android/app/build/outputs/apk/release/app-release.apk` (sideload).

   Avec clé : signature custom. Sans clé : repli debug
   (installable sideload, sans cert custom — ne pas publier comme mise à
   jour d'un APK signé custom, signature différente).
   `SERVER_HOST` via `local.properties` `server.host` ou env (défaut release
   VIDE, HTTPS-only ; le défaut émulateur `10.0.2.2:3000` et le clair
   n'existent qu'en debug). La release pose `DEMO_MODE=false` : démo refusée,
   bouton absent, session non restaurée
   (`tests/architecture/demo-mode.test.ts`).
4. Vérifier : `apksigner verify --print-certs`, aucune clé/secret dans
   l'artefact, `git status` propre (APK ignoré `*.apk`).

## Liens profonds et App Links

Politique : **aucun App Link** ; le deep link par schéma privé
`veryslopnynotes://<route>` n'existe qu'en **debug** (captures `make shot`). La
release ne déclare ni `VIEW` ni `BROWSABLE` : l'APK publié ne répond à aucune
URL extérieure. Un App Link exigerait un hôte `https` vérifié,
`assetlinks.json` servi par ce domaine et `android:autoVerify="true"` ; l'app
n'a pas de domaine public, donc aucun n'est revendiqué.

Preuve `adb`, sur l'APK **release** puis **debug** :

```sh
# Release : doit ÉCHOUER, aucune activité ne résout l'intent.
adb shell am start -W -a android.intent.action.VIEW \
  -c android.intent.category.BROWSABLE -d "veryslopnynotes://grades"
# -> Error: Activity not started, unable to resolve Intent

# Debug : la même commande doit ouvrir l'écran Notes.
```

## Notes de version

Chaque PR ajoute sa ligne sous `[Unreleased]` de
[`CHANGELOG.md`](../CHANGELOG.md), catégorie Keep a Changelog. Au tag,
renommer `[Unreleased]` en `## [x.y.z] - AAAA-MM-JJ`, recréer une section
`[Unreleased]` vide, puis recopier **tel quel** ce corps dans la GitHub
Release : la note publiée est la section du changelog.

Signaux, seuils et retrait :
[RELEASE-HEALTH.md](RELEASE-HEALTH.md) ; incidents :
[INCIDENTS.md](INCIDENTS.md).

## Check-list avant livrable

- [ ] `make build` OK (ou `check-secrets` + `tsc` si daemon absent).
- [ ] `make web` OK (typecheck + tests + build local).
- [ ] `bun audit` : 0 vulnérabilité.
- [ ] `git status` : aucun `.env*`, `*.keystore`, `*.apk`, donnée perso.
- [ ] `bun run agents/runtime/check-secrets.ts` : OK.
- [ ] APK release : `am start` sur `veryslopnynotes://<route>` échoue (aucun deep link).
