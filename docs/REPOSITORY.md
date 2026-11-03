# Métadonnées du dépôt

Ce que la page GitHub affiche, et comment le vérifier. Les valeurs ci-dessous
sont la source de vérité pour la description, les sujets et l'aperçu social ;
un changement se fait dans l'interface ou par `gh api`, puis ici.

## Description

> Client Android open source pour Pronote : session locale, IA sans relais,
> hors-ligne d’abord. Kotlin, React, Bun.

350 caractères maximum côté GitHub ; celle-ci reste courte pour être lisible
dans les résultats de recherche.

## Sujets

- `android`
- `bun`
- `education`
- `kotlin`
- `offline-first`
- `open-source`
- `privacy`
- `pronote`
- `react`
- `typescript`
- `webview`

Un sujet est en minuscules, sans espace ; GitHub en accepte 20 au maximum.

## Site

Aucun site public n'existe : pas de domaine, pas de GitHub Pages, aucune
release publiée. La page d'accueil (`homepage`) reste donc **vide** plutôt que
de pointer vers un site inventé. La documentation vit dans ce dépôt, à partir
de [`CONTEXT.md`](CONTEXT.md).

## Aperçu social

L'aperçu social est une **étape manuelle** : les API REST et GraphQL de GitHub
exposent l'image (`openGraphImageUrl`) mais aucune mutation pour l'envoyer. Le
token du dépôt ne permet donc pas de la définir.

À faire une fois, dans **Settings → General → Social preview** :

1. Image PNG ou JPG, **1280 × 640**, moins de 1 Mo.
2. Fond sombre, nom « veryslopnynotes », la phrase
   « Ton Pronote. Ta session. Rien que toi. » et aucune donnée scolaire.
3. Texte alternatif : « veryslopnynotes — client Android Pronote local ».
4. Vérifier le rendu dans un lien partagé, puis noter la date ici.

Tant que l'image n'est pas envoyée, GitHub affiche l'aperçu généré à partir du
README : ce n'est pas un aperçu personnalisé.

## Bonnes premières issues

Cinq issues autonomes, avec périmètre et critères d'acceptation. Le label
[`good first issue`](https://github.com/iguanacucumber/veryslopnynotes/labels/good%20first%20issue)
les regroupe.

| # | Issue | Périmètre | Labels |
|---|---|---|---|
| 1 | #1069 | Modèle d'issue « Demande de fonctionnalité » | `good first issue`, `docs`, `community` |
| 2 | #1070 | Cible `make help` documentée | `good first issue`, `community`, `docs` |
| 3 | #1071 | Test du badge Contrats du README | `good first issue`, `ci`, `docs` |
| 4 | #1072 | Glossaire des sigles du dépôt | `good first issue`, `docs`, `community` |
| 5 | #1073 | Tests des dates civiles impossibles | `good first issue`, `ci`, `web` |

Chaque issue tient en une PR courte, ne demande ni appareil ni compte Pronote,
et laisse `make check-fast` vert. Une issue = une branche = une PR.

## Vérification

Depuis la racine du dépôt, avec un token qui lit les métadonnées :

```bash
gh repo view --json description,homepageUrl,repositoryTopics
gh api repos/iguanacucumber/veryslopnynotes/topics
gh issue list --state open --label "good first issue" --limit 20 \
  --json number,title,labels
```

Attendu : la description ci-dessus, `homepageUrl: ""`, les 11 sujets, et
exactement cinq issues ouvertes portant le label.

Les commandes d'écriture, si le token le permet :

```bash
gh api --method PATCH repos/iguanacucumber/veryslopnynotes \
  --input - <<'JSON'
{"description":"Client Android open source pour Pronote : session locale, IA sans relais, hors-ligne d’abord. Kotlin, React, Bun.","homepage":""}
JSON
gh api --method PUT repos/iguanacucumber/veryslopnynotes/topics \
  --input - <<'JSON'
{"names":["android","bun","education","kotlin","offline-first","open-source","privacy","pronote","react","typescript","webview"]}
JSON
```

`tests/architecture/docs.test.ts` vérifie la forme de ce fichier : sections,
format des sujets, cinq issues distinctes et lien depuis
[`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Mise à jour

1. Changer la valeur dans l'interface GitHub ou par `gh api`.
2. Reporter la même valeur ici, sans seconde source.
3. Relancer `make check-fast`.
4. Pour l'aperçu social, refaire l'étape manuelle et mettre à jour la date.
