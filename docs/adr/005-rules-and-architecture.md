# ADR-005 — règles et architecture après la revue 2026-10

- Statut : accepté (issue #635)
- Complète : [ADR-001](001-stack.md), [ADR-003](003-client-direct.md),
  [ADR-004](004-webview.md). Aucun de ces ADR n'est remplacé.
- Revue : [`docs/architecture/REVIEW-2026-10.md`](../architecture/REVIEW-2026-10.md)

## Contexte

L'architecture a grossi par incidents. Chaque défaut a laissé un invariant, un
test et un paragraphe d'histoire. Le registre fait 8 267 mots, `I16` existe en
double, `README.md` cite encore `I1–I10`, et 95 des 110 fichiers de test lisent
les sources. Les garanties sont réelles ; leur forme ne passe plus à l'échelle.

Le pont natif est le point de couplage principal : 1 982 lignes, 53 méthodes,
allowlist et délais recopiés des deux côtés. Le stockage hors-ligne utilise des
clés globales, donc une époque et des purges pour chaque artefact. Le scraper est
le seul service réseau sans authentification, avec un risque SSRF résiduel
documenté.

## Décision

### 1. Hiérarchie des règles

Une seule échelle, du plus fort au plus faible :

1. **Lois** — cinq propriétés non négociables, dans [`AGENTS.md`](../../AGENTS.md).
   Une loi ne change que par ADR.
2. **ADR** — une décision datée, avec son contexte, ses alternatives et ses
   conséquences.
3. **Invariants** — une propriété testable du produit ou de la chaîne de build,
   dans [`INVARIANTS.md`](../architecture/INVARIANTS.md). Régression = PR
   bloquante.
4. **Conventions** — style, nommage, outillage. Utiles, mais non bloquantes.

Une règle qui ne peut pas être testée est une convention, pas un invariant. Une
convention qui doit bloquer devient un invariant avec son test.

### 2. Budget et cycle de vie des documents

- `AGENTS.md` reste une charte courte : les 5 lois, le workflow, le gate, les
  pointeurs. Le détail opérationnel vit dans les README de module.
- Une entrée d'invariant suit un format fixe : règle en une phrase, test,
  commande, portée. **120 mots maximum** pour la règle et son contexte ; le
  reste est un lien. Les entrées héritées se mettent au budget quand elles sont
  révisées, pas par une réécriture en masse.
- Un identifiant d'invariant est **unique et jamais réutilisé**. Un ajout qui
  chevauche un invariant existant le révise au lieu d'en créer un second.
- Un nouvel invariant exige un incident réel ou une menace identifiée. Pas de
  règle spéculative.
- L'historique (« avant #xxx ») vit dans l'issue, le commit ou l'ADR, pas dans
  le registre.
- Le registre commence par une vue d'un écran : une ligne par invariant.

### 3. Pont : un contrat, puis du code généré, puis un découpage

Le pont reste la frontière (ADR-004), mais son contrat devient une **donnée
unique** :

1. Un manifest décrit chaque méthode : nom, entrée, sortie, délai, lane
   (lecture, écriture, LLM), côté sensible.
2. Les types TypeScript, l'allowlist Kotlin, les délais et le pont factice en
   découlent. Les tests comparent le manifest au code, pas deux listes
   recopiées.
3. `VsnBridge.kt` est découpé par domaine derrière un registre de handlers.

Tant que le manifest n'existe pas, toute nouvelle méthode doit au minimum être
ajoutée aux deux allowlists dans la même PR, avec un test de parité.

### 4. Stockage : une racine par compte

La donnée hors-ligne appartient à un compte, donc vit sous une racine qui porte
ce compte : `filesDir/accounts/<empreinte>/`. Changer de compte = changer de
racine ; se déconnecter = supprimer la racine. Les clés de cache deviennent
locales au compte.

L'époque reste nécessaire pour annuler une écriture **en vol** pendant une
déconnexion. Elle ne sert plus à distinguer deux comptes : la racine le fait.
La migration se fait store par store, sans big-bang.

### 5. Scraper : sidecar local, jamais service public

Le scraper reste facultatif. Il est un **outil local** :

- bind sur la boucle locale par défaut ;
- une exposition non-loopback exige un opt-in explicite et un proxy authentifié
  devant lui ;
- aucune fonctionnalité de l'app ne doit en dépendre pour fonctionner hors
  ligne ;
- l'issue #634 et toute extension de son rôle passent par cette même règle.

Sa suppression ou son remplacement par une lecture locale reste une option
ouverte (P2 de la revue). Le dépôt ne doit pas payer indéfiniment cinq
invariants pour une fonctionnalité optionnelle sans mesurer son usage.

### 6. Tests : comportement d'abord, source en dernier recours

Ordre de préférence :

1. test de comportement qui exécute le code (Kotlin compilé, React rendu,
   contrat réel) ;
2. test de type ou de compilation ;
3. test structurel sur les imports, les couches ou les allowlists ;
4. scan de source textuel, seulement si les trois précédents ne peuvent pas
   exprimer la propriété.

Un scan de source porte un commentaire qui dit pourquoi il existe et ce qui le
remplacerait. On n'ajoute pas un scan pour vérifier un commentaire, une chaîne
de message ou l'ordre de lignes quand un test de comportement est possible.

### 7. Outillage statique avant les regex

Le gate doit préférer un outil standard à un scanner maison :

- Android Lint et detekt/ktlint pour Kotlin ;
- `noUncheckedIndexedAccess` et les symboles inutilisés pour TypeScript ;
- les regex existantes restent tant que l'outil ne couvre pas la propriété, puis
  sont retirées.

`I9` (code mort) est le premier candidat au remplacement. Un scanner qui n'a
plus de raison d'être est supprimé, pas conservé « au cas où ».

### 8. Budget du gate

`make check` reste l'autorité unique. Une étape ne s'ajoute que si elle remplace
une étape existante ou couvre une propriété qu'aucune autre ne couvre. Le gate
peut grandir, mais chaque ajout se justifie en durée et en maintenance. Les
optimisations (cache de dépendances, parallélisme) ne doivent jamais servir la
compilation Kotlin à la place de la faire tourner.

### 9. Merge automatique sous condition de gate

Le circuit issue → branche → PR → merge reste automatique, sans attente humaine.
Cette autonomie n'est justifiée que par le gate : `ship.sh` rejoue `make check`
après rebase, et la CI rejoue le même gate sur la PR. Une PR dont le gate n'a pas
tourné n'est jamais fusionnée. Si le gate est allégé ou contourné, l'automatisme
s'arrête : c'est le gate qui tient lieu de relecture finale, pas la confiance.
Amendé par [ADR-007](007-agent-review-before-ship.md) : le gate ne juge ni le
périmètre ni la lisibilité, donc `ship.sh` exige en plus une note de revue liée
au HEAD.

## Alternatives rejetées

- **Tout garder et continuer à documenter par incident** : le registre devient
  illisible, donc inapplicable. Rejeté.
- **Supprimer le registre et ne garder que les tests** : les tests disent
  comment, pas pourquoi. Une régression peut être « corrigée » en supprimant le
  test. Rejeté.
- **Générer le pont immédiatement** : un manifest écrit à la main est un
  préalable ; la génération sans contrat stable figerait les erreurs actuelles.
  Rejeté pour cette PR, accepté comme étape P1.
- **Un serveur applicatif pour le scraper** : contredit ADR-003 et I8. Rejeté.
- **Un stockage global avec une époque par artefact** : c'est l'état actuel,
  dont le coût est précisément le sujet. Rejeté.
- **Réécrire l'app en Compose ou en PWA** : contredit ADR-004 et les
  contraintes plateforme. Rejeté.

## Conséquences

- `AGENTS.md` devient une charte ; les détails opérationnels restent dans les
  README et les ADR.
- `INVARIANTS.md` gagne un registre d'une ligne par invariant, des identifiants
  uniques et un format vérifié.
- `tests/architecture/docs.test.ts` fait échouer le gate si le registre, les
  références ou les commandes citées divergent.
- Les chantiers de code (manifest du pont, découpage, racine par compte,
  scraper, lint) sont suivis par des issues séparées. Cet ADR ne change aucun
  comportement.
- Une PR qui viole une loi ou un invariant reste bloquante, même si elle passe
  les tests fonctionnels.

## Risques

- **Migration du stockage** : une erreur de racine peut rendre le cache
  illisible. Migration store par store, avec un repli qui purge plutôt que de
  servir la donnée d'un autre compte.
- **Contrat du pont** : un manifest mal conçu peut figer une mauvaise
  abstraction. Le manifest décrit d'abord l'existant, sans le réinventer.
- **Scraper** : le containment réduit l'exposition mais ne supprime pas le
  risque SSRF local. La décision de suppression reste ouverte.
- **Budget documentaire** : un plafond de 120 mots peut faire perdre un détail
  utile. Le détail va dans l'issue ou l'ADR, pas dans le registre.
