# REVIEW-31 — hardening e2e + relecture adversariale (issue #31, phase 10)

Date : 2026-10-02. Base : `main` (phases 1-9 existant durci, aucune feature).
Zone autorisée : `tests/e2e`, `tests/architecture`, `Makefile`, `docs`.
Interdits respectés : aucun secret/URL/donnée perso, aucun `.env.local`,
aucune feature métier, aucun toucher `server/` métier, `android/` métier,
`AGENTS.md`, `bun.lock`.

## 1. Objectif

- `make e2e` vert offline (grades, assignments, manuals, revision).
- `make check` vert, zéro régression I1-I7.
- Skips justifiés sans `.env.local` en CI.
- Relecture adversariale des zones sensibles consignée ici + PR body.

## 2. Changements (diff minimal)

- `Makefile` :
  - Fix bug skip : deux lignes recette = deux shells, `exit 0` ne stoppait
    pas `bun test`. Avant : `skip ...` affiché puis tests quand même lancés.
  - Après : `integration*` = `@if [ ! -f .env.local ]; ... else bun test ...; fi`
    (vrai skip, exit 0, justifié : réseau/compte réel requis).
  - `e2e` = offline-first, toujours `bun test tests/e2e` (les cas réseau
    seuls skippent via `skipIf` interne, ou boucle locale Playwright).
  - `e2e-grades|assignments|manuals|revision` = un fichier chacun
    (avant : les 4 lançaient tout `tests/e2e`).
- `tests/e2e/grades.test.ts` : inchangé, déjà offline (référence).
- `tests/e2e/assignments.test.ts` (nouveau, offline) : sync suit
  `assignmentIds` sans `GradeCreated` (I7), invalides écartés, `detectExams`
  high vs needs_confirm, aucun effet auto pour incertains.
- `tests/e2e/revision.test.ts` (nouveau, offline) : fixtures synthétiques
  chunk→retrieve→cite→prompt I6 → faux LLM → sortie validée I4/I5,
  injection reste donnée, fiche = mise en forme seule (I7).
- `tests/e2e/manuals.test.ts` : `describe.skipIf(!hasEnv)` supprimé,
  offline-first. Pipeline sur fixtures + scrape boucle locale `127.0.0.1`
  ou erreur gracieuse sans navigateur, jamais de credential en log.
- `tests/e2e/placeholder.test.ts` : supprimé (couvert par les 4 réels).
- `tests/architecture/invariants.test.ts` : ajout I4/I5 (server/ai sans
  réseau/secrets/outils), I6 (helpers Untrusted+nonce partout), I7 (jobs
  sans LLM). I1-I3 inchangés.

## 3. Vérifs I1-I7

- I1 android sans hôte Pronote : `make architecture-test` OK (6→9 tests
  après ajout, 0 fail). `android/` scanné, `.md` ignorés, commentaires strip.
- I2 unique PronoteHttpClient : 1 classe seule, aucun fetch direct hors
  client (même-ligne OU URL+réseau). Test FP/TP OK.
- I3 domain sans sqlite/HTTP : `server/domain/` clean, FP block/javadoc OK,
  multi-ligne détecté.
- I4 pas de secrets prompts : `tests/security` 18 pass + archi I4 OK,
  `check-secrets` OK, `assertNoSecretsInPrompt` bloque avant appel.
- I5 LLM sans outils/réseau/secrets : scan `server/ai/` OK, `[]` vide seul
  autorisé, sortie texte ≤8000 + JSON objet/tableau validés.
- I6 externe = UNTRUSTED_DATA : nonce 16-64 `[A-Za-z0-9_-]`, open+close+rappel
  même nonce, collision rejetée, faux délimiteur inopérant, helpers imposés.
- I7 pas d'effet via sortie libre : `server/jobs/` sans `server/ai`,
  sans `generate(`, sans `fetch(` (garde unit + archi), sync premier run
  silencieux, notify sur `GradeCreated` structuré seul, detectExams pur,
  e2e grades/assignments/revision le prouvent.

Commandes (worktree `wt-31-hardening-e2e`, sans `.env.local`) :
- `make check` vert (lint+typecheck+unit 64 pass+archi 9 pass+contracts 6 pass+security 18 pass).
- `make e2e` vert (4 fichiers, 0 fail, 0 skip réseau dur).
- `make e2e-grades|assignments|manuals|revision` verts unitairement.
- `make integration` → `skip ... (pas de .env.local)` exit 0 (vrai skip fixé).

## 4. Relecture adversariale (zones sensibles, lecture seule)

Hypothèse attaquant : PR/contributeur malveillant ou fixture piégée tente
exfiltration, bypass garde, ou persistance secret. On cherche bypass, pas
fonctionnel.

