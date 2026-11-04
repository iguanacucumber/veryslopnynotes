# Contribuer

Ce dépôt se lit d'abord : [`AGENTS.md`](AGENTS.md) donne les cinq lois et le
workflow, [`docs/CONTEXT.md`](docs/CONTEXT.md) mène à l'invariant d'une tâche.
Ce fichier décrit le parcours d'une contribution humaine, du fork au merge.
La participation est régie par le
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) (Contributor Covenant 2.1).

## Une issue d'abord

Ouvre une issue avant d'écrire du code. Décris le problème, le périmètre et ce
qui prouvera que c'est fini. Une issue = une branche = une PR ; un changement
sans issue peut être refusé, sauf correction triviale (faute, lien mort).

Les métadonnées de la page GitHub et les cinq bonnes premières issues sont
listées dans [`docs/REPOSITORY.md`](docs/REPOSITORY.md).

## Prérequis

- **Bun 1.4.4** pour l'interface, les tests et le gate.
- **JDK 17–21** et **SDK Android 37** pour compiler l'APK.
- **`kotlinc`** et un `java` dans le `PATH` pour la parité TS ↔ Kotlin : sans
  eux, `make check` échoue (un gate vert sans Kotlin exécuté serait un faux
  vert).
- **Aucune clé de signature** n'est nécessaire : le debug se construit et
  s'installe avec la clé de debug. La signature release reste hors du dépôt
  ([`docs/RELEASE.md`](docs/RELEASE.md)).

## Installation et boucle locale

```bash
git clone https://github.com/iguanacucumber/veryslopnynotes.git
cd veryslopnynotes
bun install
make help             # liste les cibles publiques et leur description
bun run dev:web       # interface + pont factice, aucun téléphone requis
make watch            # tests unitaires et web en continu
```

Sur un téléphone réel :

```bash
make buildDebugApk
make updateApkToPhone # installe en conservant les données
```

Le smoke navigateur (`make web-smoke`, Playwright/Chromium) est rejoué en CI ;
il reste hors du gate local.

## Branche et PR

Pars d'`origin/main` frais. Les mainteneurs utilisent
`./agents/launch.sh <issue> <slug>` ; un contributeur externe peut faire :

```bash
git fetch origin main
git switch -c agent/<issue>-<slug> origin/main
```

Commits : `<scope>: <objet>`, à l'impératif, une ligne. La PR cible `main`,
cite `Closes #<issue>` et raconte le **pourquoi** ; le diff doit rester court
et lisible.

`main` est protégé : la PR est obligatoire et les checks `check`, `web-smoke`
et `gitleaks` doivent être verts avant le merge
([`docs/architecture/BRANCH-PROTECTION.md`](docs/architecture/BRANCH-PROTECTION.md)).

## DCO (sign-off)

Chaque commit porte son `Signed-off-by: Nom <email>`, l'identité Git
(`user.name`, `user.email`), qui atteste que tu peux publier la contribution
sous GPL-3.0-only :

```bash
git commit -s                    # ajoute le trailer au commit
git rebase --signoff origin/main # signe rétroactivement une branche
```

Tous les commits de la PR sont signés ; un commit nu est renvoyé. **Pas de
CLA** : aucun formulaire à signer, le sign-off suffit.

Aucun bot ne le vérifie : le relecteur contrôle le trailer avant le merge.

## Le gate avant la PR

`make check` est le gate de merge : compilation Kotlin, Android Lint, tests
unitaires et web, parité TS ↔ Kotlin, contrats, scans d'architecture et audit
des dépendances. Il tourne aussi en CI, sans version allégée.

`make check-fast` saute `android-compile` et `audit` : c'est une boucle
interne, jamais une preuve avant une PR. Avec `kotlinc` et `java`, la parité
TS ↔ Kotlin tourne aussi — la durée dépend de l'outillage. Une régression
d'invariant est bloquante ; le détail des étapes est dans
[`docs/architecture/BUILD.md`](docs/architecture/BUILD.md).

## Données et sécurité

- **Aucun secret** dans le dépôt : pas de clé, de session, de `.env`, ni de
  donnée scolaire.
- Ne joins jamais `tests/fixtures/pronote/` ni une capture non caviardée :
  masque noms, établissement, URL et identifiants avant de publier une image.
- Une faille exploitable ne s'ouvre pas en issue publique : suis
  [`SECURITY.md`](SECURITY.md).

## Style

La documentation et les commentaires sont en français. Un commentaire ne dit
que ce que le code ne peut pas dire : contrainte, piège mesuré, invariant
`I<n>`. Pas d'historique, pas de code commenté, pas de bannière.

Licence : GPL-3.0-only ([`LICENSE`](LICENSE)). En contribuant, tu acceptes que
ta contribution soit publiée sous cette licence ; la décision est consignée
dans [ADR-008](docs/adr/008-relicense-gpl.md).
