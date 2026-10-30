# INVARIANTS.md — registre des règles vérifiées

Un invariant est une propriété du produit ou du build qui doit rester vraie ;
une régression est bloquante, même si la fonctionnalité marche. Ce fichier est
un **index** : une ligne par invariant, le détail par thème. Format, ajout et
retrait : [`invariants/OPERATING.md`](invariants/OPERATING.md) ; carte
tâche → entrée : [`../CONTEXT.md`](../CONTEXT.md).

## Architecture actuelle

- `android/` est l'appareil client ; seul `android/pronote/` parle à Pronote.
- Arêtes Gradle : `core`/`pronote` sans dépendance, `data` → `core`+`pronote`,
  `app` → `core`+`data`.
- `web/` est l'interface React embarquée dans la WebView ; aucun réseau, pont
  natif (`android/app/.../VsnBridge.kt`).
- `server/` sert uniquement le scraper de manuels, un sidecar optionnel.
- `shared/contracts/` décrit les routes du scraper et les validateurs partagés.

## Registre

| ID | Règle | Vérification principale | Détail |
|---|---|---|---|
| I1 | Seul `android/pronote/` (et le scraper) parle réseau ; frontière Gradle, un seul `Client`, serveur jamais Pronote. | `tests/architecture/invariants.test.ts` | [`I1`](invariants/frontieres.md#i1) |
| I4 | Le prompt LLM est vérifié et borné : secret refusé, prompt vérifié = envoyé, budget déduit, sortie validée. | `tests/unit/kotlin-llm-guard.test.ts` | [`I4`](invariants/ia.md#i4) |
| I6 | Tout contenu externe est marqué `Untrusted` ; aucun MIME exécutable. | `tests/unit/android-untrusted.test.ts` | [`I6`](invariants/ia.md#i6) |
| I8 | Le scraper est un sidecar local, sans auth, borné et sans SSRF ; jar choisi par le serveur, login jamais ingéré. | `tests/unit/scraper-ssrf.test.ts` | [`I8`](invariants/frontieres.md#i8) |
| I10 | WebView sans réseau ni secret ; pont borné, une réponse par entrée, jamais saturé. | `tests/architecture/web.test.ts` | [`I10`](invariants/frontieres.md#i10) |
| I11 | `.agents/` est verrouillé, scanné et sans fuite. | `tests/architecture/skills-lock.test.ts` | [`I11`](invariants/build.md#i11) |
| I13 | Le pont factice n'existe qu'en dev ; absent en prod = échec. | `tests/architecture/web-mock.test.ts` | [`I13`](invariants/build.md#i13) |
| I14 | « Invalide » n'est jamais « vide » (fail-closed, sauf capabilities). | `tests/unit/kotlin-core-validation-parity.test.ts` | [`I14`](invariants/ia.md#i14) |
| I15 | Export PDF = corps entier + sources canoniques ; troncature signalée. | `tests/unit/kotlin-revision-sheet.test.ts` | [`I15`](invariants/ia.md#i15) |
| I16 | La donnée d'un compte n'est servie qu'à ce compte et purgée avec lui (cache, offline, téléchargements, session morte). | `tests/unit/kotlin-cache-scope.test.ts` | [`I16`](invariants/donnees.md#i16) |
| I17 | Un seul rafraîchissement de session à la fois ; rate-limit ≠ session morte. | `tests/unit/kotlin-refresh-gate.test.ts` | [`I17`](invariants/donnees.md#i17) |
| I18 | Keystore indisponible = état `UNAVAILABLE` signalé, jamais un secret en clair. | `tests/unit/kotlin-store-health.test.ts` | [`I18`](invariants/donnees.md#i18) |
| I19 | Le job et l'interface lisent par la même file ; session restaurée d'abord, résultat toujours livré. | `tests/architecture/shared-queue.test.ts` | [`I19`](invariants/donnees.md#i19) |
| I22 | Le gate ne peut pas être neutralisé par l'environnement. | `tests/unit/check-runner.test.ts` | [`I22`](invariants/frontieres.md#i22) |
| I25 | Une réponse périmée n'écrit pas dans l'écran : payload lié à sa requête, réponse tardive ignorée. | `tests/web/grades.test.ts` | [`I25`](invariants/ia.md#i25) |
| I31 | Un enregistrement publié = une ligne (clé kind + id). | `tests/unit/kotlin-payload-dedupe.test.ts` | [`I31`](invariants/donnees.md#i31) |
| I32 | Une photo ne part que sur geste explicite, ré-encodée et bornée. | `tests/unit/kotlin-vision.test.ts` | [`I32`](invariants/ia.md#i32) |
| I33 | La sauvegarde Android n'emporte jamais les payloads en clair. | `tests/architecture/backup.test.ts` | [`I33`](invariants/donnees.md#i33) |
| I34 | Une seule version Kotlin : catalogue = classpath racine = CI. | `tests/architecture/gradle-versions.test.ts` | [`I34`](invariants/build.md#i34) |
| I35 | Cours complet et pièces jointes extraites localement, bornées, sans HTML rendu. | `tests/unit/attachment-text.test.ts` | [`I35`](invariants/ia.md#i35) |

## Retirés

Une ligne par ID retiré (date, issue, remplacement). Sauf mention, retrait
le 2026-10-29 via #649.

| ID | Retrait |
|---|---|
| I2 | I1 (frontière Gradle, un seul `Client`) |
| I3 | I1 (core pur, sans réseau ni SQLite/Room) |
| I5 | I4 (prompt borné, budget déduit, sortie validée) |
| I7 | 2026-10-28, #642 : convention, jobs purs = données structurées |
| I9 | 2026-10-28, #638 : Android Lint + detekt |
| I12 | I19 (même file, session restaurée avant lecture) |
| I16 bis | I16 |
| I20 | I10 (pont borné, jamais saturé) |
| I21 | I16 (session morte = purge, par type/code) |
| I23 | I8 (sidecar local : non-root, TLS) |
| I24 | I8 (jar choisi par le serveur) |
| I26 | I16 (téléchargements purgés avec le compte) |
| I27 | I25 (réponse périmée ignorée) |
| I28 | I19 (résultat toujours livré) |
| I29 | I8 (sans auth, page de login refusée) |
| I30 | I8 (plafond HTML avant matérialisation) |

## Détail

Dans [`invariants/`](invariants/), un fichier par thème (frontières, données,
IA, build) ; chaque entrée porte son ancre `#i<n>` et suit
[`OPERATING.md`](invariants/OPERATING.md).
