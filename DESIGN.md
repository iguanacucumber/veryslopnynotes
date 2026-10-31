---
name: VerySlopyNyNotes
description: Relevé scolaire vivant, copie visuelle de Papillon 8.6.2.
colors:
  brand: "#29947a"
  brand-light: "#5ab09b"
  brand-deep: "#217663"
  brand-pale: "#e9f5f1"
  brand-solid: "#1c6653"
  on-brand: "#ffffff"
  ink: "#000000"
  secondary: "rgba(0, 0, 0, 0.55)"
  surface: "#ffffff"
  page: "#ffffff"
  item: "#f1f1f1"
  surface-variant: "#f3f6f7"
  border: "rgba(0, 0, 0, 0.16)"
  danger: "#dc1400"
  danger-ink: "#c11200"
typography:
  fontFamily: "SN Pro, system-ui, sans-serif"
  display:
    fontSize: "44px"
    lineHeight: "56px"
    fontWeight: 700
  display-m:
    fontSize: "32px"
    lineHeight: "40px"
    fontWeight: 700
  display-s:
    fontSize: "28px"
    lineHeight: "34px"
    fontWeight: 700
  headline:
    fontSize: "24px"
    lineHeight: "30px"
    fontWeight: 700
  headline-m:
    fontSize: "20px"
    lineHeight: "26px"
    fontWeight: 700
  header:
    fontSize: "19px"
    lineHeight: "22px"
    fontWeight: 700
    letterSpacing: "0.08px"
  title:
    fontSize: "17px"
    lineHeight: "22px"
    fontWeight: 600
  body:
    fontSize: "16px"
    lineHeight: "20px"
    fontWeight: 500
  body-m:
    fontSize: "15px"
    lineHeight: "19px"
    fontWeight: 600
  caption:
    fontSize: "14px"
    lineHeight: "19px"
    fontWeight: 400
    letterSpacing: "0.1px"
rounded:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lesson: "25px"
  lg: "20px"
  xl: "22px"
  widget: "25px"
  sheet: "24px"
  pill: "999px"
spacing:
  xxs: "4px"
  xs: "6px"
  sm: "8px"
  md: "12px"
  gutter: "16px"
  lg: "24px"
components:
  card:
    backgroundColor: "{colors.item}"
    rounded: "{rounded.lg}"
    padding: "16px"
    shadow: "0 1px 2px rgba(0, 0, 0, 0.05), 0 10px 28px -24px rgba(0, 0, 0, 0.4)"
  home-tile:
    backgroundColor: "{colors.item}"
    rounded: "{rounded.xl}"
    padding: "13px 10px"
  home-widget:
    backgroundColor: "{colors.item}"
    rounded: "{rounded.widget}"
    padding: "10px"
  task-card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "14px 16px"
  settings-tile:
    rounded: "23px"
    padding: "14px"
  chip:
    backgroundColor: "{colors.item}"
    rounded: "{rounded.pill}"
    padding: "4px 11px"
  topbar:
    backgroundColor: "{colors.page}"
    height: "56px"
  tabbar:
    backgroundColor: "{colors.surface}"
    height: "72px"
    rounded: "{rounded.pill}"
    shadow: "0 18px 46px -24px rgba(0, 0, 0, 0.46), 0 2px 10px rgba(0, 0, 0, 0.08)"
---

# Design System: VerySlopyNyNotes

## Overview

**North Star : la copie de Papillon 8.6.2.**

L'interface web reprend la mise en page de Papillon 8.6.2 : même police SN Pro,
même échelle typographique, mêmes surfaces, mêmes rayons, même dock flottant,
mêmes en-têtes. Les fonctions propres à l'app — onglet Prof, aide devoirs,
fiches de révision, cahier de cours — gardent leur place et leur comportement.

Les écrans d'IA parlent une langue distincte, inspirée des conversationnels :
une surface de lecture calme, des réponses en pleine largeur, une bulle courte
pour la question de l'élève et un compositeur unique. La coquille Papillon
(tuiles, en-tête, dock) reste autour ; elle n'entre pas dans le fil.

**Key Characteristics:**

- Fond de page blanc (noir en sombre), surfaces `--item` gris très clair
  (`#f1f1f1`, `#121212`) sans bordure.
- Ombre de carte très basse, presque un liseré : la profondeur vient d'abord du
  contraste des surfaces ; le dock et les dialogues portent seuls une ombre
  franche.
- En-tête plat, titre 19 px / 700, icône de route puis libellé.
- Accueil : papier peint SVG généré, identité blanche et sous-titre de classe,
  tuiles 2 colonnes, widgets à en-tête 10 px.
- Dock flottant en capsule de surface, pastille active teintée, libellé accent.
- Cinq onglets : Accueil, Cours, Tâches, Notes, Prof.
- L'assistant a ses surfaces : hero d'accueil, suggestions, fil de lecture,
  pastilles de sources et compositeur en capsule sombre.

## Colors

La palette par défaut est le vert « slop » ; les 21 palettes remplacent les
mêmes variables à l'exécution. Le thème clair, le sombre et le suivi système
sont supportés sans changer les rôles.

