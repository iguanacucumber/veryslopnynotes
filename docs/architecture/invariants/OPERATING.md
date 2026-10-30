# OPERATING.md — ajouter, réviser ou retirer un invariant

Détail de [`INVARIANTS.md`](../INVARIANTS.md) : le registre reste un index,
cette page porte la procédure.

## Format d'une entrée

Une entrée vit dans `docs/architecture/invariants/<thème>.md`, ancrée
`<a id="i<n>"></a>`, titrée `## I<n> — règle`, puis :

- `- Invariant :` la règle, vérifiable.
- `- Test :` les fichiers de test cités (chemins réels ou globs).
- `- Commande :` une cible `make` existante.
- `- Emplacement :` le fichier à modifier.

Une entrée tient en 120 mots ; au-delà, le détail va dans un lien (issue,
commit, ADR). L'identifiant est unique et n'est jamais réutilisé.

## Ajouter ou réviser

1. Un incident réel ou une menace identifiée. Pas de règle spéculative.
2. Une règle en une phrase, vérifiable par un test qui échoue avant le
   correctif.
3. Comportement et types d'abord ; un scan de source est un dernier recours,
   avec sa raison et son chemin de remplacement.
4. Une ligne dans le registre, une entrée détaillée, une ligne dans la carte
   [`CONTEXT.md`](../../CONTEXT.md).
5. Si la règle chevauche un invariant existant, réviser cet invariant au lieu
   d'en créer un second.

Une règle qui ne peut pas être testée est une convention, pas un invariant.
`tests/architecture/docs.test.ts` vérifie les identifiants, le format, les
références, l'existence des fichiers cités et les commandes citées.

## Retirer

Une règle obsolète ou absorbée se retire sans renuméroter : supprimer son
entrée détaillée et sa ligne du registre, puis l'inscrire sous `## Retirés`
(ID, date, issue, remplacement éventuel). Un trou entre I1 et la dernière
entrée active n'est toléré que si l'ID figure dans `## Retirés` ; un ID retiré
qui réapparaît comme entrée active échoue au gate.