- `PronoteHttpClient` (`server/integrations/PronoteHttpClient.ts`) :
  unique sortie réseau, sérialisé via `tail`, timeout `AbortSignal.timeout`,
  1 retry réseau/5xx seul, pas de retry abort/timeout (déterministe),
  logs méthode+path+status seuls, jamais URL complète/headers/body/token.
  Risque résiduel : `baseUrl` injecté par caller — OK car IP serveur seule
  (I1, réseau : Pronote = IP serveur uniquement). Aucun secret ici. Verdict : OK.
- crypto/secrets/auth (`server/infrastructure/env.ts`, `manuals-config.ts`,
  `push-config.ts`, `server/integrations/pronote-auth.ts`, `server/ai/guard.ts`) :
  `loadRequiredEnv` trim + null si incomplet, `.env.example` placeholders seuls,
  `check-secrets` bloque `.env*` tracké + `sk-or-v1-` + `PRIVATE KEY` + assign
  réelle (placeholders `your/example/xxx/TODO/dummy` allowlist). `guard.ts`
  fragmente motifs pour éviter auto-match scan tout en détectant runtime —
  doublon volontaire avec `check-architecture`, documenté. Verdict : OK, plafond
  regex assumé, upgrade `gitleaks` noté en code.
- appairage (`server/api/pairing.ts`) : sessions mémoire runtime, PIN 6 digits
  `randomInt`, `timingSafeEqual`, TTL 10 min, 5 essais → lock, révocation,
  `tokenHash` sha256 seul conservé, aucun secret logué/persisté. Double `uuid()`
  (session + device) — pas de collision pratique, `tokenHash` non prédictible
  sans `sessionId`. Verdict : OK.
- push (`server/infrastructure/push-provider.ts`, `server/jobs/notify.ts`) :
  seul `tokenHash` hex64 circule, `assertPayload` borne title 120/body 1000,
  logs préfixe 8 chars, clé privée jamais envoyée/loguée, `Noop` si provider
  non-URL, `notifySyncResult` ignore `firstRun`, `notifyGradeEvents` filtre
  `GradeCreated` + `isGrade`, fail-soft par device, hash invalide skippé.
  Verdict : OK, I7 tenu (aucun LLM sur chemin).
- intégrations (`pronote-lectures.ts`, `pronote-auth.ts`, `manuals-scrape.ts`,
  `manuals.ts`) : lectures retournent `Untrusted<T[]>`, scrape refuse sans
  config/URL invalide/sans navigateur sans fuite, logs sans credential,
  `LocalManualProvider` symbolique, recherche recouvrement simple (pas
  d'embeddings). Verdict : OK.
- fixtures (`tests/unit/fixtures/pronote.ts`, `manuals.ts`) : 100 % synthétiques,
  hôte `example.test` / `example.invalid`, `UNREAL`/`Fake`, test dédié rejette
  URL réelle + secret + cle MANUAL_PASSWORD réelle. Verdict : OK.
- lockfiles (`bun.lock`, `package.json`) : non touchés, deps `typescript@5.9.3`
  + `@types/bun@1.4.2` épinglées, `bun install` seul en worktree (node_modules
  ignoré). Verdict : OK.
- `Makefile`, `.agents/`, `AGENTS.md`, `agents/launch.sh` : `Makefile` fix ci-dessus
  seul changement ; `launch.sh` claim par push, refus si branche/chemin existe ;
  `.agents/` non touché ; `AGENTS.md` non touché (workflow solo respecté :
  branche `agent/31-hardening-e2e`, pas de commit direct `main`, PR sans merge).
  Verdict : OK.
- Attaques testées : `ATTACK_IGNORE`, `ATTACK_FAKE_CLOSE`, confusion nonce `zzz`,
  collision nonce/contenu, exfiltration clé via donnée puis via sortie piégée —
  toutes neutralisées (`tests/security` + e2e revision). Verdict : OK.

Aucun finding bloquant. Plafonds assumés (`ponytail:` regex, upgrade AST /
dependency-cruiser / gitleaks) inchangés, pas de nouvelle surface.

## 5. Skips justifiés sans `.env.local`

- `make integration*` sans `.env.local` → `skip ...` exit 0, justifié :
  Pronote réel, pairing réel, push VAPID, gateway — comptes/URL humains requis
  (`docs/HUMAN_INPUTS.md`), jamais en CI.
- `make e2e` sans `.env.local` → vert offline, 0 skip dur : grades,
  assignments, revision toujours lancés ; manuals pipeline + scrape locale
  gracieuse sans navigateur. Aucun réseau externe, aucune credential réelle.
- Avec `.env.local` (local dev) : mêmes e2e + intégrations réelles si Playwright
  présent, logs sans secret.

## 6. Non-régression

- `bun run check` complet vert depuis worktree.
- `make e2e*` verts.
- I1-I7 OK via `architecture-test` + `security` + `jobs-guard` + e2e.
- Aucune feature, aucun secret, aucun fichier hors zone.