### Primary

- **Accent Papillon** (`#29947a`) : jauges, courbes, capsules actives, icônes
  d'action.
- **Accent plein accessible** (`#1c6653` en clair, `#6cc4a8` en sombre) :
  boutons pleins et pastilles actives, avec `--on-brand` pour le texte.
- **Pale** (`#e9f5f1` clair, `#12362c` sombre) : capsule d'onglet et sélections.

### Neutral

- **Encre** (`#000000` clair, `#ffffff` sombre) : titres et texte.
- **Secondaire** : l'encre à 55 % — dates, métadonnées, sous-titres. Le seuil
  est le contraste AA, pas une préférence esthétique.
- **Page** (`#ffffff` / `#000000`) : fond général.
- **Surface** (`#ffffff` / `#121212`) : cartes de devoir, champs, dialogues,
  dock flottant.
- **Item** (`#f1f1f1` / `#121212`) : widgets, tuiles, lignes, pastilles.

### Named Rules

**La règle de la teinte utile.** Une matière peut teinter une carte, à condition
que l'encre soit dérivée de la même couleur et garde un contraste lisible.

**La règle du signal.** Le rouge reste réservé au danger réel ; une absence de
données est neutre.

## Typography

**Famille unique : SN Pro** (SIL OFL 1.1), graisses 300 à 900, vendoriée dans
`web/src/fonts/`.

### Hierarchy

- **Display** (700, 44 / 56) : grands chiffres.
- **H1** (700, 32 / 40), **H2** (700, 28 / 34), **H3** (700, 24 / 30),
  **H4** (700, 20 / 26).
- **Header** (700, 19 / 22, `0.08px`) : titre d'en-tête de page.
- **Navigation** (600, 18 / 24) : libellés de dock.
- **Title** (600, 17 / 22) : titres de carte et de section.
- **Body 1** (500, 16 / 20) : texte courant.
- **Body 2** (600, 15 / 19) : métadonnées fortes.
- **Caption** (400, 14 / 19, `0.1px`) : dates et précisions.
- **Button** (700, 16 / 24).

**La règle du chiffre tabulaire.** Toute valeur comparable (moyenne, note,
heure, compteur) porte `font-variant-numeric: tabular-nums`.

## Layout

Largeur maximale 700 px, gouttière 16 px, cible 412 × 892 px, minimum testé
360 px. L'accueil espace ses blocs de 12 px ; les autres pages de 12 à 14 px.

La coquille occupe la hauteur utile publiée par le JS (`--app-height`), jamais
une unité de viewport figée. Le dock est une capsule fixe de 72 px, centrée à
24 px des bords au plus, et remonte avec `--keyboard-bottom`. Le `main` réserve
l'empreinte du dock (84 px avec sa marge basse) et 20 px.

L'accueil suit Papillon : en-tête sur papier peint, grille de raccourcis,
widgets (cours, moyenne, devoirs) dans cet ordre. Les écrans de liste sont des
cartes séparées, jamais un registre à filets. Réglages : profil centré, quatre
tuiles teintées, puis sections ancrées.

## Elevation & Depth

`--shadow-card` est une ombre basse (1 px de flou proche, halo diffus très
faible) qui détache les tuiles, les widgets et les contrôles blancs du fond de
page. En sombre elle disparaît : le contraste des surfaces suffit. Le dock
porte `--shadow-dock`, plus marquée, pour flotter au-dessus du contenu. Les
dialogues gardent leur ombre propre.

Le mouvement est court (200 ms, `--ease`) et se limite à l'opacité et au
`transform`, avec une garde unique `prefers-reduced-motion` dans `tokens.css`.

## Shapes

Rayons de 8 px (petites pastilles) à 25 px (widgets et cartes de cours), avec un
usage courant de 20 à 24 px. Les tuiles d'accueil et les réglages sont à
22–23 px, les cartes de devoirs et les lignes de notes à 20 px, les widgets,
les cartes de cours et le héros de notes à 24–25 px. Le dock est une capsule de
`999px` ; les onglets actifs portent une capsule de 21 px. Les avatars et les
pastilles sont à `999px`.

## Components

- **Topbar** : fond de page, 56 px, titre 19 / 700, actions rondes de 42 px.
  À l'accueil, en-tête fixe sur papier peint : avatar pâle, nom blanc 18 / 700,
  sous-titre classe · période à 70 %, chevron, actions en verre blanc. Les
  icônes d'accueil sont blanches.
- **Dock** : capsule flottante de surface, 72 px, largeur maximale 480 px,
  cinq onglets de 58 px, icônes 24 px et libellés 13 px. L'onglet actif porte
  une capsule entière teintée à 14 % de marque, icône et libellé accent.
- **Tuiles d'accueil** : grille 2 colonnes, rayon 22 px, padding 13 × 10 px,
  ombre basse, icône Papicons 32 px à couleur fixe, titre 17 / 600, sous-titre
  16 / 500 secondaire.
