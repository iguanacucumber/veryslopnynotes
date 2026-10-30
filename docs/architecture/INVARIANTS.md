# INVARIANTS.md — registre des règles vérifiées

Un invariant est une propriété du produit ou de la chaîne de build qui doit
rester vraie. Une régression est bloquante, même si la fonctionnalité marche.
Ce fichier est un **registre**, pas un journal d'incidents : le contexte
historique vit dans l'issue, le commit ou l'ADR.

Format d'une entrée : règle → test → commande → portée. Un identifiant est
unique et n'est jamais réutilisé. Une entrée tient en 120 mots ; au-delà, le
détail va dans un lien.

## Comment retirer un invariant

Une règle obsolète ou absorbée se **retire** sans renuméroter : supprimer son
entrée détaillée et sa ligne du registre, puis l'inscrire sous `## Retirés`
(ID, date, issue, remplacement éventuel). Retirer ≠ renuméroter — l'identifiant
n'est jamais réutilisé. Un trou entre I1 et la dernière entrée active n'est
toléré que si l'ID figure dans `## Retirés` ; un ID retiré qui réapparaît comme
entrée active échoue au gate.

## Comment ajouter ou réviser un invariant

1. Un incident réel ou une menace identifiée. Pas de règle spéculative.
2. Une règle en une phrase, vérifiable par un test qui échoue avant le
   correctif.
3. Comportement et types d'abord ; un scan de source est un dernier recours,
   avec sa raison et son chemin de remplacement.
4. Une ligne dans le registre ci-dessous, puis l'entrée détaillée.
5. Si la règle chevauche un invariant existant, réviser cet invariant au lieu
   d'en créer un second.

Une règle qui ne peut pas être testée est une convention, pas un invariant.
`tests/architecture/docs.test.ts` vérifie les identifiants, le format, les
références, l'existence des fichiers cités et les commandes citées.

## Architecture actuelle

- `android/` est l'appareil client ; seul `android/pronote/` parle à Pronote.
- Les arêtes de modules sont celles de Gradle : `core` et `pronote` sans
  dépendance, `data` → `core`+`pronote`, `app` → `core`+`data`.
- `web/` est l'interface React embarquée dans la WebView ; elle ne parle à
  aucun réseau et passe par le pont natif (`android/app/.../VsnBridge.kt`).
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

Une ligne par ID retiré : ID, date, issue, remplacement éventuel.

| ID | Date | Issue | Remplacement |
|---|---|---|---|
| I2 | 2026-10-29 | #649 | Fusionné dans I1 (frontière Gradle, un seul `Client`). |
| I5 | 2026-10-29 | #649 | Fusionné dans I4 (prompt borné, budget déduit, sortie validée). |
| I3 | 2026-10-29 | #649 | Fusionné dans I1 (frontière des modules : core pur, sans réseau ni SQLite/Room). |
| I7 | 2026-10-28 | #642 | Convention de revue : les jobs purs ne reçoivent que des données structurées Pronote. |
| I9 | 2026-10-28 | #638 | Android Lint (#627, dans le gate) et detekt — les appelants réels, pas le nom. Aucun retrait de code de production ici : les candidats morts partent dans une issue dédiée. |
| I12 | 2026-10-29 | #649 | Fusionné dans I19 (même file, session restaurée avant lecture). |
| I16 bis | 2026-10-29 | #649 | Fusionné dans I16 (donnée de compte purgée avec lui). |
| I20 | 2026-10-29 | #649 | Fusionné dans I10 (pont borné, jamais saturé). |
| I21 | 2026-10-29 | #649 | Fusionné dans I16 (session morte = purge, par type/code). |
| I23 | 2026-10-29 | #649 | Fusionné dans I8 (sidecar local : non-root, TLS). |
| I24 | 2026-10-29 | #649 | Fusionné dans I8 (jar choisi par le serveur). |
| I26 | 2026-10-29 | #649 | Fusionné dans I16 (téléchargements purgés avec le compte). |
| I27 | 2026-10-29 | #649 | Fusionné dans I25 (réponse périmée ignorée). |
| I28 | 2026-10-29 | #649 | Fusionné dans I19 (résultat toujours livré). |
| I29 | 2026-10-29 | #649 | Fusionné dans I8 (sans auth, page de login refusée). |
| I30 | 2026-10-29 | #649 | Fusionné dans I8 (plafond HTML avant matérialisation). |

## Détail

Le détail est découpé par thème. Pour un invariant, ouvrir **un seul** fichier :

- [`invariants/frontieres.md`](invariants/frontieres.md) — I1, I8, I10, I22
- [`invariants/donnees.md`](invariants/donnees.md) — I16, I17, I18, I19, I31, I33
- [`invariants/ia.md`](invariants/ia.md) — I4, I6, I14, I15, I25, I32, I35
- [`invariants/build.md`](invariants/build.md) — I11, I13, I34
