---
name: VerySlopyNyNotes
description: Relevé scolaire vivant, coloré et dense, inspiré de Papillon.
colors:
  brand: "#29947a"
  brand-light: "#48a98b"
  brand-deep: "#1c6653"
  brand-pale: "#edf8f5"
  brand-solid: "#1c6653"
  on-brand: "#ffffff"
  on-brand-soft: "rgba(255, 255, 255, 0.88)"
  ink: "#1f292e"
  ink-soft: "#6f797d"
  muted: "#5f696d"
  surface: "#ffffff"
  page: "#f6fbfa"
  surface-variant: "#f3f6f7"
  rule: "#d6dcdd"
  rule-strong: "#8a9497"
  danger: "#dc1400"
  danger-ink: "#c11200"
  on-danger: "#ffffff"
typography:
  display:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 800
    lineHeight: "42px"
    letterSpacing: "-0.03em"
    fontFeature: "tnum"
  display-m:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 800
    lineHeight: "34px"
    letterSpacing: "-0.025em"
    fontFeature: "tnum"
  display-s:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 800
    lineHeight: "29px"
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
  headline:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 750
    lineHeight: "25px"
    letterSpacing: "-0.015em"
  headline-m:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: "23px"
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: "22px"
  title-m:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: "22px"
  body:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "22px"
  body-m:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  caption:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: "16px"
    letterSpacing: "0.08em"
  micro:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: "14px"
    letterSpacing: "0.08em"
  label:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: "22px"
  stat:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 800
    lineHeight: "42px"
    letterSpacing: "-0.03em"
    fontFeature: "tnum"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "18px"
rounded:
  hairline: "1px"
  mark: "3px"
  sheet: "6px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lesson: "18px"
  lg: "20px"
  xl: "24px"
  dock: "26px"
  "2xl": "28px"
  pill: "999px"
spacing:
  xxs: "4px"
  xs: "6px"
  sm: "8px"
  md: "12px"
  gutter: "18px"
  lg: "24px"
  section: "30px"
components:
  button-primary:
    backgroundColor: "{colors.brand-solid}"
    textColor: "{colors.on-brand}"
    rounded: "{rounded.sm}"
    padding: "0 18px"
    height: "48px"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.brand-deep}"
    rounded: "{rounded.sm}"
    padding: "0 18px"
    height: "48px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "20px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "48px"
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "4px 11px"
    height: "34px"
  topbar:
    backgroundColor: "{colors.page}"
    textColor: "{colors.ink}"
    height: "62px"
  tabbar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.dock}"
    height: "56px"
---

# Design System: VerySlopyNyNotes

## Overview

**Creative North Star: « Le Relevé vivant »**

L'interface est un relevé scolaire, pas un journal imprimé. Le fond respire la
couleur de la palette par deux halos fixes ; les cartes sont des surfaces
opaques très arrondies ; les tuiles d'accès et les cours portent la teinte
saturée de leur matière. La référence liée est Papillon 8.6.2, installé sur le
téléphone de l'utilisateur : fond profond, formes généreuses, dock flottant,
couleur assumée. L'app garde son nom, son contenu et ses 21 palettes.

La profondeur est réelle mais discrète : une ombre portée basse en thème clair,
aucune ombre en thème sombre où le contraste suffit. Le mouvement reste court
et se limite à l'opacité et au `transform`.

**Key Characteristics:**

- Fond ambiant teinté par la palette, deux halos fixes, aucune texture.
- Cartes de 20 à 24 px de rayon, surfaces opaques, ombre basse en clair.
- En-tête d'identité à l'accueil : avatar, nom, classe et période.
- Tuiles d'accès et cartes de cours teintées par matière.
- Dock flottant à cinq onglets, capsule active, en-tête transparent flouté.
- Chiffres tabulaires, libellés courts, forte hiérarchie de poids.

## Colors

La palette par défaut est le vert « slop ». Les 21 palettes remplacent les mêmes
variables à l'exécution : les rôles ci-dessous ne changent pas, seules les
teintes changent. Le thème sombre est la démonstration la plus proche de
Papillon ; le clair applique le même langage sur papier froid.

### Primary

- **Vert marque** (`#1c6653`, `--brand-solid`) : boutons pleins, jauge de
  moyenne, capsule d'onglet actif, avatar.
