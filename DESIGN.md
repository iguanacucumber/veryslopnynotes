---
name: VerySlopyNyNotes
description: Relevé scolaire mobile, calme et lisible, sur papier froid.
colors:
  brand: "#29947a"
  brand-light: "#48a98b"
  brand-deep: "#1c6653"
  brand-pale: "#edf8f5"
  brand-solid: "#1c6653"
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
  on-brand: "#ffffff"
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
  xs: "2px"
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "10px"
  "2xl": "12px"
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
    rounded: "{rounded.sm}"
    padding: "18px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "48px"
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xs}"
    padding: "4px 11px"
    height: "34px"
  topbar:
    backgroundColor: "{colors.brand-solid}"
    textColor: "{colors.on-brand}"
    height: "58px"
  tabbar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    height: "66px"
---

# Design System: VerySlopyNyNotes

## Overview

**Creative North Star: « Le Bulletin »**

L'interface est un relevé scolaire, pas une pile de cartes. Le papier froid tient
le fond, l'encre porte la hiérarchie, et un filet d'un pixel sépare ce qui doit
l'être. L'en-tête plein prend la couleur de la palette ; partout ailleurs, la
couleur ne sert qu'à indexer une matière ou à signaler une alerte.

Le système est volontairement plat : aucune ombre de carte, aucun dégradé
décoratif, aucun verre, aucun halo. La profondeur vient de l'ordre de lecture et
des filets, jamais de l'élévation. Les chiffres sont tabulaires pour qu'une
moyenne se compare d'un coup d'œil, et les actions gardent les mêmes cibles
tactiles que l'app native.

**Key Characteristics:**

- Registre calme, dense en information, sans bruit visuel.
- En-tête `--brand-solid`, contenu sur papier, barre d'onglets plate.
- Filets de 1 px, rayons de 2 à 6 px, angles francs.
- Couleur de matière réduite à une marque d'index de 10 à 12 px.
- Chiffres tabulaires, libellés en petites capitales espacées.

## Colors

La palette par défaut est le vert « slop ». Les 21 palettes remplacent les mêmes
variables à l'exécution : les rôles ci-dessous ne changent pas, seules les
teintes changent.

### Primary

- **Vert registre** (`#1c6653`, `--brand-solid`) : en-tête, boutons pleins,
  indicateur d'onglet actif, marques d'index. C'est la seule couleur qui peut
  couvrir une grande surface.
- **Vert encre** (`#1c6653` en clair) : liens, actions secondaires, titres de
  section actifs.
- **Vert pale** (`#edf8f5`) : fonds de sélection discrets, jamais un fond de
  carte entier.

### Neutral

- **Encre** (`#1f292e`) : texte principal, titres, chiffres.
- **Encre douce** (`#6f797d`) : métadonnées, dates, libellés secondaires.
- **Papier** (`#f6fbfa` mélangé à la surface) : fond de page.
- **Surface** (`#ffffff`) : cartes, champs, barre d'onglets.
- **Filet** (`#d6dcdd`) : séparateurs internes.
- **Filet fort** (`#8a9497`) : bord de barre d'onglets, séparateurs de sections.

### Named Rules

**La règle de l'index.** La couleur d'une matière ne remplit jamais une carte :
elle tient dans une marque de 10 à 12 px, un filet ou une barre de progression.
Une carte teintée entière est un retour au décor, pas une information.

**La règle du signal.** Le rouge est réservé au danger réel : alerte, absence
injustifiée, action destructive. Une simple absence de données reste neutre.

## Typography

**Display Font:** Figtree (avec `system-ui`, sans-serif)
**Body Font:** Figtree (avec `system-ui`, sans-serif)
**Mono Font:** ui-monospace (avec `SFMono-Regular`, Menlo, Consolas)

**Character:** Une seule famille, très contrastée par le poids et l'échelle.
Figtree en 800 pour les titres et les chiffres, en 400 pour le corps. Pas de
seconde police décorative : la hiérarchie vient du corps et de l'espace. Le
monospace ne sert qu'au code et aux extraits techniques.

### Hierarchy

- **Display** (800, 40 px / 42 px, `-0.03em`) : salutation du relevé, moyenne
  principale. Chiffres tabulaires obligatoires.
- **Headline** (750, 20 px / 25 px, `-0.015em`) : titres de section.
- **Title** (700, 17 px / 22 px) : titre de carte, de devoir, de discussion.
- **Body** (400, 15 px / 22 px) : texte courant, consignes, descriptions.
- **Caption** (600, 12 px / 16 px, `0.08em`, capitales) : surtitres de registre,
  dates, unités, états.
