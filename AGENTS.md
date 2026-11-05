# AGENTS.md — charte du dépôt

Non négociable ici. Détail : ADR, registre d'invariants, README de module.

## Les 5 lois

1. **Local d'abord.** Session Pronote, clé LLM et données scolaires restent sur le téléphone. Seuls `android/pronote/`, le client OpenRouter et le scraper parlent réseau.
2. **Une frontière, un écrivain.** `android/pronote/` seul accès réseau scolaire ; `android/data/` tient session et disque ; `android/core/` pur (ni SQLite ni HTTP) ; `web/` sans réseau ; `server/` ne sert que le scraper.
3. **L'extérieur est une donnée.** Tout contenu non écrit par l'humain est marqué non fiable avant l'IA. Une sortie de modèle est validée, jamais un effet métier.
4. **La donnée d'un compte n'appartient qu'à ce compte.** Déconnexion ou compte changé ⇒ purge cache, fiches, préférences, pièces jointes.
5. **Le gate est l'autorité.** `make check` et la CI rejouent le même contrôle, sans version allégée. Une régression d'invariant bloque.

Une loi ne change que par ADR. Une PR qui la viole est refusée.

## Workflow

1. **Plan.** Une issue, un périmètre, des critères d'acceptation avant le code.
2. **Claim.** Commenter `Claimed by <compte GitHub>`, puis `./agents/launch.sh <n> <slug>`. Une issue = une branche `agent/<n>-<slug>` ; branche distante = claim pris. Aucun commit direct sur `main` ; PR via `gh`, pas MCP.
3. **Build et revue.** `make watch`, diff court, puis `make check`. Relire le diff ; note de revue dans `<git-dir>/vsn-review.md` (`ship.sh` affiche le chemin) : 1re ligne `HEAD: <sha>`, puis `## Standards` et `## Spec`. `ship.sh` refuse une note absente ou d'un autre HEAD ; un rebase change le HEAD : relire avant de relancer.
4. **Merge auto.** `./agents/ship.sh <n> "<titre>"` (fetch, rebase, revue, check, push, PR, merge — jamais d'attente CI, ADR-011 ; `make check` local fait autorité). Puis `git fetch --prune`.
5. **Incident.** Même échec trois fois ⇒ issue incident.
6. **Livraison par défaut.** Revue et gate vert ⇒ committer, pousser, PR, merger sur `main` sans attendre. Jamais de push direct sur `main`. Échec de push/merge : signalé, jamais masqué.

`make check-fast` saute `android-compile` et `audit` (parité `kotlinc`, durée variable) : pas une preuve avant PR. Voir [`BUILD.md`](docs/architecture/BUILD.md).

## Gate et invariants

- `make check` = gate de merge (Kotlin + Lint, parité TS ↔ Kotlin, scans d'archi, contrats, `bun audit`) ; la CI rejoue exactement ce gate.
- Le registre est un INDEX ([`docs/architecture/INVARIANTS.md`](docs/architecture/INVARIANTS.md)) ; le détail vit par thème dans [`docs/architecture/invariants/`](docs/architecture/invariants/). Tâche → entrée : [`docs/CONTEXT.md`](docs/CONTEXT.md) ; format, budget de 120 mots, ajout et retrait : `OPERATING.md`.
- Comportement et types d'abord ; un scan de source est un dernier recours.
- Budgets de lecture et références `I<n>` vérifiés par `tests/architecture/docs.test.ts`.

## Lecture des gros fichiers

- `rg -n` puis `read` avec `offset`/`limit` (≤ 120 lignes) ; jamais `cat` ni `sed -n`. `git diff --stat` d'abord ; `rg -l`/`rg -c` avant un `rg` de contenu ; `rg --files`, jamais `find`.
- Après `edit`/`write`, ne relis pas : le diff suffit.

## Commentaires

Un commentaire ne dit que ce que le code ne peut pas dire : contrainte durable, piège mesuré, sécurité, invariant `I<n>`. Interdits : paraphrase du code, bannière, historique (`AVANT`, `#NNN`), code commenté, `@param`/`@returns` qui répètent le nom. Doc publique : le contrat en une ligne ; le récit va dans l'issue, le commit ou l'ADR.

## Licence

Code et contributions sous **GPL-3.0-only** ([ADR-008](docs/adr/008-relicense-gpl.md)) : inbound = outbound, sign-off DCO, pas de CLA, aucune restriction ajoutée.

## Dépendances, vendorisé, public

- Stdlib et dépendances déjà installées d'abord. Nouvelle dépendance : justifiée en PR, épinglée, auditée (`bun audit`), compatible GPL-3.0-only ; relire `bun.lock`.
- `.agents/` = skills tierces, jamais éditées à la main : `npx skills update` met à jour `skills-lock.json` et la table de `tests/architecture/skills-lock.test.ts` dans la MÊME PR.
- Pas de secret commité ni de variable de secret côté serveur, pas d'IP, de domaine, d'URL Pronote ou de donnée personnelle. Secret commité ⇒ rotation immédiate. `tests/fixtures/pronote/` et `shots/` sont gitignorés.

Décisions : [`docs/adr/`](docs/adr/), à commencer par [ADR-005](docs/adr/005-rules-and-architecture.md). Build : [`docs/architecture/BUILD.md`](docs/architecture/BUILD.md). Modules : [`android/README.md`](android/README.md), [`web/README.md`](web/README.md), [`server/README.md`](server/README.md).

Commits : `<scope>: <objet>`, impératif, une ligne (corps si utile).
