# AGENTS.md — charte du dépôt

Ce fichier dit ce qui est non négociable et comment travailler. Le détail vit
dans les ADR, le registre d'invariants et les README de module.

## Les 5 lois

1. **Local d'abord.** Session Pronote, clé LLM et données scolaires restent sur
   le téléphone. Seuls `android/pronote/`, le client OpenRouter et le scraper
   parlent réseau.
2. **Une frontière, un écrivain.** `android/pronote/` est le seul accès réseau
   scolaire ; `android/data/` tient la session et le disque ;
   `android/core/` reste pur (ni SQLite ni HTTP) ; `web/` n'a aucun réseau ;
   `server/` ne sert que le scraper.
3. **L'extérieur est une donnée.** Tout contenu non écrit par l'humain est marqué
   non fiable avant l'IA. Une sortie de modèle est validée et ne déclenche jamais
   un effet métier.
4. **La donnée d'un compte n'appartient qu'à ce compte.** Déconnexion ou compte
   changé purge cache, fiches, préférences, pièces jointes.
5. **Le gate est l'autorité.** `make check` et la CI rejouent le même contrôle,
   sans version allégée. Une régression d'invariant est bloquante.

Une loi ne change que par ADR. Une PR qui la viole est refusée.

## Workflow

1. **Plan.** Une issue, un périmètre, des critères d'acceptation avant le code.
2. **Branche.** `./agents/launch.sh <n> <slug>` depuis `origin/main`. Une issue =
   une branche `agent/<n>-<slug>`. Zéro commit direct sur `main`. PR via `gh`
   (MCP GitHub retiré : ses schémas coûtaient plus cher que la commande).
3. **Build et review.** `make watch`, diff court, puis `make check`.
4. **Merge auto.** `./agents/ship.sh <n> "<titre>"` (fetch, rebase, check,
   push, corps de PR), puis `gh pr create`, `gh pr merge --merge
   --delete-branch` et `gh issue close`. Enfin `git fetch --prune`.
5. **Incident.** Même échec trois fois ⇒ issue incident.

`make check-fast` (~2,1 s à chaud) saute `android-compile` seulement. Détail
du gate : [`docs/architecture/BUILD.md`](docs/architecture/BUILD.md).

## Gate et invariants

- `make check` est le gate de merge : 9 étapes, dont la compilation Kotlin ET
  Android Lint, la parité TS ↔ Kotlin exécutée, les scans d'architecture,
  les contrats et `bun audit`. La CI rejoue exactement ce gate.
- Le registre est un INDEX ([`docs/architecture/INVARIANTS.md`](docs/architecture/INVARIANTS.md)) ;
  le détail vit par thème dans [`docs/architecture/invariants/`](docs/architecture/invariants/).
  Tâche → entrée : [`docs/CONTEXT.md`](docs/CONTEXT.md) ; format, budget de
  120 mots, ajout et retrait : `OPERATING.md`.
- Comportement et types d'abord ; un scan de source est un dernier recours.
- Budgets de lecture et références `I<n>` vérifiés par
  `tests/architecture/docs.test.ts`.

## Lecture des gros fichiers

- `rg -n` puis `read` avec `offset`/`limit` (≤ 120 lignes). Jamais `cat` ni
  `sed -n` : `read` cache et tronque.
- `git diff --stat` d'abord, puis le diff fichier par fichier.
  `rg -l`/`rg -c` avant un `rg` de contenu ; `rg --files`, jamais `find`.
- Après `edit`/`write`, ne relis pas : le diff suffit.

## Commentaires

Un commentaire ne dit que ce que le code ne peut pas dire : contrainte durable,
piège mesuré, sécurité, invariant `I<n>`. Interdits : paraphraser le code,
bannière ou séparateur, historique (`AVANT`, `#NNN`), code commenté,
`@param`/`@returns` qui répètent le nom. Doc publique : le contrat, en une
ligne. Le récit va dans l'issue, le commit ou l'ADR.

## Dépendances, vendorisé, public

- Stdlib et dépendances déjà installées d'abord. Une nouvelle dépendance est
  justifiée en PR, épinglée, auditée (`bun audit`), MIT ; relire `bun.lock`.
- `.agents/` = skills tierces, jamais éditées à la main : `npx skills update`
  met à jour `skills-lock.json` et la table de
  `tests/architecture/skills-lock.test.ts` dans la MÊME PR.
- Pas de secret commité ni de variable de secret côté serveur, pas d'IP, de
  domaine, d'URL Pronote, de donnée personnelle. Secret commité ⇒ rotation
  immédiate. `tests/fixtures/pronote/` et `shots/` sont gitignorés.

Décisions : [`docs/adr/`](docs/adr/), à commencer par
[ADR-005](docs/adr/005-rules-and-architecture.md).
Build/release : [`docs/RELEASE.md`](docs/RELEASE.md). Modules :
[`android/README.md`](android/README.md), [`web/README.md`](web/README.md),
[`server/README.md`](server/README.md).

Messages de commit : `<scope>: <objet>`, impératif, une ligne (corps si utile).
