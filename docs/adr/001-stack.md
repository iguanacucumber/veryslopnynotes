# ADR-001 — stack
- Statut : accepté (issue #2, phase 1)

## Contexte
Bootstrap a posé bun+TS côté serveur et `android/` vide (Kotlin natif à confirmer).
Il faut verrouiller versions et choix avant code métier (bloque phases 2-10).

## Décision
- **Serveur** : runtime Bun, langage TypeScript strict (`tsconfig` strict, `tsc --noEmit`).
  HTTP : stdlib `Bun.serve` par défaut ; framework (ex. Hono) seulement si besoin justifié en PR phase 3.
  Stockage : `bun:sqlite` (stdlib) via adapters `server/infrastructure/` uniquement, jamais `server/domain/` (I3).
- **Android** : natif Kotlin, Gradle, Jetpack Compose (Material3), un seul client OkHttp allowlist serveur (I1).
  Versions Gradle/Kotlin/AGP/compileSdk figées phase 4 à création du premier module (#13) — pas de code Android avant.
- **Tests/outillage** : `bun test` built-in, `make check` = lint + typecheck + unit + architecture + contracts + security.
  Pas d'ESLint : `tsc` strict + scripts `agents/runtime/` suffisent (décision paresseuse, réversible en PR justifiée).
- **Dépendances** : versions exactes + `bun.lock` commité + `bun audit`. Nouvelle dép = justifiée, épinglée, licence MIT-compatible.

## Versions épinglées
| Composant | Version | Source |
|---|---|---|
| bun (runtime) | 1.4.2 | `bun --version`, `.agents/tasks` env |
| typescript | 5.9.3 | `package.json` exact + `bun.lock` |
| @types/bun | 1.4.2 | `package.json` exact + `bun.lock` |

## Écarts bootstrap traités
- Corrigé : `package.json` utilisait `^5.6.0` / `latest` → épinglé exact ci-dessus, lock régénéré.
- Corrigé : `.gitignore` `data/` non ancré ignorait `android/data/` → ancré racine (constaté revue PR #1).
- Documenté : `android/` sans module Gradle (`.gitkeep`) → normal, premier module phase 4 (#13).
- Documenté : base Docker `oven/bun:1` flottante (docker absent en local, tag non vérifiable) → épinglage digest phase 10 release.
- Renvoyé : durcissement `check-architecture.ts` (AST) → issue #5 ; schémas contrats réels → issue #4.

## Conséquences
- `make architecture-test` doit passer (vérifié).
- Tout écart stack = PR justificative + revue sécurité si zone sensible.
- ADR-002 (provider Pronote) suit critères issue #3, décision phase 2.
