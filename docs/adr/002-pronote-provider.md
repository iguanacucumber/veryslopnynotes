# ADR-002 — provider Pronote (critères go/no-go)

- Statut : `no-go` conditionnel (issue #9, phase 2, 2026-10-02). Base `origin/main` a8e1834 (inclut #8 lectures 6a8b532, #7 auth, #6 client, #20 garde LLM, #23 notif). Mesures locales vertes, mesures live bloquées faute d'inputs humains (pas de `.env.local`). Re-décision `go` possible après re-mesure live. Phases 3, 5, 7, 9, 10 bloquées (voir § Décision #9).

## Contexte

Phase 2 doit prouver l'accès Pronote via IP serveur uniquement (jamais depuis téléphone, I1).
Aucun code métier phase 2 avant critères verrouillés ici. Bloque phases 3, 5, 7, 9, 10 si `no-go`.
Réf : `docs/ROADMAP.md` (phases 1-2), `docs/architecture/INVARIANTS.md` (I1-I3, I6), `server/domain/ports.ts`.

## Critères go/no-go (tous mesurables, compte test via `.env.local`, jamais commité)

`go` = tous verts. Un seul rouge = `no-go` → arbitrage humain (`docs/HUMAN_INPUTS.md`), phases 3+ bloquées explicitement.

### A — Auth ENT/CAS (prépare #7)

- A1 : `PronoteProvider::authenticate` OK 5/5 sur compte test via IP serveur, p95 < 15 s.
- A2 : 0 requête Pronote depuis `android/` (I1, `make architecture-test` vert).
- A3 : sessions isolées par `accountId`, 0 secret/token en log (`make check` + revue).
- A4 : re-auth après changement IP reproductible 2/2, procédure documentée.

### L — Lectures notes / devoirs / EDT (prépare #8)

- L1 : notes + devoirs + EDT OK sur compte test, types figés dans `ports.ts`, pagination/erreurs gérées.
- L2 : 100 % sorties brutes marquées `Untrusted` via `untrusted()` (I6, `tests/security`).
- L3 : échec propre sur mauvais identifiants + ENT indisponible (erreur typée, pas de crash, 0 secret en log).

### S — Stabilité + architecture (prépare #6)

- S1 : 20 runs consécutifs auth + lectures, succès ≥ 95 % (≥ 19/20), 0 régression I1-I3.
- S2 : `PronoteHttpClient` unique (`server/integrations/PronoteHttpClient.ts`, I2, scan anti-doublon), timeouts + retry bornés (ex. timeout 10 s, retry ≤ 2 — valeurs figées phase 2).
- S3 : `make check` vert, fixtures synthétiques/anonymisées uniquement en repo (aucune donnée perso, URL établissement, session).

## Apports humains requis (sans valeurs, voir `docs/HUMAN_INPUTS.md`)

- URL Pronote établissement + type ENT/CAS.
- Comptes test Pronote (`.env.local` uniquement).
- Choix VPS à IP fixe ou acceptation ré-auth après changement IP.
- Arbitrage go/no-go si mesure négative.

## Protocole de mesure (phase 2)

- `make integration-pronote` (skip sans `.env.local`), logs sans secret, mesures consignées dans ADR-002 lors de #9.
- Contre-mesure réseau : toute requête Pronote part IP serveur (règle d'or, I1).

## Décision #9 (2026-10-02) — `no-go` conditionnel

Un seul rouge = `no-go`. Quatre critères live rouges par manque d'inputs, pas par échec technique. Aucune donnée live commitée (`.env.example` seul, pas de `.env.local`).

| Critère | Mesure locale (2026-10-02, base a8e1834) | Verdict |
|---|---|---|
| A1 auth 5/5 p95 < 15 s | Bloqué : pas de compte test (`.env.local` absent). Unit auth OK en mock (sessions `Map<accountId,token>`, `invalid_credentials`/`ent_unavailable`/`network`/`timeout` typées). Test intégration `pronote-auth.test.ts` prêt, skip sans env. | rouge (bloqué) |
| A2 0 requête depuis `android/` | Vert : `make architecture-test` OK (`check-architecture OK`, 7 tests arch). `android/` sans module, zéro hôte Pronote/ENT. | vert |
| A3 sessions isolées, 0 secret en log | Vert : `PronoteAuthProvider` + `PronoteLectureProvider` loggent `auth -> ok` / `grades -> ok N` / `-> error code` seuls. Asserté 19 tests unit (`pronote-auth` + `pronote-http-client` + `pronote-lectures` : jamais token/password en URL/log/header sauf `Authorization: Bearer`). | vert |
| A4 re-auth IP 2/2 documentée | Bloqué live (même cause A1). Procédure documentée en code (`pronote-auth.ts` : `invalidate` + `authenticate`, VPS IP fixe recommandé) + test intégration re-auth prêt (skip). | rouge (bloqué) |
| L1 notes+devoirs+EDT typés | Vert mock, rouge live. Types figés `ports.ts` (`PronoteReader`, `PronotePage`, guards `isGrade`/`isAssignment`/`isTimetableEntry`), pagination clamp 1..100 défaut 50 + cursor opaque + `nextCursor null` = fin, erreurs `session_expired`/`ent_unavailable`/`network`/`timeout`. 7 tests unit lectures OK. Live OK en attente compte test. | rouge (bloqué live) |
| L2 100 % `Untrusted` | Vert : sorties `untrusted(valid)` (`pronote-lectures.ts:173`), `tests/security` 18 pass, `tests/contracts` 4 pass. | vert |
| L3 échec propre | Vert mock : 401/403 → `session_expired`, 5xx/forme inconnue → `ent_unavailable`, `network`/`timeout` mappés, `from`/`to` non-ISO → `ent_unavailable` avant réseau, `accountId` vide → `session_expired` sans appel. Live ENT indisponible en attente. | vert (mock) |
| S1 20 runs ≥ 95 % | Bloqué : sans compte test, pas de run live. 0 régression I1-I3 en local. | rouge (bloqué) |
| S2 client unique + bornes | Vert : unique `PronoteHttpClient` (I2, aucun `fetch` direct côté lectures/auth, scan OK), timeout défaut 10 s (`DEFAULT_TIMEOUT_MS`), 1 retry réseau/5xx max (boucle `attempt <= 1`), file sérialisée. | vert |
| S3 `make check` + fixtures | Vert : lint + typecheck + unit 64 + arch 7 + contracts 4 + security 18. Fixtures `fake-UNREAL` synthétiques seules, aucun hôte/URL/session en repo. Faux positif lint sur `main` déjà corrigé via #20 (#53) ; cette branche ne touche aucun fichier hors scope. | vert |

Note lint : `make check` était rouge sur `main` d3e9e85 par faux positif
(`.agents/prs/0025.md:26` nommait fichier et contenus sur une même ligne).
Déjà corrigé sur `main` via #20 (#53, formulation sans co-occurrence, garde-fou
non affaibli). Vérifié `check-secrets OK` sur cette base a8e1834.

## Inputs humains demandés (sans valeurs, voir `docs/HUMAN_INPUTS.md`)

- URL Pronote établissement + type ENT/CAS.
- Comptes test Pronote (`.env.local` uniquement, jamais commité).
- Choix VPS à IP fixe ou acceptation ré-auth après changement IP.
- Arbitrage `go`/`no-go` après re-mesure (ce `no-go` conditionnel).

## Alternative (I1 respecté : téléphone ne contacte jamais Pronote)

- Recommandée : fournir inputs ci-dessus, puis `make integration-pronote` (auth 5/5 + lectures + 20 runs + re-auth IP 2/2), consigner mesures, re-décision `go` en nouvelle issue (réutilise tests d'intégration existants, skip levé par `.env.local`).
- Dégradée transitoire (si live impossible) : import manuel local hors Pronote (fichier), sans sync auto. Interdit : contournement via appel Pronote depuis `android/` ou client HTTP parallèle (violerait I1/I2).
- Aucun code métier phase 3+ sur provider non prouvé en attendant.

## Conséquences

- `no-go` décidé ici : phases 3 (server core/API), 5 (sync/cache), 7 (notifications), 9 (homework AI, données devoirs), 10 (fiches/hardening) explicitement BLOQUÉES jusqu'à re-décision `go`.
- `go` futur (re-mesure tous verts) : débloque phases 3+ (API, Android, sync).
- Tout assouplissement d'un seuil = PR justificative + revue sécurité (zone sensible : auth/intégrations).
