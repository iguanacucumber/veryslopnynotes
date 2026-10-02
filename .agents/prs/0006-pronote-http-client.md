# PR locale — 0006-pronote-http-client

Issue: #6 (2-pronote-http-client, P0)
Branche: agent/dev-server/6-pronote-http-client
Base: origin/main (0fc6b87, PR #44 incluse)
Code SHA: b3f9035e90734d4def2dd19fcc0de3d3f8f45b29 (4 fichiers, +288/-4)
Diff: .agents/CLAIMS.md (ligne claim #6), server/integrations/PronoteHttpClient.ts (9 → 148 lignes), tests/unit/pronote-http-client.test.ts (nouveau, 6 tests), tests/unit/fixtures/pronote.ts (nouveau, synthétique).

## REVIEW 1 — fonctionnel, conception, tests, régressions
head: b3f9035e90734d4def2dd19fcc0de3d3f8f45b29
tests: make check → pass (lint check-secrets OK, typecheck 0 erreur, unit 21, architecture 7+7, contracts 4, security 2 — relancé sur SHA revu après rebase 0fc6b87)
findings:
- [non-blocking] tests/unit/fixtures/pronote.ts:6 — syntheticGradesPath exporté mais inutilisé (tests utilisent "/grades" en dur). Mort-né inoffensif, tsc OK ; à utiliser ou supprimer phase #7.
- [non-blocking] server/integrations/PronoteHttpClient.ts:72-79 — sérialisation globale (1 requête à la fois) : débit volontairement bridé. Assumé phase 2 (anti rate-limit Pronote), pas de parallélisme requis par #6.
- [non-blocking] server/integrations/PronoteHttpClient.ts:108 — abort caller externe classé "timeout". Déterministe et documenté ; distinction abort/timeout possible upgrade #7 si besoin.
- Critères #6 couverts : classe unique (I2 intact, check-architecture OK), timeout AbortSignal 10s + retry 1x réseau/5xx backoff 200ms (pas retry abort/4xx), logs méthode+path+status sans secret, 6 tests unitaires + fixtures 100 % synthétiques. Aucune régression (suites main #5/#24 vertes).

## REVIEW 2 — adversariale : sécurité, invariants, cas limites, effets de bord
head: b3f9035e90734d4def2dd19fcc0de3d3f8f45b29
tests: make check → pass
findings:
- [non-blocking] Zone sensible (PronoteHttpClient) : 2e passe ci-dessous. Logs : path loggé — si un caller futur met un token en query (?token=), il fuirait en log. Discipline actuelle : path = chemin nu (tests : "/grades", "/a"), jamais de query. Règle à rappeler en #7 (auth) : ne jamais passer de secret en path/query.
- Secrets/dépôt public : check-secrets OK ; baseUrl injectée, aucun défaut pronote/index-education (grep diff : aucune URL réelle) ; fixtures example.test + UUID constant, données inventées ; erreurs typées sans fuite (message = méthode+path+status, jamais body/headers).
- Invariants : I1 OK (aucun hôte Pronote/ENT en dur), I2 OK (une seule classe, seul fetch vers Pronote — scan check-architecture OK), I3 OK (aucun import domain/sqlite/HTTP dans le client, sens d'import respecté). I4/I5 N/A (pas de LLM).
- Cas limites : constructeur rejette baseUrl/deviceUuid vides ; timeout par tentative (pas global) ; boucle bornée (≤2 tentatives, throw final inatteignable défensif) ; body drainé avant retry 5xx ; échec d'une requête ne casse pas la chaîne (tail catché) ; réponse vide → null ; JSON invalide → texte brut.
- Effets de bord : diff limité aux 4 fichiers annoncés ; server/domain/, infrastructure (#11), guards (#5) intacts. Conflit CLAIMS.md au rebase résolu en gardant claims tiers + #6. Zéro dépendance ajoutée (fetch natif).

Décision: mergable (zéro blocking + make check pass + invariants OK)
Note: artefact commité après reviews (commit docs-only suivant : ce fichier seul) ; code revu = SHA ci-dessus, vérifié inchangé (`git diff <codeSHA> HEAD -- . ':!.agents/prs'` vide hors cet artefact).
Publication: `gh pr create` + `gh pr merge` vers main, commentaire RELEASE + close #6.
Vérif circuit : `bun run agents/runtime/check-pr.ts .agents/prs/0006-pronote-http-client.md b3f9035e90734d4def2dd19fcc0de3d3f8f45b29`.
