# AGENTS.md — charte du dépôt

Ce fichier dit ce qui est non négociable et comment travailler. Le détail vit
dans les ADR, le registre d'invariants et les README de module.

## Les 5 lois

1. **Local d'abord.** Session Pronote, clé LLM et données scolaires restent sur
   le téléphone. Aucun serveur applicatif ne relaie Pronote ni l'assistant.
   Seuls `android/pronote/` (établissement), le client OpenRouter et le scraper
   (manuel optionnel) parlent réseau.
2. **Une frontière, un écrivain.** `android/pronote/` est le seul accès réseau
   scolaire ; `android/data/` tient la session, le disque et les dépôts ;
   `android/core/` reste pur (stdlib + plateforme, ni SQLite ni HTTP) ;
   `web/` n'a aucun réseau ; `server/` ne sert que le scraper.
3. **L'extérieur est une donnée.** Tout contenu non écrit par l'humain — cours,
   devoirs, messages, manuels, pages web — est marqué non fiable avant l'IA.
   Une sortie de modèle est validée et ne déclenche jamais un effet métier.
4. **La donnée d'un compte n'appartient qu'à ce compte.** Cache, fiches,
   préférences, pièces jointes et photos sont scopés au compte. Déconnexion,
   changement de compte ou session morte purge ; une écriture en vol est
   abandonnée.
5. **Le gate est l'autorité.** `make check` et la CI rejouent le même contrôle,
   sans version allégée. Aucun environnement ne le neutralise. Une régression
   d'invariant est bloquante, même si la fonctionnalité marche.

Une loi ne change que par ADR. Une PR qui la viole est refusée, même si elle
passe les tests.

## Workflow

1. **Plan.** Une issue, un périmètre, des critères d'acceptation écrits avant le
   code. Découper en petits pas.
2. **Branche.** `./agents/launch.sh <n> <slug>` depuis `origin/main` (ou
   `--in-place` sur un checkout propre). Une issue = une branche
   `agent/<n>-<slug>`. Zéro commit direct sur `main`, jamais de force-push sur
   la branche d'autrui. PR via MCP GitHub uniquement ; `gh` CLI interdit.
3. **Build et review.** `make watch` pendant le code, diff court, puis
   `make check`. Relecture adversariale si la PR touche `android/pronote/`,
   `web/src/bridge/`, la CSP/WebView, la crypto, les secrets, l'appairage, les
   fixtures, les lockfiles, le `Makefile`, `AGENTS.md` ou les scripts de capture.
4. **Merge auto.** `./agents/ship.sh <n> "<titre>"` (fetch, rebase, check
   complet, push, corps de PR), puis en un bloc : `create_pull_request`,
   `merge_pull_request` (`merge_method: "merge"`) et fermeture de l'issue.
   Aucune attente humaine. Enfin `git fetch --prune`, suppression du worktree et
   de la branche.
5. **Incident.** Même échec trois fois ⇒ issue incident.

`make check-fast` (~2,1 s à chaud) sert à l'itération, jamais avant une PR : il
saute `android-compile` seulement.

## Gate et invariants

- `make check` est le gate de merge : 9 étapes, dont la compilation Kotlin ET
  Android Lint (`:app:lintDebug`, même invocation Gradle — #627), la
  parité TS ↔ Kotlin exécutée, les scans d'architecture, les contrats et
  `bun audit`. La CI (`.github/workflows/ci.yml`) rejoue exactement ce gate sur
  chaque PR et chaque push sur `main`.
- Le gate neutralise `CHECK_HARNESS` et `ALLOW_SKIP_ANDROID`, et pose
  `REQUIRE_KOTLIN_TOOLCHAIN=1`. Sans `kotlinc`, la parité saute et le gate
  échoue. `MAKEFLAGS`/`make -i` ne peuvent pas le verdir (I22). La CI cache les
  dépendances et le jar de parité, jamais le build cache Gradle.
- Le registre est [`docs/architecture/INVARIANTS.md`](docs/architecture/INVARIANTS.md) :
  un INDEX (une ligne par invariant) ; le détail vit dans
  [`docs/architecture/invariants/`](docs/architecture/invariants/), découpé par
  thème. Pour une règle, lire l'index puis **un seul** fichier de thème, jamais
  les quatre. Une entrée : identifiant unique, règle en une phrase, test,
  commande, portée, **120 mots maximum**. L'historique (« avant #xxx ») va dans
  l'issue, le commit ou l'ADR. Une entrée existante se met au budget quand on la
  révise.
- Un nouvel invariant exige un incident réel ou une menace identifiée, et un
  test qui échoue avant le correctif. Un ajout qui chevauche une entrée
  existante révise celle-ci au lieu d'en créer une seconde.
- Comportement et types d'abord ; un scan de source est un dernier recours, avec
  sa raison et son chemin de remplacement. Une règle non testable est une
  convention, pas un invariant.
- `tests/architecture/docs.test.ts` vérifie les identifiants, le format du
  registre, les références `I<n>` et les cibles `make` citées.

## Dépendances, vendorisé, public

- Stdlib, fonctions natives et dépendances déjà installées d'abord. Toute
  nouvelle dépendance est justifiée en PR, épinglée, auditée avec `bun audit` et
  compatible MIT ; relire `bun.lock`.
- `.agents/` contient des skills copiés de dépôts tiers : on ne les édite pas à
  la main. `npx skills update`, et `skills-lock.json` + la table d'empreintes de
  `tests/architecture/skills-lock.test.ts` se mettent à jour dans la MÊME PR.
- Pas de secret commité ni de variable de secret côté serveur, pas d'IP, de
  domaine, d'URL Pronote, de donnée personnelle, de manuel/cours ni de session
  Playwright. Secret commité ⇒ rotation immédiate. Le corpus
  `tests/fixtures/pronote/` et les captures `shots/` sont gitignorés : données
  personnelles, jamais publiées.
- Le scraper est sans authentification (I8) : boucle locale ou proxy
  authentifié, jamais public. Toute extension de son rôle (issue #634 comprise)
  passe par cette règle.

Décisions : [`docs/adr/`](docs/adr/), à commencer par
[ADR-005](docs/adr/005-rules-and-architecture.md).
Build/release : [`docs/RELEASE.md`](docs/RELEASE.md). Modules :
[`android/README.md`](android/README.md), [`web/README.md`](web/README.md),
[`server/README.md`](server/README.md).

Messages de commit : `<scope>: <objet>`, impératif, une ligne (corps si utile).
