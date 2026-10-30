# Invariants — Build et vendorisé

> Détail du registre [`INVARIANTS.md`](../INVARIANTS.md). Une entrée par ID,
> dans l'ordre du registre ; ne lire que le fichier du thème concerné.

<a id="i11"></a>

## I11 — Contenu vendorisé `.agents/` : docs, pas de passoire
- Invariant : `.agents/` (skills verrouillées par `skills-lock.json`) n'est
  jamais un vecteur de fuite : un VRAI secret échoue au scan anti-secrets,
  seuls les exemples de doc passent. Aucun secret, domaine, IP ni donnée
  perso. Contenu VERROUILLÉ : sha256 par ARBRE de skill comparé à une table
  (édition manuelle échoue le gate) ; le lock porte les MÊMES skills que le
  disque.
- Test : `tests/architecture/secret-scan.test.ts` (carve-out étroit) +
  `tests/architecture/skills-lock.test.ts` (empreinte de chaque arbre) +
  `make lint` (scan réel).
- Commande : `make lint` et `make architecture-test`.
- Emplacement : `.agents/**/*`, motifs dans `agents/runtime/secret-patterns.ts`.

<a id="i13"></a>

## I13 — Le pont factice est un artefact de développement
- Invariant : le pont factice (`web/src/bridge/mock.ts`) n'existe qu'en développement. `client.ts` ne l'importe que sous `import.meta.env.DEV` (jamais statiquement) : le bundle APK ne contient AUCUNE donnée fictive, et hors dev un pont natif absent ÉCHOUE (`BridgeCallError`) au lieu de servir une école fictive. `web/vite.config.ts` force `NODE_ENV=production` au build.
- Test : `tests/architecture/web-mock.test.ts` (pas d'import statique + analyse du bundle Vite livré à l'APK) + `tests/web/bridge.test.ts` (hors dev le pont absent échoue ; en dev le factice répond ; un pont natif ne retombe jamais sur le factice).
- Commande : `make architecture-test` (ou `make check`).
- Emplacement : `web/src/bridge/client.ts`, `web/src/bridge/mock.ts`, `web/vite.config.ts`, `agents/runtime/build-web.ts`.

<a id="i34"></a>

## I34 — Une seule version Kotlin, du catalogue à la CI
- Invariant : `android/gradle/libs.versions.toml` est la seule source des
  versions Gradle. Aucun `build.gradle.kts` ne déclare de version en dur ;
  le classpath Kotlin lit l'entrée `kotlin` du catalogue ; la CI télécharge
  le `kotlinc` de cette version. Une version changée fait échouer le gate.
- Test : `tests/architecture/gradle-versions.test.ts` (catalogue TOML, build
  scripts et `ci.yml` : littéraux refusés, version Kotlin identique).
- Commande : `make architecture`.
- Emplacement : `android/gradle/libs.versions.toml`, `android/build.gradle.kts`,
  `android/*/build.gradle.kts`, `.github/workflows/ci.yml`.