- **Widgets d'accueil** : rayon 25 px, fond item, ombre basse, padding 10 px.
  En-tête : icône 24 px à 60 %, titre 17 / 600 à 60 %, bouton « Afficher plus »
  en capsule de 20 px.
- **Moyenne d'accueil** : graphe 40 % × 112 px, corps 14 / 16 / 12 px,
  moyenne 24 / 700 accent, libellé 16 / 600, origine 14 / 400.
- **Cartes de cours** : colonne d'horaires de 60 px, carte 25 px, barre de
  6 px, titre 18 / 700, salle et professeur 16 / 600 avec icônes 20 px,
  durée 20 / 700 à 58 %.
- **Cartes de devoir** : rayon 20 px, padding 14 × 16 px, emoji 22 px, matière
  teintée 16 / 600, date relative 15 secondaire, contenu 17 / 500, actions IA
  en pastilles teintées de 12 px, coche de 24 px ou capsule « Terminé ».
- **Recherche** : capsule `item` pleine largeur, 48 px, icône 22 px à 50 %,
  texte 16 / 600, bouton d'effacement de 34 px, anneau de focus de 2 px.
- **Notes** : contrôles période et calcul en capsules de surface de 48 px,
  recherche dessous, héros teinté à 15 % de marque avec rayon 24 px et graphe
  140 px, moyenne 32 / 700 accent, libellé 17 / 600, origine 16 / 500. Titres
  de section « Nouvelles notes » et « Matières » à 17 / 600 secondaire avec
  icône 20 px. Dernières notes : cartes de 200 px, rayon 24 px, fond matière
  + 8 %, liseré de la teinte, titre 17 / 700, date relative 15. Lignes par
  matière : item, rayon 20 px, titre 17 / 600, date 15, note 20 / 600 +
  dénominateur 15.
- **Tâches** : recherche, puis résumé centré : anneau conique de 34 px et
  phrase 17 / 600 accent (« 2 tâches restantes cette semaine » ou « Toutes les
  tâches sont terminées ! »).
- **Réglages** : tuiles de rayon 23 px, padding 14 px, icône 32 px, fond
  `adjust(couleur, ±0,8)`, titre 17 / 700, description 15 / 500. Lignes de
  liste : item, rayon 20 px, padding 14 × 16 px, icône 24 px, titre 17.
- **Prof** : onglets Discussion / Exercices en capsules de 44 px, actif plein
  accent. Une barre compacte porte la matière (sélecteur de 44 px) et deux
  actions d'icône de 44 px (nouvelle discussion, supprimer), puis les modes en
  capsules de 34 px. L'écran de discussion occupe la hauteur utile : seul le
  fil défile, le compositeur est épinglé au-dessus du dock, et le changement de
  matière d'un fil existant demande confirmation. Le mark du professeur prend
  la teinte de la matière. Erreurs et refus vivent dans le fil, après la
  question ; « Régénérer » et des puces de suivi compactes suivent la dernière
  réponse. Les sources citées ne sont listées qu'une fois : le détail « Ce qui
  est envoyé » donne des comptes, pas les libellés.
- **Assistant** : mark circulaire pâle, réponse en texte pleine largeur
  16 / 26 (15 / 25 sur petit écran), question en bulle compacte à droite
  (rayon 22 px, coin bas droit à 8 px). Dans Aide devoirs, le contexte
  (matière, échéance, sources) reste collé en haut du fil. Sources en pastilles
  de 12 px, actions Copier / Régénérer en texte secondaire de 44 px,
  suggestions en lignes de 52 px bordées, placées après la dernière réponse.
  Un seul badge « non sourcée » par réponse. Compositeur en capsule bordée,
  envoi circulaire plein encre de 38 px. Le statut de réflexion commun est un
  pouls avec temps écoulé. Les métadonnées ne descendent pas sous 12 px. Les
  fiches sont des documents : mark, titre 18 / 700, aperçu sur deux lignes,
  corps markdown mesuré.
- **Suivi du fil** : le journal ne recolle au bas que si l'élève y était déjà ;
  sinon une pastille « Dernière réponse » de 44 px y ramène. Le fil fermé
  d'Aide devoirs reste en mémoire de l'écran : le rouvrir ne relance pas
  d'appel.
- **Boutons** : 44 px, rayon pastille, plein accent. **Champs** : item, rayon
  pastille, focus en anneau.
- **Dialogues** : largeur maximale 440 px, surface opaque, ombre réelle.

## Do's and Don'ts

**Do**

- Copier les métriques Papillon avant d'inventer une variante.
- Teinter les matières avec une encre dérivée de la même couleur.
- Garder les chiffres grands et tabulaires.
- Vérifier les 21 palettes en clair et en sombre.
- Laisser le dock flotter en capsule, détaché du contenu.

**Don't**

- Étirer le dock sur toute la largeur ou le coller aux bords de l'écran.
- Ajouter un filet noir épais autour des cartes.
- Colorer une carte sans dériver l'encre de la même teinte.
- Ajouter une texture ou une image de fond : le papier peint reste généré.
- Utiliser une ombre blanche ou un halo clair en thème sombre.
- Dupliquer une information dans un badge décoratif : le badge porte un état.