- **Vert clair** (`#48a98b`, `--brand-light`) : halo supérieur et teintes douces.
- **Vert encre** (`#1c6653` en clair, `#a7e3d2` en sombre) : liens, titres
  actifs, texte sur teinte de matière.
- **Vert pale** (`#edf8f5`) : capsule active, fonds de sélection.

### Neutral

- **Encre** (`#1f292e`) : texte principal, titres, chiffres.
- **Encre douce** (`rgba(31, 41, 46, 0.72)`) : métadonnées, dates, libellés.
- **Papier** (`#f6fbfa`) : fond de page sous les halos.
- **Surface** (`#ffffff` en clair, `#121212` en sombre) : cartes, champs, dock.
- **Filet** (`rgba(31, 41, 46, 0.18)`) : bord du dock, séparateurs.
- **Filet fort** (`rgba(31, 41, 46, 0.44)`) : séparateurs de sections.

### Named Rules

**La règle de la teinte utile.** La couleur d'une matière peut remplir une tuile
d'accès, une carte de cours ou une ligne de note, à condition que le texte
posé dessus soit dérivé de la même teinte et garde un contraste AA. Une teinte
décorative sans rôle est une faute.

**La règle du signal.** Le rouge est réservé au danger réel : alerte, absence
injustifiée, action destructive. Une simple absence de données reste neutre.

## Typography

**Display Font:** Figtree (avec `system-ui`, sans-serif)
**Body Font:** Figtree (avec `system-ui`, sans-serif)
**Mono Font:** ui-monospace (avec `SFMono-Regular`, Menlo, Consolas)

**Character:** Une seule famille, très contrastée par le poids et l'échelle.
Figtree en 800 pour les titres et les grands chiffres, en 400 pour le corps.
La hiérarchie vient du corps, de l'espace et de la couleur, jamais d'une
seconde police.

### Hierarchy

- **Display** (800, 40 px / 42 px, `-0.03em`) : moyenne générale et grands
  chiffres. Chiffres tabulaires obligatoires.
- **Display S** (800, 26 px / 29 px, `-0.02em`) : titre de page, identité.
- **Headline** (750, 20 px / 25 px, `-0.015em`) : titres de section.
- **Title** (700, 17 px / 22 px) : titre de carte, de devoir, de discussion.
- **Body** (400, 15 px / 22 px) : texte courant, consignes, descriptions.
- **Caption** (600, 12 px / 16 px, `0.08em`, capitales) : surtitres de registre,
  dates, unités, états.
- **Micro** (600, 10 px / 14 px, `0.08em`) : libellés du dock, mentions légales.

### Named Rules

**La règle du chiffre tabulaire.** Toute valeur numérique qui peut être comparée
(moyenne, note, heure, compteur) utilise `font-variant-numeric: tabular-nums`.

## Layout

Largeur de contenu maximale de 760 px, gouttière de 18 px sur mobile, cible de
référence 412 × 892 px et minimum testé 360 px. Le contenu respire par piles de
18 px sur l'accueil, 12 px ailleurs ; les sections sont séparées par 26 px sans
filet.

La coquille occupe la hauteur utile publiée par le JS (`--app-height`), jamais
une hauteur de viewport figée. Le dock est fixe, flottant à 12 px des bords, et
le `main` réserve sa hauteur plus 46 px en bas. Quand le clavier s'ouvre, le
dock et les éléments fixes remontent de `--keyboard-bottom`.

L'accueil suit l'ordre de Papillon : identité dans l'en-tête (avatar, nom,
classe), grille 2 × 2 de raccourcis teintés, puis cartes de cours, moyenne et
devoirs. L'en-tête porte l'engrenage des réglages ; le profil s'ouvre par
l'identité. Les écrans de liste restent des cartes séparées, jamais un registre
à filets. Les réglages commencent par l'identité centrée et quatre tuiles
teintées qui ancrent les sections.

## Elevation & Depth

En thème clair, la profondeur vient d'une ombre basse et large
(`--shadow-card`), jamais d'un filet noir. En thème sombre, les ombres sont
désactivées : le contraste des surfaces suffit.

Le dock porte `--shadow-dock` en clair, un fond translucide flouté dans les deux
thèmes, et un filet de 1 px. Les halos de fond sont fixes et purement
décoratifs : ils n'interceptent aucun clic et ne portent aucune information.

