# ADR-002 — provider Pronote (critères go/no-go)

- Statut : proposé (issue #3, phase 1). Décision `go` / `no-go` en phase 2 (issue #9), arbitrage humain si négatif.

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

## Conséquences

- `go` : débloque phases 3+ (API, Android, sync).
- `no-go` : alternative proposée en #9 + input humain demandé, phases 3+ restent bloquées.
- Tout assouplissement d'un seuil = PR justificative + revue sécurité (zone sensible : auth/intégrations).
