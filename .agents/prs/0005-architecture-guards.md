# PR locale — 0005-architecture-guards

Issue: #5 (1-architecture-guards, P0)
Branche: agent/guardian/5-architecture-guards
Base: origin/main (ed500f0, PR #42 incluse)
Code SHA: fd4c73a4a100ea687600bb7c7109332e255ba6c6 (4 fichiers, +135/-24)
Diff: .agents/CLAIMS.md (ligne claim #5), agents/runtime/check-architecture.ts, agents/runtime/check-secrets.ts, tests/architecture/invariants.test.ts.

## REVIEW 1 — fonctionnel, conception, tests, régressions
head: fd4c73a4a100ea687600bb7c7109332e255ba6c6
tests: make check → pass (lint check-secrets OK, typecheck 0 erreur, unit 13, architecture 7+7, contracts 4, security 2 — relancé sur SHA revu après rebase ed500f0)
findings:
- [non-blocking] tests/architecture/invariants.test.ts:7-24 — codeOnly dupliqué en miroir de check-architecture.ts (assumé, ponytail noté dans fichier). Dérive possible si un seul côté évolue ; acceptable phase 1, upgrade import partagé/AST noté.
- [non-blocking] agents/runtime/check-secrets.ts:19 — PLACEHOLDER_RE contient x{3,} : un vrai secret base64 contenant xxx serait manqué (faux négatif théorique). Risque faible, assumé ; upgrade gitleaks noté.
- [non-blocking] agents/runtime/check-architecture.ts:85 — lookbehind (?<!:) suppose moteur compatible ; vérifié OK sous Bun 1.4.2 (make check vert), Node 18+ OK aussi.
- Critères #5 couverts : FP I1 (md + commentaires), I2 (fetch hors Pronote), I3 (block/javadoc, multi-lignes), secrets (placeholders docs) traités et testés ; règles documentées en en-tête de chaque script ; invariants.test.ts couvre I1-I3 + FP, pipeline.test.ts couvre I6 + I4/I5 (inchangé, suffisant phase 1) ; make architecture-test + make check passent. Aucune régression (suites main #17 toujours vertes).

## REVIEW 2 — adversariale : sécurité, invariants, cas limites, effets de bord
head: fd4c73a4a100ea687600bb7c7109332e255ba6c6
tests: make check → pass
findings:
- [non-blocking] I2 assoupli vs avant (mot pronote + fetch n'importe où → même ligne OU URL+réseau). Contournement résiduel : URL construite dynamiquement sans hôte littéral échapperait au scan. Plafond regex assumé et documenté, upgrade AST noté ; le durcissement net (I4 ajouté, FP éliminés sans élargir les trous aveugles au-delà du plafond) justifie. Tâche = durcissement, pas affaiblissement (zone sensible garde-fous : 2e passe = cette review).
- [non-blocking] I1 ignore désormais commentaires : URL Pronote en commentaire android passe. Inerte (commentaire non exécuté), aucun impact invariant.
- Secrets/dépôt public : check-secrets OK ; diff sans URL Pronote, IP/domaine, credential, .env*. Claim #5 + reviews sans valeur secrète.
- Invariants I1-I7 : I1/I2/I3/I5 scannés OK, I4 ajouté au scan server/ai, I6 couvert par tests/security (2 pass), I7 hors scope (jobs/e2e phases 5/7). check-architecture OK.
- Cas limites : URLs https:// protégées du strip // par lookbehind ; imports multi-lignes couverts par [^;]* ; tools: [] vide autorisé, non-vide flaggé.
- Effets de bord : diff limité aux 4 fichiers annoncés, aucun fichier d'autrui (jobs #16/#17, contracts #4, api #10/#12) touché. Conflit CLAIMS.md au rebase résolu en gardant les 5 claims tiers + #5.

Décision: mergable (zéro blocking + make check pass + invariants OK)
Note: artefact commité après reviews (commit docs-only suivant : ce fichier seul) ; code revu = SHA ci-dessus, vérifié inchangé (`git diff <codeSHA> HEAD -- . ':!.agents/prs'` vide hors cet artefact).
Publication: `gh pr create` + `gh pr merge` vers main, commentaire RELEASE + close #5.
Vérif circuit : `bun run agents/runtime/check-pr.ts .agents/prs/0005-architecture-guards.md fd4c73a4a100ea687600bb7c7109332e255ba6c6`.
