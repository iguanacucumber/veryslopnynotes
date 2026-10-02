# PR locale — 0011-server-storage

Issue: #11 (3-server-storage, P0)
Branche: agent/dev-server/11-server-storage
Base: origin/main (75b6834, PR #45 incluse)
Code SHA: 7b105cdce14a405efccf611872ee3093c5047de6 (4 fichiers, +136/-0)
Diff: .agents/CLAIMS.md (ligne claim #11), server/infrastructure/migrations.ts (nouveau), server/infrastructure/sqlite-storage.ts (nouveau), tests/unit/storage.test.ts (nouveau, 6 tests).

## REVIEW 1 — fonctionnel, conception, tests, régressions
head: 7b105cdce14a405efccf611872ee3093c5047de6
tests: make check → pass (lint check-secrets OK, typecheck 0 erreur, unit 27, architecture 7+7, contracts 4, security 2 — relancé sur SHA revu après rebase 75b6834)
findings:
- [non-blocking] tests/unit/storage.test.ts:7-9 — dossiers tmp (mkdtemp) jamais nettoyés. Inoffensif (/tmp), à purger via afterEach/rm si la suite grossit.
- [non-blocking] server/infrastructure/migrations.ts:17-29 — migrations non enveloppées en transaction. Rejouables grâce à IF NOT EXISTS + table _migrations ; suffisant v1, transaction si migration multi-ordres un jour.
- Critères #11 couverts : adapter get/set + migrations versionnées (table _migrations, v1 kv), aucun import SQLite dans server/domain/ (assert statique dédié + check-architecture OK), 6 tests persistance OK. Aucune régression (suites main #5/#6/#24 vertes).

## REVIEW 2 — adversariale : sécurité, invariants, cas limites, effets de bord
head: 7b105cdce14a405efccf611872ee3093c5047de6
tests: make check → pass
findings:
- [non-blocking] Pas de chiffrement au repos (valeurs en clair dans SQLite). Hors scope #11, attendu phase pairing (#12) ; ne jamais y stocker de secret/credential en attendant.
- Secrets/dépôt public : check-secrets OK ; aucune credential dans le diff, chemin DB injecté (tests : tmp uniquement, jamais de chemin réel commité).
- Invariants : I3 OK — seul `import type` (effacé à compile, zéro runtime) depuis infra vers domain, sens autorisé ; aucun import sqlite/HTTP dans server/domain/ (test statique + scan OK). I1/I2/I4-I7 N/A (pas de réseau/LLM).
- Cas limites : get absent → null (row manquante + valeur nulle défensive) ; set upsert (ON CONFLICT) ; copie Uint8Array en lecture (pas de buffer partagé) ; requêtes paramétrées (pas d'injection par clé) ; reopen/idempotence testées ; WAL activé.
- Effets de bord : diff purement additif (+136/-0 hors CLAIMS), aucun fichier d'autrui touché (guards #5, client #6, jobs #16/#17/#24, contracts #4, api #10/#12). Conflit CLAIMS.md au rebase résolu en gardant claims tiers + #11. Zéro dépendance ajoutée (bun:sqlite stdlib).

Décision: mergable (zéro blocking + make check pass + invariants OK)
Note: artefact commité après reviews (commit docs-only suivant : ce fichier seul) ; code revu = SHA ci-dessus, vérifié inchangé (`git diff <codeSHA> HEAD -- . ':!.agents/prs'` vide hors cet artefact).
Publication: `gh pr create` + `gh pr merge` vers main, commentaire RELEASE + close #11.
Vérif circuit : `bun run agents/runtime/check-pr.ts .agents/prs/0011-server-storage.md 7b105cdce14a405efccf611872ee3093c5047de6`.
