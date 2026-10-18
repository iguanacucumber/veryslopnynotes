# Release (issue #32)

Procédure serveur + APK. Règle or : aucun secret, `.env*`, clé, donnée
perso dans le livrable. Clé signature TOUJOURS hors repo.

## Versions épinglées

| Composant | Version | Source | Licence |
|---|---|---|---|
| bun (runtime) | 1.4.2 | `Dockerfile.server` `oven/bun:1.4.2`, ADR-001 | MIT (runtime, ISC-compatible) |
| typescript | 5.9.3 | `package.json` exact + `bun.lock` | Apache-2.0 |
| @types/bun | 1.4.2 | `package.json` exact + `bun.lock` | MIT |
| bun-types (transitif) | 1.4.2 | `bun.lock` | MIT |
| @types/node (transitif) | 26.6.4 | `bun.lock` | MIT |
| undici-types (transitif) | 8.9.0 | `bun.lock` | MIT |
| Gradle / AGP / Kotlin | 8.7 / 8.5.2 / 1.9.24 | wrapper + `build.gradle.kts` | Apache-2.0 |
| compileSdk/targetSdk/minSdk | 34 / 34 / 26 | `android/app/build.gradle.kts` | — |
| Compose BOM / OkHttp | 2024.06.00 / 4.12.0 | `android/app/build.gradle.kts` | Apache-2.0 |
| react / react-dom | 19.1.1 | `package.json` exact + `bun.lock` | MIT |
| react-router-dom | 7.18.2 | `package.json` exact + `bun.lock` | MIT |
| vite / @vitejs/plugin-react | 7.3.5 / 5.1.1 | `package.json` exact + `bun.lock` | MIT |
| esbuild (transitif) | 0.27.2 | `bun.lock` | MIT |

Toutes compatibles MIT (MIT + Apache-2.0). Nouvelle dép = justifiée,
épinglée, licence MIT-compatible (ADR-001).

## Android toolchain

Builds require JDK 17–21 and Android SDK 34 (`platforms;android-34`,
`build-tools;34.0.0`, `platform-tools`). Set `ANDROID_HOME` or `sdk.dir` in
`android/local.properties`; JDK detection accepts `ANDROID_JDK_HOME`.

`make check` runs `android-compile` in parallel with other checks. If JDK or SDK
is missing, it reports an explicit skip; APK build targets fail instead. The
check compiles Kotlin modules with Gradle and is the only check that resolves
Kotlin symbols and overloads.

## Serveur (Docker)

```sh
make build   # check-secrets + docker build (skip si daemon absent)
```

- Base `oven/bun:1.4.2` exacte. Digest : `docker pull oven/bun:1.4.2`,
  figer `FROM oven/bun:1.4.2@sha256:<digest>` (daemon absent en local).
- Install strict `bun install --frozen-lockfile` (aucun fallback).
- Contexte minimal (`server/`, `shared/` + manifests) ; `.dockerignore`
  exclut `.env*`, clés (`*.pem/*.key/*.keystore/*.jks`), `secrets/`,
  données (`data/`, `*.db`), `android/`, `tests/`, `agents/`, `docs/`.
- Vérifier : `bun run agents/runtime/check-secrets.ts` OK,
  `bun audit` propre (0 vulnérabilité), `bunx tsc --noEmit` OK.

## APK + AAB release (clé hors repo, repli debug #297)

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
   make buildRelApk   # equivalent : cd android && ./gradlew assembleRelease bundleRelease
   ```
   L'interface React est construite avant Gradle (`bun run build:web`, tâche
   Gradle `preBuild`) et copiée dans les assets de l'APK ; `MainActivity`
   l'affiche toujours dans la WebView locale (ADR-004). Le build web ne fait
   aucun appel réseau et n'embarque aucun secret.
   Produit deux artefacts signés :
   - APK : `android/app/build/outputs/apk/release/app-release.apk` (sideload)
   - AAB : `android/app/build/outputs/bundle/release/app-release.aab` (Play Store)

   Avec clé : signature custom (store/upload key). Sans clé : repli debug
   (installable sideload, sans cert custom — ne pas publier comme mise à
   jour d'un APK signé custom, signature différente ; pour Play, fournir une
   vraie upload key, Play App Signing re-signant pour la distribution).
   `SERVER_HOST` via `local.properties` `server.host` ou env (défaut
   émulateur `10.0.2.2:3000`, HTTPS-only hors émulateur).
4. Vérifier : `apksigner verify --print-certs` (APK), `jarsigner -verify`
   (AAB), aucune clé/secret dans les artefacts,
   `git status` propre (APK/AAB ignorés `*.apk`/`*.aab`).

## Check-list avant livrable

- [ ] `make build` OK (ou `check-secrets` + `tsc` si daemon absent).
- [ ] `make web` OK (typecheck + tests + build local).
- [ ] `bun audit` : 0 vulnérabilité.
- [ ] `git status` : aucun `.env*`, `*.keystore`, `*.apk`, donnée perso.
- [ ] `bun run agents/runtime/check-secrets.ts` : OK.
