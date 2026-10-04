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

Toutes compatibles MIT (MIT + Apache-2.0). Nouvelle dép = justifiée,
épinglée, licence MIT-compatible (ADR-001).

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

## APK release (clé hors repo)

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
   Sans clé : build OK, APK non signé (à signer en local).
   `SERVER_HOST` via `local.properties` `server.host` ou env (défaut
   émulateur `10.0.2.2:3000`, HTTPS-only hors émulateur).
4. Vérifier : `jarsigner -verify`, aucune clé/secret dans l'APK,
   `git status` propre (APK ignoré `*.apk`).

## Check-list avant livrable

- [ ] `make build` OK (ou `check-secrets` + `tsc` si daemon absent).
- [ ] `bun audit` : 0 vulnérabilité.
- [ ] `git status` : aucun `.env*`, `*.keystore`, `*.apk`, donnée perso.
- [ ] `bun run agents/runtime/check-secrets.ts` : OK.
