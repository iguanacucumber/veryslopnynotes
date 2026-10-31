# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Interface web servie dans une WebView Android ; la coque native Kotlin tient la
session, le disque et les appels Pronote.

## Users

Élève du secondaire en France, sur son téléphone, en classe et à la maison. Il
ouvre l'app pour savoir ce qui compte aujourd'hui : moyenne, devoirs à rendre,
prochain cours, dernière note. Les comptes liés et le mode démonstration
existent, mais aucun usage parent n'est confirmé.

## Product Purpose

Donner un relevé scolaire complet et lisible sans quitter le téléphone :
notes, emploi du temps, devoirs, vie scolaire, actualités, cantine et fiches de
révision. La réussite est un élève qui trouve l'information en un geste, même
hors ligne, sans douter de sa fraîcheur.

## Positioning

Le seul accès scolaire qui reste entièrement local : la session Pronote, les
données et la clé du modèle vivent sur l'appareil. Le web ne parle qu'au pont
natif, jamais à l'établissement ni à un serveur tiers. Les 21 palettes et les
deux thèmes font partie du produit, pas d'un habillage optionnel.

## Operating Context

Usage quotidien sur un écran de téléphone, souvent à une main, parfois sans
réseau. L'emploi du temps et les devoirs changent en cours de journée ; les
notes arrivent par période. L'élève revient plusieurs fois par jour et attend
la même hiérarchie à chaque visite.

## Capabilities and Constraints

- Routes existantes, contenu et comportements conservés : pas de nouvelle
  fonctionnalité métier dans une refonte visuelle.
- Le web reste sans réseau ; seuls le pont natif, le client OpenRouter et le
  scraper parlent réseau, hors de cette surface.
- 21 palettes, thème clair/sombre/système, Figtree auto-hébergée.
- Cibles tactiles de 48 px, focus visible, contraste AA, mouvement réduit.
- Les alertes de sécurité restent lisibles par lien direct mais n'ont plus
  d'entrée visible (décision utilisateur).
- Le lien d'évitement « Aller au contenu » est retiré à la demande explicite
  de l'utilisateur ; ne pas le réintroduire sans nouvelle demande.

## Brand Commitments

Papillon 8.6.2 (`xyz.getpapillon.app`, installé sur le téléphone de
l'utilisateur) est la référence visuelle liée : fond sombre profond, tuiles
colorées saturées, cartes très arrondies, dock de navigation flottant à cinq
onglets, accents vifs sur les chiffres et les matières. L'app garde son nom,
son contenu et ses palettes ; elle n'emprunte pas le logo ni les actifs Papillon.

## Evidence on Hand

Code, tests et captures de l'app ; captures Papillon prises sur l'appareil
(Pixel 8a). Aucune donnée scolaire réelle ne doit entrer dans le dépôt ou dans
une capture commitée.

## Product Principles

1. Le prochain geste est visible avant le décor.
2. La couleur porte un rôle : matière, état, sélection, chiffre.
3. Une information datée dit toujours sa fraîcheur.
4. La même hiérarchie sur les 21 palettes et les deux thèmes.
5. Le calme vient de l'espace et du contraste, pas de l'absence de couleur.

## Accessibility & Inclusion

Cibles de 48 px, focus clavier visible, contraste AA, respect de
`prefers-reduced-motion`, libellés explicites. Le retrait du lien d'évitement
est une exception assumée, limitée à cette app tactile.
