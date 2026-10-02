# PR locale — 0036-coordination-parallele (noyau protégé)

Issue: #35 (top issue coordination, reste ouverte comme tableau de bord)
Branche: agent/guardian/35-parallel-coordination
Base: main (edb88db)
Code SHA: ddd000d05e2bc1a14f2815ab9b77e505168b17a2 (4 fichiers, +26/-1)
Diff: AGENTS.md (§ Parallèle), .agents/CLAIMS.md (nouveau), .agents/policies/branching.md, agents/launch.sh.

## REVIEW 1 — fonctionnel, conception, tests, régressions
head: ddd000d05e2bc1a14f2815ab9b77e505168b17a2
tests: make check → pass (lint check-secrets OK, typecheck OK, unit 1, architecture 4+4, contracts 1, security 2 — relancé sur SHA revu)
findings:
- [non-blocking] agents/launch.sh:7-10 — seul le chemin refus est testé live (`./agents/launch.sh guardian 35 test-dup` → refus exit 1, sans effet de bord) ; chemin succès non exécuté (créerait un worktree). Succès = ligne d'origine inchangée + `bash -n` OK.
- [non-blocking] agents/launch.sh:11 — garde `ls-remote` exige réseau ; hors-ligne il échoue silencieusement (condition `if`) et laisse passer. Comportement local-first assumé : `.agents/CLAIMS.md` + commentaires issue font foi, branche distante = verrou dès que réseau.
- [non-blocking] .agents/CLAIMS.md — registre manuel, conflit de merge possible si 2 agents appendent simultanément. Couvert par discipline rebase (AGENTS.md § Parallèle) ; en cas de conflit la branche distante tranche.
- Protocole vérifié : CLAIM #35 (commentaire + assignee), push branche = verrou `agent/*/35-*` détecté par garde-fou, `make check` vert avant et après, diff limité aux 4 fichiers annoncés.

## REVIEW 2 — adversariale : sécurité, invariants, cas limites, effets de bord
head: ddd000d05e2bc1a14f2815ab9b77e505168b17a2
tests: make check → pass
findings:
- [non-blocking] Auto-review (auteur = relecteur) sur noyau protégé. Atténuation : merge sur ordre explicite de l'utilisateur (« merge yourself ») ; revue 2 menée en passe réellement adversariale ci-dessous, pas de complaisance.
- Secrets/dépôt public : `check-secrets` OK ; grep diff sur `https?://`, IPv4, `gho_|sk-|BEGIN.*PRIVATE` → rien trouvé. Aucune URL Pronote, IP/domaine serveur, `.env*`, donnée perso. Issues #35 + PR #36 sans valeur secrète.
- Invariants I1-I7 : aucun fichier `server/`, `android/`, `shared/` touché ; `check-architecture` OK + suites vertes. I2/I3/I4/I5/I6/I7 inchangés. Pas d'affaiblissement garde-fous (zones sensibles non touchées : PronoteHttpClient, crypto, auth, push, Makefile, lockfiles).
- Cas limites : `grep -q` dans gardes — codes retour absorbés par `if`, compatible `set -euo pipefail`. Interpolation `refs/heads/$BRANCH` non quotée mais BRANCH construit depuis 3 args validés (`${1:?...}`) ; slug malicieux avec espaces casserait `git worktree add` avant tout effet — pas d'injection silencieuse, échec bruyant.
- Effets de bord : aucun worktree créé par les tests (refus avant `worktree add`). Fichier `?? .agents/prs/0001-roadmap.md` pré-existant, non touché, hors diff.
- Noyau protégé touché (.agents/, AGENTS.md, launch.sh) : vérif renforcée = cette double review + `make check` sur SHA revu + `check-pr.ts` ci-dessous.

Décision: mergable (zéro blocking + make check pass + invariants OK)
Note: artefact commité après reviews (commit docs-only suivant : ce fichier seul) ; code revu = SHA ci-dessus, vérifié inchangé (`git diff <codeSHA> HEAD -- . ':!.agents/prs'` vide hors cet artefact).
Publication: `gh pr merge --merge` PR #36 vers main, puis rouvrir #35 (tableau de bord, le body disait « Closes »), commentaire RELEASE.
Vérif circuit : `bun run agents/runtime/check-pr.ts .agents/prs/0036-coordination-parallele.md ddd000d05e2bc1a14f2815ab9b77e505168b17a2`.
