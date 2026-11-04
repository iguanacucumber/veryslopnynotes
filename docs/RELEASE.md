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

## Version Android (tag git, #927, #936)

Le tag `vX.Y.Z` (finale) ou `vX.Y.Z-beta.N` (pré-release) posé sur le commit
construit fixe le `versionName` (`X.Y.Z` ou `X.Y.Z-beta.N`) et
`versionCode = X * 1_000_000_000 + Y * 1_000_000 + Z * 1_000 + R`, avec `Y` et
`Z` < 1000, `R = 999` pour une finale et `R = N` pour `-beta.N` (`1 ≤ N ≤ 998`).
Le code doit rester sous le plafond Android `2_100_000_000` : `X ≤ 2`, et
`X = 2` limite `Y ≤ 99`. Sans tag : repli `0.1.0`/`1` (dev).

Le slot `R` rend le code strictement croissant : `beta.1 < beta.2 < finale`
pour une même version, et `X.Y.(Z+1)-beta.1` est au-dessus de `X.Y.Z`. Une
finale s'installe donc par-dessus ses bêtas sans désinstallation ; revenir
d'une finale à une bêta (ou d'une bêta à une bêta antérieure) est un
**downgrade** : Android le refuse, et désinstaller efface les données locales.
Un checkout release doit contenir le tag sur `HEAD` (`fetch-depth: 0`). Calcul
pur : `agents/runtime/android-version.ts`, testé par
`tests/unit/version-from-tags.test.ts`.

## APK release (clé hors repo, repli debug #297)

Cycle de vie complet — génération `keytool`, custody, secrets de
l'environnement `release`, empreinte publiée, vérification `apksigner`,
rotation, compromission — et check-list : [SIGNING.md](SIGNING.md). La clé et
ses mots de passe restent TOUJOURS hors dépôt ; aucun secret dans un log ou un
artefact.

1. Builder (clé locale configurée selon [SIGNING.md](SIGNING.md)) :
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
2. Vérifier : `apksigner verify --print-certs <apk>`, empreinte égale à celle
   publiée ([SIGNING.md](SIGNING.md)), aucune clé/secret dans l'artefact,
   `git status` propre (APK ignoré `*.apk`).

## Budget de taille APK (#974)

[`apk-size-baseline.json`](../apk-size-baseline.json) (racine, unités :
octets) porte la mesure `measuredBytes` et le plafond `budgetBytes`.
`.github/workflows/apk-size.yml` télécharge l'artefact `release-apk` de
`release-artifact` sans reconstruire l'APK, mesure l'APK et échoue dès que sa
taille dépasse `budgetBytes` ; la mesure part dans le résumé du run et un
artefact `apk-size` conservé 90 jours. Sur une PR qui touche ces fichiers, il
n'exécute que les fixtures, sans APK réel.

Mesurer et vérifier localement :

```sh
bun run agents/runtime/apk-size.ts --apk android/app/build/outputs/apk/release/app-release.apk
```

Mettre à jour : relever la taille du dernier run CI, puis modifier
`measuredBytes`, `budgetBytes`, `measuredAt` et `measuredOn` dans la MÊME PR.
Une hausse du plafond se justifie dans la PR ; une baisse est toujours
bienvenue.

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

## Release sur tag

Avant le tag : renommer `[Unreleased]` de
[`CHANGELOG.md`](../CHANGELOG.md) en `## [x.y.z] - AAAA-MM-JJ`, recréer
`[Unreleased]` vide, merger, puis pousser `vX.Y.Z`.
`.github/workflows/release.yml` checkout le tag, calcule la version avec
`agents/runtime/android-version.ts`, réutilise `release-artifact.yml`, re-signe
avec la clé de l'environnement protégé `release`, vérifie certificat et
SHA-256, écrit `SHA256SUMS`, puis publie la GitHub Release : APK,
mapping/seeds, liens vers le tag et `archive/refs/tags/<tag>.tar.gz`
(GPL-3.0-only).

### Canal bêta

Un tag `vX.Y.Z-beta.N` publie une **pré-release** GitHub (`--prerelease`,
jamais « Latest »). Build, clé de signature, vérification du certificat,
`SHA256SUMS` et archive source sont identiques à la finale : aucune gate n'est
allégée. Seul le format `-beta.N` est accepté ; `-rc.N` et les autres suffixes
sont refusés avant le build.

Les notes de `vX.Y.Z-beta.N` viennent de la section `## [X.Y.Z]` (celle de la
future finale) ; une section `## [X.Y.Z-beta.N]` est utilisée en priorité si
elle existe. Numéroter les bêtas dans l'ordre : `versionCode` croît, et la
finale `X.Y.Z` s'installe par-dessus toutes ses bêtas. Une bêta ne se
« downgrade » pas : réinstaller une version antérieure exige une
désinstallation, donc la perte des données locales. Le parcours participant
(invitation, vérification, retour, sortie vers la finale) est dans
[BETA.md](BETA.md).

Secrets `release` : `RELEASE_KEYSTORE_BASE64` (PKCS12 base64),
`RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD`. Absent
= échec, aucun repli debug, aucune release ; l'environnement doit autoriser
les tags `v*`.

Dry-run : `gh workflow run release.yml --ref vX.Y.Z` ; un dispatch sur une
branche échoue et ne publie jamais.

Signaux, seuils et retrait :
[RELEASE-HEALTH.md](RELEASE-HEALTH.md) ; incidents :
[INCIDENTS.md](INCIDENTS.md).

## Check-list avant livrable

La checklist signée, ordonnée et opposable vit dans
[`RELEASE-CHECKLIST.md`](RELEASE-CHECKLIST.md) : gate, version, build,
signature, SHA-256, licences, confidentialité, CHANGELOG, source GPL, tag,
bêta, known-issues, annonce et retour arrière. Une release ne part qu'avec
toutes les cases cochées, les preuves jointes et les signatures humaines.
