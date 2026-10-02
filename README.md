# veryslopnynotes — Pronote boosté IA

App Android + serveur self-hosted : notes, devoirs, manuels, fiches de révision.
Le serveur est le seul à parler à Pronote. Le téléphone ne contacte que le serveur.

## Règles d'or

- **Réseau** : toute requête Pronote part de l'IP du serveur (unique `PronoteHttpClient`, session sérialisée, UA constant). L'app ne connaît qu'un hôte serveur (allowlist OkHttp), médias via proxy serveur, pas de WebView distante.
- **IA** : tout contenu non écrit par l'utilisateur = donnée, jamais instruction. Pipeline `SOURCE → … → RENDER` avec validation visuelle (rendu + OCR), scan d'injections, sortie JSON validée sans outils ni effets de bord libres.
- **Dépôt public** : jamais de secrets, clés, `.env*` (sauf `.env.example`), IP/domaines serveur, URL établissement, données perso, manuels/cours, sessions Playwright. Fixtures synthétiques. Voir `AGENTS.md`.

## Structure

```
android/  app, core, data, ui      (client natif, phase 4)
server/   api, domain, infrastructure, integrations, ai, jobs
shared/   contracts/               (source de vérité API/événements/modèles)
agents/   launch.sh, runtime/      (outillage local : check-secrets, check-architecture)
.agents/  policies, tasks, prs/
docs/     adr, architecture (INVARIANTS), security, HUMAN_INPUTS, FEATURES, ROADMAP
tests/    unit, architecture, contracts, security, integration, e2e
```

Le domaine (`server/domain/`) ne dépend ni de SQLite ni du framework HTTP.
Invariants bloquants : `docs/architecture/INVARIANTS.md` (I1–I7, chacun testé).

## Démarrage

```bash
bun install
cp .env.example .env.local   # valeurs réelles, jamais commité
make check                   # lint + typecheck + unit + architecture + contracts + security
make integration              # skip sans .env.local
make e2e                      # skip sans .env.local
make build                    # image Docker + rappel APK debug (clé hors repo)
```

Détail apports humains : `docs/HUMAN_INPUTS.md`.
Conventions Git + circuit agents : `AGENTS.md`, `docs/CONVENTIONS_GIT.md`.

## Workflow

Plan (découper, critères avant code) → Build (une issue = une branche `agent/<n>-<slug>` = une PR) → Review (relire, `bun run check`, répéter jusqu'à bon), puis merge via `gh`. `main` uniquement via PR validée. Backlog : `docs/ROADMAP.md`.

## Fonctionnalités

Voir `docs/FEATURES.md` : alerte nouvelle note, assistant devoirs sourcé (cours + manuels), scraping manuels Playwright côté serveur, fiches de révision auto à l'annonce d'un DS, écran Alertes sécurité.

## Licence

MIT — voir `LICENSE`. Identité propre, aucun asset tiers copié.