Le mouvement est court (180 ms, `--ease`) et se limite à l'opacité et au
`transform`, avec une garde unique `prefers-reduced-motion` dans `tokens.css`.

## Shapes

Rayons de 3 px (marques de matière) à 28 px (`--radius-2xl`), avec un usage
courant de 16 à 24 px. Les cartes et tuiles sont généreusement arrondies ; le
dock est un rectangle de 26 px ; les capsules d'état, avatars et l'onglet actif
sont des pastilles `999px`. La barre de 4 px à gauche d'une carte de cours est
la seule exception au refus des bords colorés épais : elle identifie la matière
dans l'emploi du temps et sur la bannière cours en cours / suivant.

Le filet reste l'unité de séparation interne, mais il ne structure plus les
pages : les cartes se lisent par leur surface et leur teinte.

## Components

- **Topbar** : fond de page translucide, flou de 16 px, titre en 24 px / 800,
  actions rondes de 42 px, sans filet sauf sur l'accueil. Aucune ombre. À
  l'accueil, l'identité remplace le titre : avatar de 40 px, nom 16 px / 750,
  classe et période en 12 px.
- **Dock** : cinq onglets, fond surface translucide flouté, rayon 26 px, filet,
  ombre basse en clair. L'onglet actif porte une capsule `--brand-pale` de 48 px
  de large et une icône `--brand-deep`.
- **Tuiles d'accès** : grille 2 × 2, rayon 24 px, fond surface, icône de 22 px
  teintée par la matière, libellé 14 px / 750, sous-titre 12 px.
- **Cartes** : fond `--panel`, rayon 24 px, padding 16 à 20 px, ombre basse en
  clair. Une carte cliquable change de fond au survol et se réduit de 1 % au
  toucher. L'en-tête de widget porte une icône, un titre 17 px / 750, une
  pastille de compteur et « Afficher plus » en capsule.
- **Cartes de cours** : l'heure est une colonne fixe de 48 px hors de la carte ;
  la carte a un rayon 16 px, un fond et une encre dérivés de la matière, et une
  barre de 4 px à gauche. Dans l'emploi du temps, la bannière cours en cours /
  suivant reprend le même fond teinté.
- **Cartes de devoir** : avatar emoji de 34 px teinté par matière, nom de
  matière coloré, titre 17 px, échéance en pastille, puis actions. La
  complétion est une capsule « Marquer fait » / « Terminé » dans le pied.
- **Dernières notes** : cartes horizontales teintées de 178 px, emoji de
  matière, valeur dans une pastille dérivée de l'encre.
- **Réglages** : identité centrée, puis quatre tuiles 2 × 2 teintées (Apparence,
  Matières, Assistant, Appareil) qui font défiler aux sections ancrées.
- **Boutons** : 48 px de haut, rayon 12 px, texte 700. Le bouton plein est
  `--brand-solid` / `--on-brand` ; le bouton fantôme est une surface avec filet.
- **Champs** : 48 px, fond surface, bordure `--rule`, focus en anneau d'encre.
- **Lignes de liste** : cartes individuelles de 60 px, rayon 20 px, ombre basse
  en clair, jamais un registre à filets.
- **Avatars** : cercle plein `--brand-solid`, initiales en `--on-brand` ; une
  photo remplace le fond.
- **Dialogues** : largeur maximale 440 px, bordure `--rule-strong`, fond opaque,
  actions alignées à droite.

## Do's and Don'ts

**Do**

- Garder le dock flottant et l'en-tête transparent : ce sont les deux repères
  stables de l'app.
- Teinter les tuiles et les cours par matière, avec une encre dérivée de la
  même teinte.
- Laisser les chiffres grands et tabulaires.
- Vérifier les contrastes dans les 21 palettes, en clair comme en sombre.
- Désactiver les ombres en thème sombre plutôt que de les éclaircir.

**Don't**

- Remettre un filet noir épais autour des cartes ou un registre à lignes nues.
- Colorer une carte sans dériver l'encre de la même teinte.
- Ajouter une barre latérale colorée ailleurs que sur les cartes de cours.
- Ajouter une texture, un motif ou une image de fond.
- Utiliser une ombre blanche ou un halo clair en thème sombre.
- Dupliquer une information dans un badge décoratif : le badge doit porter un
  état, pas répéter le titre.
