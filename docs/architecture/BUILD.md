# BUILD.md — comment le gate est construit et pourquoi

Détail du `Makefile` et de `check.ts`.

Protection de `main` et checks : [`BRANCH-PROTECTION.md`](BRANCH-PROTECTION.md).

## `make check` — le gate de merge (9 étapes)

Toutes les étapes tournent en parallèle (`check.ts`) ; seul goulot : le CPU.
Chaque étape est une cible `make -s` : une recette, jamais dupliquée.

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

Sans `android-compile` ni `audit` (réseau), mais la parité TS ↔ Kotlin tourne
si `kotlinc`/`java` sont là et `architecture` teste `buildWebUi` sur vrai
Gradle : durée variable, jamais une preuve avant PR.

## Politique anti-flake (#924)

Le smoke navigateur n'a ni sleep fixe ni `waitForTimeout` : chaque attente est
un ÉVÉNEMENT (serveur qui répond, DOM stable) borné par un délai explicite, et
chaque job porte un `timeout-minutes`. La suite axe/captures suit la même règle
(un worker, horloge figée, aucun `retry`). Seul le job `web-smoke` a droit à UNE
reprise automatique en CI ; le gate `check` n'en a AUCUNE. Les captures
(`web-smoke-shots`) et les logs (`gate-logs`) partent en artefact 7 jours, y
compris en échec. Deux échecs identiques = défaut, pas flake : ne pas relancer
à la main.

## Smoke émulateur (#891)

Le job CI `emulator-smoke` installe l'APK **debug** sur un émulateur épinglé
(`ReactiveCircus/android-emulator-runner` par SHA, API 35, `google_apis`,
`x86_64`), clique « Connexion démo » — le compte **public** de l'éditeur, aucun
identifiant saisi — puis exige l'accueil (route `#/`, titre `Accueil`, barre de
navigation). Il ne lit ni `.env`, ni secret, ni corpus scolaire.

`agents/runtime/emulator-smoke.ts` pilote l'app par le CDP de la WebView
(débogage activé en debug). Il borne chaque attente par une échéance nommée
(boot, installation, socket CDP, bouton, accueil) et n'a **aucune reprise** :
deux échecs identiques sont un défaut (#924). Les captures d'appairage et
d'accueil, le DOM observé et le logcat de l'application partent en artefact
`emulator-smoke` 7 jours, y compris en échec.

Le job est **non bloquant** (`continue-on-error: true`) : l'émulateur et l'hôte
de démonstration sont hors du dépôt. Il n'est donc pas requis au ruleset et ne
bloque pas un merge. Sa promotion (retirer `continue-on-error`, puis ajouter le
check requis) se décide sur des **runs réels** — une série verte sans reprise —
jamais dans la PR qui l'introduit.

## Couverture (#895)

`make coverage` est HORS du gate : une exécution des tests alimente deux
mesures — Bun (`coverage/bun/lcov.info`, lignes touchées par `tests/unit` +
`tests/web` + `tests/contracts`) et JaCoCo sur le port de parité
(`coverage/kotlin/html/`, `jacoco.xml`), seul Kotlin exécuté en CI (pas de
source `test/` Gradle). JaCoCo est épinglé par version et sha256
(`agents/runtime/coverage.ts`). Les tests d'architecture sont exclus : ils
scannent des déclarations.

`coverage-baseline.json` porte la MESURE (date, machine, périmètre) et
`headroomPoints = 2` : seuil = `plancher(mesure - 2 points)` (80,45 % → 78,4
%). La marge absorbe la variation mesurée de Bun (moins d'un point entre le
poste et la CI) sans laisser passer une baisse réelle ; une baisse sous le
seuil rougit le job.
Baisser la base exige un **diff explicite** dans la PR ; une hausse de
couverture remonte la base dans la même PR.

Le job CI `coverage` rejoue `make coverage` et garde `coverage/` 7 jours,
même en échec. Non requis au ruleset, mais `ship.sh` refuse un check rouge.

## Autres cibles `make`

- `watch` : `bun test --watch` (unitaires + web, séquentiel).
- `coverage` : rapports Bun + JaCoCo et seuil (voir ci-dessus), hors gate.
- `shot` : capture sur téléphone réel via Gradle (`buildDebugApk` d'abord, puis deep link DEBUG, vérification de route). JDK/SDK découverts par `agents/runtime/android-env.sh`.
- `buildDebugApk` / `buildRelApk` / `updateApkToPhone` : Gradle, JDK/SDK requis, échec bruyant si outillage absent.
- `runServer` : scraper de manuels HTTPS sur `127.0.0.1:8080` (TLS généré hors dépôt, jamais de repli en clair). `HOST=0.0.0.0` uniquement sur réseau de confiance.
- `build` : image serveur Docker + scan de secrets.
- `web-smoke` : navigateur (Chromium), hors `make check` : axe WCAG 2.0 → 2.2
  A/AA (clair/sombre), contrastes et captures `tests/visual/__screenshots__/`.
- `papillonRef` : frames de référence, réseau = échec bruyant, hors gate.

## Contexte Android

JDK 17–21 et SDK Android 37. `agents/runtime/android-env.sh` en découle (borne 17–21, une seule implémentation partagée). `local.properties` est gitignoré (chemin propre à la machine) et copié par `agents/launch.sh` dans chaque nouveau worktree.
