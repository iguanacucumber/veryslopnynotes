# BUILD.md — comment le gate est construit et pourquoi

Détail du `Makefile` et de `check.ts` ; `AGENTS.md` reste court.

## `make check` — le gate de merge (9 étapes)

Toutes les étapes tournent en parallèle (`check.ts`) ; seul goulot : le CPU
(16 cœurs). Chaque étape est une cible `make -s` : une recette, jamais
dupliquée.

| Étape | Ce qu'elle vérifie |
|---|---|
| `android-compile` | Compilation Kotlin RÉELLE + Android Lint (`:app:lintDebug`), même invocation Gradle. Seul filet qui résout les symboles. |
| `unit` | `bun test tests/unit --parallel`, filtré par `agents/runtime/test-output.ts`. |
| `typecheck` | `tsc --noEmit` (racine). |
| `architecture` | Construit le bundle Vite une fois, puis scans d'architecture + tests `tests/architecture`. |
| `contracts` | `bun test tests/contracts`. |
| `lint` | `agents/runtime/check-secrets.ts` (scan anti-secrets). |
| `audit` | `bun audit` (dépendances, réseau requis). |
| `web-typecheck` | `tsc -p web/tsconfig.json`. |
| `web-test` | `bun test tests/web` + architecture web, même filtre. |

### Sortie bornée

`unit` et `web-test` passent par `test-output.ts` : fichier:ligne, première
erreur, Expected/Received, PREMIER hunk, 10 échecs max ; log complet dans
`gate-logs/<cible>.log`. Code de sortie forwardé (jamais de vert fabriqué).

`android-compile` journalise Gradle dans `gate-logs/android-compile.log` ;
`kotlin-errors.ts` n'affiche que les `e:` (10 max).

### Pourquoi le gate ne peut pas être allégé

- **Android Lint et la compilation Kotlin** (#627) : les miroirs TS ne voient pas une surcharge ambiguë ou un import manquant côté Kotlin. Sans `kotlinc` + `java`, toute la parité TS ↔ Kotlin saute → faux vert. `REQUIRE_KOTLIN_TOOLCHAIN=1` est donc posé par le gate.
- **`ALLOW_SKIP_ANDROID=1`** : opt-in EXPLICITE pour assumer le skip de la compile Kotlin hors merge (poste sans outillage). Le skip reste bruyant.
- **`MAKEFLAGS` / `make -i`** (#523) : ferait ignorer l'échec d'une recette et verdir un gate rouge. Le harnais lance les make enfants sans `MAKEFLAGS`, et `check` est une `$(error)` de MAKE (ignorée par `-i`) qui refuse tout code ≠ 0.
- **Gate en deux phases** : `check-run` écrit le code de sortie, `check` refuse tout code ≠ 0 par `$(error)`. Sans statut, le gate n'a pas tourné = échec.
- **CI** : rejoue exactement le même gate (`make check`), cache dépendances + port de parité, jamais le build cache Gradle.

### Port de parité : un jar à froid, des morceaux à chaud

L'union (production + pilotes) est compilée d'un bloc à froid, puis découpée
par `SourceFile` en `port.jar` et `drivers.jar`. Pilotes modifiés seulement :
overlay recompilé contre `port.jar` seul (une déclaration supprimée ne renaît
pas du cache), lancé en `overlay.jar:drivers.jar:port.jar`. La CI indexe sur
l'empreinte des **sources de production**.

### `make check-fast`

Tout sauf `android-compile` (~3,2 s à chaud) ; `architecture` teste `buildWebUi`
sur vrai Gradle. Usage interne, jamais avant une PR.

## Autres cibles `make`

- `watch` : `bun test --watch` (unitaires + web, séquentiel).
- `shot` : capture sur téléphone réel via Gradle (`buildDebugApk` d'abord, puis deep link, vérification de route). JDK/SDK découverts par `agents/runtime/android-env.sh`.
- `buildDebugApk` / `buildRelApk` / `updateApkToPhone` : Gradle, JDK/SDK requis, échec bruyant si outillage absent.
- `runServer` : scraper de manuels HTTPS sur `127.0.0.1:8080` (TLS généré hors dépôt, jamais de repli en clair). `HOST=0.0.0.0` uniquement sur réseau de confiance.
- `build` : image serveur Docker + scan de secrets.
- `web-smoke` : navigateur (Chromium), hors `make check`.
- `papillonRef` : frames de référence, réseau = échec bruyant, hors gate.

## Contexte Android

JDK 17–21 et SDK Android 37. `agents/runtime/android-env.sh` en découle (borne 17–21, une seule implémentation partagée). `local.properties` est gitignoré (chemin propre à la machine) et copié par `agents/launch.sh` dans chaque nouveau worktree.
