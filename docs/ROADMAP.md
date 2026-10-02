# ROADMAP.md — phases 1-10

Source vérité produit. Chaque phase = 2-4 issues GitHub courtes (`<phase>-<objet>`).
Conventions : `docs/CONVENTIONS_GIT.md` (pas de labels/tags sur issues/PR).
Invariants bloquants : `docs/architecture/INVARIANTS.md` (I1-I7).
Ports : `server/domain/ports.ts`. Features : `docs/FEATURES.md`. Apports humains : `docs/HUMAN_INPUTS.md`.

Légende priorité : P0 = bloquant suite, P1 = cœur produit, P2 = valeur ajoutée.
Rôles : `dev-server`, `dev-android`, `reviewer-security`, `guardian` (invariants), `qa-e2e`.

## Phase 1 — architecture + ADR (P0, sans dépendance)
Verrouille stack, contrats, garde-fous avant tout code métier.
- ADR-001 stack (bun+TS serveur, Kotlin natif à confirmer) : statut `accepté`.
- ADR-002 provider Pronote : critères go/no-go écrits (pas la décision, voir phase 2).
- `shared/contracts/` = source vérité API/événements/modèles (schémas, pas un test d'existence).
- Durcir `agents/runtime/check-architecture.ts` + `check-secrets.ts` (I1-I6).
- Dépendances : aucune. Bloque : phases 2-10.

## Phase 2 — Pronote provider go/no-go (P0, dépend phase 1)
Prouve l'accès Pronote via IP serveur uniquement (jamais depuis téléphone, I1).
- `PronoteHttpClient` unique (`server/integrations/PronoteHttpClient.ts`, I2).
- Auth ENT/CAS + sessions par `accountId` (`PronoteProvider::authenticate`, ports.ts).
- Lectures : notes, devoirs, EDT (Grades, Assignments, etc.).
- Décision go/no-go ADR-002 + arbitrage humain si négatif.
- Humain requis : URL établissement + type ENT/CAS, comptes test (`.env.local`), choix VPS IP fixe ou acceptation ré-auth.
- Dépendances : phase 1. Bloque : phases 3, 5, 7, 9, 10.

## Phase 3 — server core (P0, dépend phases 1-2)
API + stockage + appairage, domaine pur (I3 : `server/domain/` sans SQLite ni HTTP).
- HTTP API depuis contrats phase 1 (`server/api/`, `server/infrastructure/`).
- `StorageProvider` SQLite via adapters (jamais importé par `server/domain/`).
- Appairage QR+PIN (secrets en `.env.local`, jamais en repo).
- Dépendances : phases 1, 2. Bloque : phases 4-10.

## Phase 4 — android core (P0, dépend phases 1, 3)
App native Kotlin, parité Papillon (Pronote uniquement, design propre).
- Un seul hôte allowlist = serveur (I1 : zéro URL Pronote/ENT dans `android/`).
- Lecture hors-ligne + SSE vers serveur.
- Appairage QR+PIN côté app.
- Dépendances : phases 1, 3 (contrats + API). Bloque : phases 5, 7, 10 (e2e).

## Phase 5 — sync + cache (P1, dépend phases 2-4)
Moteur de synchro serveur → cache → app.
- Jobs sync périodiques (`server/jobs/`), premier sync = zéro alerte (pas de faux positifs).
- Détection nouvelle note sur données structurées Pronote uniquement (I7).
- Cache + invalidation, lecture hors-ligne cohérente.
- Dépendances : phases 2, 3, 4. Bloque : phases 7, 10.

## Phase 6 — security pipeline (P0, dépend phase 1, transverse phases 8-10)
Pipeline IA : SOURCE → INGEST → NORMALIZE → VISUAL VALIDATION → SECURITY SCAN → TRUSTED DOCUMENT → CHUNK → INDEX → RETRIEVE → GENERATE → VALIDATE → RENDER (`docs/security/PIPELINE.md`).
- Contenu externe = `Untrusted` + délimiteurs à nonce, déclaré donnée (I6, `untrusted()`).
- LLM sans outils/réseau/secrets, sortie texte/JSON validé (I4/I5, `LLMProvider::generate`).
- Fixtures d'attaques (injections) + tests `tests/security/pipeline.test.ts`.
- Écran Alertes sécurité (injections neutralisées, FEATURES.md).
- Dépendances : phase 1. Bloque : phases 8, 9, 10 (tout ce qui touche IA).

## Phase 7 — notifications (P1, dépend phases 3-5)
Push fiables, jamais déclenchées par sortie libre LLM (I7).
- `PushProvider` (clés VAPID via `.env.local`, `send(deviceTokenHash, ...)`).
- Alerte nouvelle note (push, zéro au premier sync).
- Jobs détection DS/interro sur données structurées → push.
- Humain requis : token push / clés VAPID (`.env.local`).
- Dépendances : phases 3, 5. Bloque : phase 10 (fiches push).

## Phase 8 — manuels (P2, dépend phases 3, 6)
Manuels scrapés + cités dans les corrigés (FEATURES.md).
- Scrape Playwright (sessions locales, jamais commitées ; fixtures synthétiques).
- `ManualProvider` + CHUNK/INDEX/RETRIEVE (pipeline phase 6).
- Citation obligatoire des sources dans les corrigés.
- Humain requis : comptes manuels + plateforme (`.env.local`, première connexion interactive).
- Dépendances : phases 3, 6. Bloque : phase 9.

## Phase 9 — homework AI (P1, dépend phases 6, 8)
Assistant devoirs sourcé cours + manuels, JSON validé, humanisé versionné (FEATURES.md).
- GENERATE → VALIDATE → RENDER sur `Untrusted`, prompts sans secrets (I4).
- Aucun effet métier via sortie libre LLM (I7 : confirmation app sinon).
- Humain requis : clé OpenRouter + modèle (`.env.local`).
- Dépendances : phases 6, 8 (+ phase 2 pour données devoirs). Bloque : rien (phase 10 réutilise le pipeline).

## Phase 10 — revision sheets + hardening (P1, dépend phases 5-9)
Fiches révision auto + durcissement global.
- Fiches auto à annonce DS/interro + push + export PDF (FEATURES.md).
- `make e2e` vert (grades, assignments, manuals, revision) + `make check` vert.
- Release : APK signé (clé hors repo), `Dockerfile.server`, `bun audit`, dépendances épinglées + justifiées.
- Règle or : aucune régression I1-I7, `make build` OK.
- Dépendances : phases 5, 6, 7, 9 (8 recommandée pour sources).

## Graphe de dépendances (résumé)

```
1 ─┬─→ 2 ─┬─→ 3 ─→ 4 ─→ 5 ─→ 7 ─→ 10
   │      │         ↕           ↗    ↑
   │      │         6 ─→ 8 ─→ 9 ────┘
   │      └─────────────→ 9 (données devoirs)
   └──────→ 6 (transverse IA)
3 ─────────→ 8 (stockage manuels)
```

## Ordre d'exécution recommandé

1. Phase 1 (débloque tout).
2. Phases 2 + 6 en parallèle (provider vs pipeline, I2 vs I4/I5/I6).
3. Phase 3 puis 4 (serveur avant app).
4. Phase 5 puis 7 (sync avant notifs).
5. Phases 8 puis 9 (manuels avant devoirs IA).
6. Phase 10 en dernier (fiches + hardening + release).
