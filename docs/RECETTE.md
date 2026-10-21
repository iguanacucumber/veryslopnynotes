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
les tests unitaires avec données synthétiques. Aucun test de bout en bout sur un
compte réel n'est exécuté par défaut. C'est la seule limite de ce passage.

## Écran par écran : ce qui reste loin de la référence, et pourquoi

Référence = les démonstrations publiques de Papillon v8.5.5 (`ref-papillon/`),
plus le profil d'écran des issues précédentes (géométrie relevée dans la source
de la référence). « Papillon » = l'application de référence.

| route | écart | raison |
|---|---|---|
| **Accueil** | 4 accès rapides + grille 2×2 ; pas de widget « prochaine note » | l'accueil lit le CACHE, il ne requête pas (#14, #143). Sans cache, une carte dirait « 14,25 » alors que la dernière note peut dater de la semaine. Écart assumé : **donnée absente**, pas choix de design. |
| **Accueil** | la ligne d'état d'un accès rapide est tronquée à 34 caractères (`homeEllipsis`) | une carte de grille 2×2 ne peut pas faire taller ses voisines. Ellipse explicite, jamais une coupure nette. |
| **Cours** | barre du haut « semaine du 05/10/2026 » au lieu du sélecteur de période + pastille de la référence | le sélecteur de période existe, mais il est posé DANS la barre chez nous aussi (`PapHeader`) ; la référence le fait sur une carte flottante au-dessus. Différence de placement assumée (#190). |
| **Cours** | carte de cours : rayon 25, barre d'accent à bout arrondi, nom 18 sp gras | relevés sur `ui/components/Course.tsx` de la v8.5.5 (#194). Pas d'écart. |
| **Notes** | pas de ligne de tranches quand la lecture des périodes échoue sans connexion | les périodes sont lues en direct et ne sont pas mises en cache ; l'absence de connexion reste silencieuse, le sélecteur bascule sur les compteurs du payload (#260). Un énoncé vrai, pas un doublon. |
| **Notes** | le grand nombre est collé au tracé de la courbe | mesuré sur la référence (le `Canvas` déborde sous le corps, `paddingTop: 0`). |
| **Tâches** | « Semaine 41 » + « Devoirs de la semaine », puis la plage `05/10 – 11/10` | le numéro ISO est l'en-tête de la référence ; la plage est dans le navigateur. Deux informations, une seule fois chacune. |
| **Profil** | écran à sections (Compte / Ressources / Réglages / Session) au lieu d'une liste continue | l'en-tête de la référence est un avatar ; les sections servent le survol (« Se déconnecter » doit être atteignable sans défiler, cf. #135). |
| **Profil** | flèche de retour dans la barre, comme les 12 autres routes secondaires | standard : c'est l'appairage qui n'en a pas (ligne suivante). |
| **Appairage** | retour sous forme de `TextButton` dans le corps, pas de flèche dans la barre | au premier lancement l'assistant est la route de départ : une flèche ne pourrait que sortir de l'app. Le retour quitte l'écran — la page unique (#299) n'a plus d'étape à remonter. |
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
| Notes | changer de période : la moyenne de la période précédente reste affichée sous le nouveau sélecteur — et l'ancien rapport reste là si la lecture échoue | le payload est rattaché à sa requête : un changement de requête l'invalide, l'écran montre un chargement (#527) |

## États vérifiés

- **Sombre** (`--theme dark`) : les 14 routes. Aucun fond blanc, aucun texte
  blanc sur blanc, aucune couleur de matière illisible. Le rouge d'erreur passe
  par `errorTextColor()` (le rouge de marque vaut 3.70:1 sur la surface sombre).
- **Très grande police** (`font_scale 1.3`) : les 14 routes. Aucun texte coupé
  net. Les seules troncatures sont les ellipses voulues (ligne d'état des accès
  rapides, libellé de champ `singleLine`) : une troncature annoncée n'est pas
  une coupure.
- **Vide à froid / cache vide** : Notes sans cache → « Notes indisponibles. » +
  état vide (« Aucune note en cache » + « Actualiser ») ; Messages sans cache → « 0
  discussion » ; premier lancement (appareil non appairé) → l'assistant. Aucun
  écran muet, aucun écran d'erreur plein-écran pour l'absence de connexion (#260).
- **Hors ligne** (mode avion) : l'accueil garde ses widgets en cache,
  chaque écran sans cache montre son état vide neutre + « Actualiser ».
  Aucun écran n'affiche un vide trompeur — ni un « Hors-ligne, … » plein-écran.
  Seule exception : les alertes distinguent « Aucune alerte de sécurité »
  (filtre passé, rien signalé) de « Aucune analyse disponible » (rien en
  cache). Le filtre est une HEURISTIQUE : l'écran le dit, jamais « vérifié »
  (#415).

## Comment rejouer

```sh
make shot ROUTE=<route> SHOT_ARGS="--theme light"   # ou dark
adb shell settings put system font_scale 1.3        # très grande police
adb shell cmd connectivity airplane-mode enable    # hors ligne
```

## Palettes (#335)

Réglages → Apparence : 20 palettes, chacune avec sa variante claire et sombre ;
le mode (Système/Clair/Sombre) choisit la variante. Le choix vit dans la
WebView (`localStorage`), il n'est pas envoyé au natif.

- Contrôle statique : `bun test tests/web/schemes.test.ts` (contraste ≥ 4.5:1
  encre/accent/erreur/boutons pleins, ≥ 3:1 pour le texte secondaire, pas de
  dérive avec le repli `tokens.css`).
- Contrôle visuel : régler le thème sur chaque mode et rejouer `index`,
  `grades`, `settings`, `pairing` — aucun texte illisible, aucune surface qui
  garde la couleur d'une autre palette.

## Mouvement (#336)

- Contrôle statique : `bun test tests/web/motion.test.ts` (décision d'animer,
  repli sans API, garde unique de mouvement réduit, propriétés animées).
- Contrôle visuel : toucher un onglet (l'indicateur glisse, la page se fond),
  puis Régler le système sur « supprimer les animations » et vérifier que rien
  ne bouge plus — la navigation reste immédiate.

## Visuel (#337)

- Contrôle statique : `bun test tests/web/grades.test.ts` (ligne de moyenne de
  la courbe dans l'échelle du tracé) et `bun run check`.
- Contrôle visuel, clair **et** sombre : accueil (héros, icônes de widgets),
  notes (courbe + ligne de moyenne), emploi du temps (repère « maintenant »
  posé avant le cours en cours), sanctions (état vide), réglages (anneau de
  focus au clavier). Vérifier qu'aucune surface n'emprunte la couleur d'une
  autre palette et que la barre d'onglets garde une ombre visible.

`make check` (dont `android-compile`) passe, et c'est le seul filet qui
compile réellement le Kotlin : les miroirs TS et `check-kotlin` ne voient pas
une résolution de symbole ni une surcharge ambiguë.
