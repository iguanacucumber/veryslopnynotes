# RECETTE.md — passage en revue des écrans (#148)

Recette **des 14 routes ensemble**, pas écran par écran : les défauts ci-dessous
n'étaient visibles qu'en comparant deux écrans, deux thèmes ou deux états du
même écran.

## Comment les captures sont faites

Rien n'est joué au doigt : `make shot ROUTE=<route> SHOT_ARGS="--theme <clair|sombre>"`
construit l'APK, ouvre `veryslopnynotes://<route>` et **vérifie** l'écran arrivé
(titre + témoin propre à la route, cf. `ROUTE_WITNESSES` de `agents/runtime/shot.sh`).
Une capture qui n'atteint pas sa route est un échec, pas une image.

Appareil de recette : Android 15, 1080 × 2400, `font_scale` 0.85.

Les captures **ne sont pas versionnées** (`/shots/` est dans `.gitignore`, #133 :
un écran d'accueil affiche le vrai nom d'un élève et les notes de son
téléphone). Ce qui est versionné, c'est ce document et les tests qui
verrouillent les défauts trouvés ; les images se rejouent avec `make shot`.

| jeu | où | quoi |
|---|---|---|
| clair / sombre | `shots/<date>/<route>.{light,dark}.png` | les 14 routes, 28 captures |
| très grande police | `shots/<date>/police-1.3/` | `font_scale = 1.3` (pas le pas d'accessibilité, le maximum du système) |
| hors ligne (mode avion) | `shots/<date>/etat-avion/` | `cmd connectivity airplane-mode enable` |
| cache vide à froid | `shots/<date>/etat-cache-vide/` | cache des notes retiré de l'appareil, puis remis |
| premier lancement | `shots/<date>/pairing.light.png` | appareil sans session : l'assistant EST la route de départ |

## Limite de la recette, dite d'avance

L'appareil n'a **aucun serveur joignable** (`base_url` pointe sur l'émulateur,
et l'appairage exige le QR de l'établissement, qui n'est pas dans le dépôt).
Toutes les captures sont donc l'état **hors ligne** ; seul l'onglet Notes a un
cache (notes, moyennes, carrousel). Les états « établissement qui publie
beaucoup » ne sont pas rejouables ici : ils sont couverts par
`tests/e2e/*` (données de fixture) et par les captures des issues #188-#194,
prises sur un appareil appairé. C'est la seule limite de ce passage.

## Écran par écran : ce qui reste loin de la référence, et pourquoi

Référence = les démonstrations publiques de Papillon v8.5.5 (`ref-papillon/`),
plus le profil d'écran des issues précédentes (géométrie relevée dans la source
de la référence). « Papillon » = l'application de référence, pas l'our.

| route | écart | raison |
|---|---|---|
| **Accueil** | 4 accès rapides + grille 2×2 ; pas de widget « prochaine note » | l'accueil lit le CACHE, il ne requête pas (#14, #143). Sans cache, une carte dirait « 14,25 » alors que la dernière note peut dater de la semaine. Écart assumé : **donnée absente**, pas choix de design. |
| **Accueil** | bandeau « Données hors-ligne » posé sur le `primaryContainer` (donc vert) avec un triangle d'avertissement | le vert est la couleur de marque de la référence ; le libellé et le triangle portent le sens. Un aplat d'avertissement serait un 5e jeton de couleur absent du thème. |
| **Accueil** | la ligne d'état d'un accès rapide est tronquée à 34 caractères (`homeEllipsis`) | une carte de grille 2×2 ne peut pas faire taller ses voisines. Ellipse explicite, jamais une coupure nette. |
| **Cours** | barre du haut « semaine du 05/10/2026 » au lieu du sélecteur de période + pastille de la référence | le sélecteur de période existe, mais il est posé DANS la barre chez nous aussi (`PapHeader`) ; la référence le fait sur une carte flottante au-dessus. Différence de placement assumée (#190). |
| **Cours** | carte de cours : rayon 25, barre d'accent à bout arrondi, nom 18 sp gras | relevés sur `ui/components/Course.tsx` de la v8.5.5 (#194). Pas d'écart. |
| **Notes** | bandeau hors-ligne + ligne « Hors-ligne, tranches indisponibles. » | deux faits distincts : le sélecteur de période est hors cache (`/v1/periods` n'est pas cachable), les notes viennent du cache périmé. Deux énoncés vrais, pas un doublon. |
| **Notes** | le grand nombre est collé au tracé de la courbe | mesuré sur la référence (le `Canvas` déborde sous le corps, `paddingTop: 0`). |
| **Tâches** | « Semaine 41 » + « Devoirs de la semaine », puis la plage `05/10 – 11/10` | le numéro ISO est l'en-tête de la référence ; la plage est dans le navigateur. Deux informations, une seule fois chacune. |
| **Profil** | écran à sections (Compte / Ressources / Réglages / Session) au lieu d'une liste continue | l'en-tête de la référence est un avatar ; les sections servent le survol (« Se déconnecter » doit être atteignable sans défiler, cf. #135). |
| **Profil** | flèche de retour dans la barre, comme les 12 autres routes secondaires | standard : c'est l'appairage qui n'en a pas (ligne suivante). |
| **Appairage** | retour sous forme de `TextButton` dans le corps, pas de flèche dans la barre | au premier lancement l'assistant EST la route de départ : une flèche ne pourrait que sortir de l'app. Le geste reste là (étapes 2 et 3 remontent d'un cran, #172). |
| **Appairage** | assistant en 3 étapes écrites | contrainte Material : la référence fait le QR en une page. Notre étape 1 (adresse du serveur) n'existe pas chez elle parce qu'elle est servie par son propre serveur. |
| **Messages** | « 0 discussion » et la barre de recherche avant l'état d'erreur | le compteur et la recherche sont du chrome d'écran, pas des filtres de contenu ; les retirer au vide ferait perdre le point d'entrée « Nouvelle ». Écart assumé, contrairement à `Tâches` où les filtres ne filtrent RIENT (#148). |
| **Cantine / Vie scolaire / Sanctions / Actualités / Fiches révision / Alertes sécurité** | ligne de titre fixe au-dessus de l'état (« Menus de la semaine », « Absences indisponibles. »…) | ces lignes ont été ajoutées en #172/#178 pour que la capture hors ligne PROUVE la route (le titre de la barre d'onglets se lit partout, « Réessayer » est partagé par sept écrans). Elles nomment ce que l'écran cherche, jamais la donnée. |

## Ce que la recette a corrigé

| écran | défaut (visible sur la capture) | correctif |
|---|---|---|
| Profil | « Hors-ligne, profil indisponible. » + « Réessayer », puis « Aucune information publiée pour ce compte. » — deux affirmations opposées, dont une inventée : la lecture ayant échoué, on ne sait pas si l'établissement publie quelque chose | l'état vide ne s'affiche plus quand la lecture a échoué (`readFailed`) |
| Profil / Réglages | « 0 compte appairé » au Profil, « 1 compte » aux Réglages — même appareil, même session, deux nombres. `account_ids` n'est écrit que sur `/v1/me`, donc jamais hors ligne | `AccountStore.count()` a un plancher : la session prouvée (`TokenStore.isPaired()`) vaut un compte. Réglages lit le nombre, plus « 1 » écrit en dur |
| Alertes sécurité | « Hors-ligne, aucune donnée en cache. » affiché deux fois (ligne rouge + grand bloc d'erreur) | la ligne de cause ne se rend plus quand l'écran EST l'état d'erreur |
| Tâches | « Rechercher un devoir » + puces matière au-dessus de « Hors-ligne, aucune donnée en cache. » — des contrôles qui ne filtrent rien, au-dessus d'un vide | les deux contrôles ne sortent qu'avec une liste |
| Appairage | « Retour » en bouton VERT REMPLI, à côté de « Continuer » : deux actions principales, donc aucune | `TextButton` (l'encre dit « secondaire ») |
| Appairage | « Étape 1/3 — ton serveur » suivi d'un titre « Serveur » : le même mot deux fois dans la même colonne | le titre de l'étape suffit (c'est lui le `heading()` du survol) |

## États vérifiés

- **Sombre** (`--theme dark`) : les 14 routes. Aucun fond blanc, aucun texte
  blanc sur blanc, aucune couleur de matière illisible. Le rouge d'erreur passe
  par `errorTextColor()` (le rouge de marque vaut 3.70:1 sur la surface sombre).
- **Très grande police** (`font_scale 1.3`) : les 14 routes. Aucun texte coupé
  net. Les seules troncatures sont les ellipses voulues (ligne d'état des accès
  rapides, libellé de champ `singleLine`) : une troncature annoncée n'est pas
  une coupure.
- **Vide à froid / cache vide** : Notes sans cache → « Notes indisponibles. » +
  « Hors-ligne, aucune donnée en cache. » ; Messages sans cache → « 0
  discussion » ; premier lancement (appareil non appairé) → l'assistant. Aucun
  écran muet.
- **Hors ligne** (mode avion) : l'accueil garde son bandeau « Données
  hors-ligne · mis à jour hier 15:54 », chaque écran sans cache dit
  « Hors-ligne, aucune donnée en cache. ». Aucun écran n'affiche un vide
  trompeur.

## Comment rejouer

```sh
make shot ROUTE=<route> SHOT_ARGS="--theme light"   # ou dark
adb shell settings put system font_scale 1.3        # très grande police
adb shell cmd connectivity airplane-mode enable    # hors ligne
```

`make check` (dont `android-compile`) passe, et c'est le seul filet qui
compile réellement le Kotlin : les miroirs TS et `check-kotlin` ne voient pas
une résolution de symbole ni une surcharge ambiguë.