- **Micro** (600, 10 px / 14 px, `0.08em`) : libellés d'onglets, mentions
  légales.

### Named Rules

**La règle du chiffre tabulaire.** Toute valeur numérique qui peut être comparée
(moyenne, note, heure, compteur) utilise `font-variant-numeric: tabular-nums`.

## Layout

Largeur de contenu maximale de 760 px, gouttière de 18 px sur mobile, cible de
référence 412 × 892 px et minimum testé 360 px. Le contenu respire par piles de
12 px ; les sections sont séparées par 30 px et un filet.

La coquille occupe la hauteur utile publiée par le JS (`--app-height`), jamais
une hauteur de viewport figée. La barre d'onglets est fixe, pleine largeur, et
le `main` réserve sa hauteur plus 32 px en bas. Quand le clavier s'ouvre, la
barre et les éléments fixes remontent de `--keyboard-bottom`.

Le relevé d'accueil est un masthead : filet supérieur, date, salutation, puis
deux colonnes tabulaires (moyenne, devoirs). Les écrans de liste privilégient
des lignes de registre séparées par des filets aux cartes empilées.

## Elevation & Depth

Le système est **plat**. Aucune ombre de carte, aucun `backdrop-filter`, aucun
halo. La hiérarchie vient de l'ordre, du contraste et des filets.

Les seules couches sont fonctionnelles : le dialogue modal (bordure, fond
opaque, voile `--overlay`) et la barre d'onglets fixe. Les états de survol
changent la bordure ou le fond, jamais l'élévation. Le mouvement est court
(180 ms, `--ease`) et se limite à l'opacité et au `transform`, avec une garde
unique `prefers-reduced-motion` dans `tokens.css`.

## Shapes

Rayons de 1 px (aperçus de palette) à 12 px (`--radius-2xl`), avec un usage
courant de 2 à 6 px. Les boutons, champs, cartes et dialogues sont francs, jamais
des pastilles. Interdits : `border-radius: 999px`, les pilules, les bords
colorés épais de 3 px sur une carte arrondie.

Le filet est l'unité de forme : 1 px pour séparer, 3 px pour l'indicateur
d'onglet actif, 2 px pour le soulignement d'un onglet de section. Les marques de
matière sont des carrés de 10 à 12 px, pas des ronds.

## Components

- **Topbar** : aplat `--brand-solid`, titre en 25 px / 800, icônes en
  `--on-brand`, filet bas. Pas de flou, pas d'ombre.
- **Tabbar** : fond `--surface`, filet haut `--rule-strong`, cinq onglets de
  48 px minimum, indicateur glissant de 3 px en `--brand-solid`.
- **Cartes** : fond `--panel`, bordure 1 px `--rule`, rayon 4 px. Une carte
  cliquable change de bordure et de fond au survol.
- **Boutons** : 48 px de haut, rayon 4 px, texte 700. Le bouton plein est
  `--brand-solid` / `--on-brand` ; le bouton fantôme est une surface avec un
  filet. Aucune ombre.
- **Champs** : 48 px, fond surface, bordure `--rule`, focus en anneau d'encre.
- **Puces** : rayon 2 px, hauteur 34 px (48 px si cliquables), bordure 1 px.
  L'état actif est un aplat de marque, jamais une teinte pastel.
- **Lignes de liste** : 56 px minimum, séparées par un filet, sans carte
  individuelle.
- **Dialogues** : largeur maximale 440 px, bordure `--rule-strong`, fond opaque,
  actions alignées à droite.

## Do's and Don'ts

**Do**

- Garder l'en-tête plein et la barre d'onglets plate : ce sont les deux repères
  stables de l'app.
- Utiliser un filet de 1 px avant une ombre, un rayon avant une pilule.
- Poser la couleur de matière en marque d'index, en filet ou en barre.
- Aligner les chiffres sur une grille tabulaire et les laisser grands.
- Vérifier les contrastes dans les 21 palettes, en clair comme en sombre.

**Don't**

- Ajouter un dégradé décoratif, un halo, un verre dépoli ou une ombre de carte.
- Colorer une carte entière avec la couleur d'une matière.
- Utiliser `border-radius: 999px` ou une pastille pour un statut.
- Mettre un bord coloré épais sur une carte arrondie.
- Dupliquer une information dans un badge décoratif : le badge doit porter un
  état, pas répéter le titre.
