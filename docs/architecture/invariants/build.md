# Invariants — Build et vendorisé

> Détail du registre [`INVARIANTS.md`](../INVARIANTS.md). Une entrée par ID,
> dans l'ordre du registre ; ne lire que le fichier du thème concerné.

<a id="i11"></a>

## I11 — Contenu vendorisé `.agents/` : docs, pas de passoire
- Invariant : `.agents/` (skills tiers verrouillés par `skills-lock.json`) n'est
  jamais un vecteur de fuite : un VRAI secret y échoue au scan anti-secrets,
  seuls les exemples de documentation passent. Le jeu strict s'applique
  ailleurs ; aucun secret, domaine, IP ni donnée perso. Tous les matchs d'un
  motif sont inspectés, et le jeu vendorisé couvre toutes les formes du jeu du
  dépôt : plus STRICT (preuve plus forte), jamais plus LARGE. Le contenu est
  VERROUILLÉ : sha256 recalculé par ARBRE de skill, comparé à une
  table (une édition manuelle échoue le gate), et le lock doit porter les MÊMES
  skills que le disque ; `computedHash` amont n'est pas recalculable. Provenance
  non vérifiée : l'interroger demanderait le réseau, hors du gate.
- Test : `tests/architecture/secret-scan.test.ts` (carve-out étroit) +
  `tests/architecture/skills-lock.test.ts` (l'empreinte de chaque arbre
  vendorisé) +
  `make lint` (scan réel du dépôt, `.agents/` inclus une fois tracké).
- Commande : `make lint` (scan) et `make architecture-test` (m invariants).
- Emplacement : `.agents/**/*`, motifs dans `agents/runtime/secret-patterns.ts`.

<a id="i13"></a>

## I13 — Le pont factice est un artefact de développement
- Invariant : le pont factice (`web/src/bridge/mock.ts`) n'existe qu'en
  développement. `client.ts` ne l'importe que dans une branche
  `import.meta.env.DEV` (jamais d'import statique) : le bundle livré à l'APK
  ne contient AUCUNE donnée scolaire fictive, et hors mode dev un pont natif
  absent ÉCHOUE (`BridgeCallError`) au lieu de servir une école fictive (faux
  profil, fausses notes, `session.restore` = « restored », donc jamais d'écran
  d'appairage). `web/vite.config.ts` force `NODE_ENV=production` pour le
  build : un `NODE_ENV=development` ambiant ne peut pas fabriquer un bundle de
  développement embarqué dans l'APK.
- Test : `tests/architecture/web-mock.test.ts` (pas d'import statique + analyse
  du bundle Vite RÉELLEMENT livré à l'APK — #654 : construit UNE fois par le
  gate, `make architecture` tire `web-build` avant le test, aucun second
  build jetable) + `tests/web/bridge.test.ts` (hors mode
  dev : le pont absent échoue ; en mode dev : le factice répond ; un pont
  natif présent ne retombe jamais sur le factice) +
  `tests/unit/build-web.test.ts` (le build Vite passe par
  `agents/runtime/build-web.ts` : plafond de durée par essai, UN réessai si le
  processus MORT — jamais s'il a échoué — et un diagnostic qui nomme la cause ;
  le build de l'APK passe par le même helper, donc la même protection —
  #516 : le binding natif de Vite peut mourir sans message et rougissait le
  gate pour un bundle intact).
- Commande : `make architecture-test` (ou `make check` ; #654 :
  `make architecture-test` tire `web-build` — un bundle absent est un ÉCHEC
  explicite, jamais un vert vacuement vrai).
- Emplacement : `web/src/bridge/client.ts`, `web/src/bridge/mock.ts`,
  `web/vite.config.ts`, `agents/runtime/build-web.ts`.

<a id="i34"></a>

## I34 — Une seule version Kotlin, du catalogue à la CI
- Invariant : `android/gradle/libs.versions.toml` est la seule source des
  versions Gradle. Aucun `build.gradle.kts` ne déclare de version de dépendance
  en dur ; le classpath Kotlin lit l'entrée `kotlin` du catalogue ; la CI
  télécharge le `kotlinc` de cette même version. Une version changée à un seul
  endroit doit faire échouer le gate, pas compiler une parité contre un autre
  compilateur.
- Test : `tests/architecture/gradle-versions.test.ts` (catalogue analysé en
  TOML, build scripts et `ci.yml` réels : littéraux refusés, version Kotlin
  identique aux trois endroits).
- Commande : `make architecture`.
- Emplacement : `android/gradle/libs.versions.toml`, `android/build.gradle.kts`,
  `android/*/build.gradle.kts`, `.github/workflows/ci.yml`.
