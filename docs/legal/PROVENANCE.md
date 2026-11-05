# Provenance Papillon — inventaire et attribution

Statut : **inventaire factuel, revue juridique requise avant toute release
publique**. Ce document décrit ce que le dépôt reprend de Papillon, avec la
preuve disponible ; il ne vaut pas avis juridique.

Décision de référence : [ADR-008](../adr/008-relicense-gpl.md). L'application
est distribuée sous **GPL-3.0-only** ; les fichiers dérivés de Papillon restent
sous GPL-3.0 et sont crédités, jamais blanchis.

## Référence amont

| Élément | Valeur | Preuve |
|---|---|---|
| Projet | Papillon, `PapillonApp/Papillon` | <https://github.com/PapillonApp/Papillon> |
| Version de référence finale | **8.6.2** | [`DESIGN.md`](../../DESIGN.md) ; issue #757 ; tag amont `8.6.2` |
| Version antérieure des jetons | **8.5.5** | issues #188 et #190 ; jetons « relevés sur la v8.5.5 » |
| Licence amont | GPL-3.0 (texte GPLv3) | `LICENSE` du dépôt Papillon |
| Tag amont `8.6.2` | commit `ab8ffd32d5a58a4b17ebb2705efb35684b1fb1ed` | vérifié sur le dépôt amont ; ce n'est pas la preuve du checkout exact utilisé ici |
| Chemins amont cités par le dépôt | `utils/grades/algorithms/{subject,weighted,median,time}`, `useGradeInfluence`, `ui/new/Typography.tsx` (v8.5.5), `ui/components/Typography.tsx` (v8.6.2), composants `List`, `CompactGrade`, `Averages`, `WeekEventBlock`, `Course` | messages de commit `8ce488e`, `4cb91a7`, `d7d0b6c`, `f92c926`, `ae6266f` ; commentaires dans le code |

Le dépôt ne consigne pas le commit exact du checkout Papillon utilisé pour
chaque port. La version 8.6.2 est la référence documentée et vérifiée ; les
ports antérieurs (moyennes, thème) peuvent provenir d'une révision plus ancienne.
Voir [U1](#points-non-résolus).

### Statut des preuves

- **Porté** : la correspondance avec un fichier ou un algorithme amont est
  documentée par un message de commit ou un commentaire de source.
- **Adapté** : la reproduction visuelle ou la forme d'API est documentée, sans
  preuve d'une copie ligne à ligne.
- **Unresolved — do not claim clean-room** : l'origine exacte n'est pas établie.
  Le fichier est traité comme dérivé et crédité, conformément à ADR-008 §4.

## Code porté

| Fichier | Ce qui est repris | Source et preuve | Licence |
|---|---|---|---|
| `android/core/src/main/java/fr/veryslopnynotes/core/Averages.kt` | Algèbres `subject`, `weighted`, `median` ; bonus, notes facultatives, coefficient 0 ; historique, influences, `subjectKey`, arrondi à deux décimales, sentinelle `-1`. | Portage TS `server/domain/averages.ts` dans `8ce488e` : « portage fidèle de papillon.bzh `utils/grades/algorithms/{subject,weighted,median,time}` + `useGradeInfluence` ». Port Kotlin dans `4cb91a7`. Commentaires Papillon aux lignes 8, 51, 122, 141 et 164. | GPL-3.0-only (dérivé Papillon GPL-3.0) |
| `web/src/features/grades/model.ts` | Mêmes algèbres, regroupement par matière, recherche « Papillon », historique et influences. | Port de l'écran Notes dans `78887ca` ; mêmes constantes `NO_DATA = -1` et `MAX_AVERAGE_POINTS = 200` ; commentaires aux lignes 159 et 533. | GPL-3.0-only (dérivé Papillon GPL-3.0) |
| `web/src/features/home/parse.ts` | Miroir du calcul de moyenne d'`Averages.kt` pour le widget d'accueil (`addWeighted`). | Commentaire « Miroir d'`Averages.kt` » ; correctif `0fe1c50`. | GPL-3.0-only (dérivé Papillon GPL-3.0) |
| `shared/contracts/models/averages.ts` | Forme d'API du rapport de moyennes : algorithmes, moyenne générale, matières, historique, influences. | Commentaire « défaut Papillon » ligne 9 ; contrat ajouté avec le portage `8ce488e`. | GPL-3.0-only (forme dérivée) |
| `shared/contracts/models/core.ts` | Champs `Grade` repris pour Papillon : `bonus`, `optional`, moyennes de classe, période, libellé, enseignant ; `Period`. | `Averages.kt` ligne 25 : « tous les champs Papillon compris ». Aucun chemin amont consigné. | GPL-3.0-only (forme dérivée) |

## Interface web

La reproduction visuelle est documentée par `DESIGN.md`, les issues #188, #190,
#757 et les commits `37b4ab4`, `d72d4d6`, `57b2b48`, `3a5b22b`, `d7d0b6c`,
`f92c926`, `ae6266f`, `df88811`. Les valeurs et les dimensions citées dans les
commentaires viennent de Papillon 8.5.5 puis 8.6.2.

| Fichier | Ce qui est repris | Source et preuve | Licence |
|---|---|---|---|
| `web/src/styles/tokens.css` | Échelle typographique, palette, rayons, ombres, hauteur du dock, accents fixes du papier peint. | Commentaire ligne 179 : `Papillon ui/components/Typography.tsx` ; valeurs relevées sur la v8.5.5 (#188), puis alignées sur 8.6.2 (`ae6266f`). | GPL-3.0-only (adapté Papillon GPL-3.0) |
| `web/src/styles/app.css` | Coquille, en-tête de 56 px, dock flottant, papier peint d'accueil, recherche, barre de semaine. | Commentaires Papillon lignes 80, 178, 315, 337, 812, 1023 ; commits `3a5b22b`, `d7d0b6c`, `f92c926`, `ae6266f`. | GPL-3.0-only (adapté Papillon GPL-3.0) |
| `web/src/ui/AppShell.tsx` | En-tête nommé par son contenu (date pour le calendrier), coquille et dock. | Commentaire ligne 94 ; commits `d7d0b6c`, `f92c926`, `ae6266f`. | GPL-3.0-only (adapté Papillon GPL-3.0) |
| `web/src/ui/components.tsx` | Barre de recherche en capsule, cartes, sections, primitives visuelles. | Commentaire ligne 32 ; commits `d7d0b6c`, `f92c926`, `ae6266f`. | GPL-3.0-only (adapté Papillon GPL-3.0) |
| `web/src/ui/HomeWallpaper.tsx` | Papier peint généré (« mesh ») de l'accueil, taches floutées et accents fixes. | Commentaire ligne 3 ; ajouté par `ae6266f`. | GPL-3.0-only (adapté Papillon GPL-3.0) |
| `web/src/features/home/HomeScreen.tsx` et `web/src/features/home/home.css` | Accueil sans héros, identité et sous-titre, tuiles de raccourcis à couleur fixe, widgets cours / moyenne / devoirs, carte de widget à 25 px. | Commits `d7d0b6c`, `f92c926`, `ae6266f` ; commentaires `tasks.css`/`home.css` et `DESIGN.md`. | GPL-3.0-only (adapté Papillon GPL-3.0) |
| `web/src/features/grades/components.tsx` et `web/src/features/grades/grades.css` | Barre période / calcul, carte moyenne à 140 px, graphe sans aire ni grille, liste des matières. | Commits `f92c926`, `ae6266f` ; métriques de l'issue #190 ; commentaires `grades.css`. | GPL-3.0-only (adapté Papillon GPL-3.0) |
| `web/src/features/tasks/TasksScreen.tsx`, `TasksSummary.tsx` et `tasks.css` | Résumé d'avancement en anneau, carte de tâche à 20 px, pastille « magic », avatar emoji et complétion en pied. | Commits `f92c926`, `ae6266f` ; commentaires `tasks.css` ; message de `d7d0b6c`. | GPL-3.0-only (adapté Papillon GPL-3.0) |
| `web/src/features/timetable/TimetableScreen.tsx` et `timetable.css` | Bandeau cours en cours / prochain, carte de cours à 25 px, ligne `Course` à 60 px d'horaires. | Commits `f92c926`, `ae6266f` ; commentaires `timetable.css`. | GPL-3.0-only (adapté Papillon GPL-3.0) |
| `web/src/features/settings/SettingsScreen.tsx` et `settings.css` | Profil centré, sections et tuiles de réglages. | Commits `d7d0b6c`, `f92c926` ; message de `d7d0b6c`. | GPL-3.0-only (adapté Papillon GPL-3.0) |
| `web/src/features/pairing/PairingScreen.tsx` | Alignement visuel mineur de la coquille. | `f92c926`. | GPL-3.0-only (adaptation mineure) |
| `web/src/features/messages/MessagesScreen.tsx` | Alignement visuel mineur de la coquille. | `df88811`. | GPL-3.0-only (adaptation mineure) |
| `web/src/features/profile/ProfileScreen.tsx` | Alignement visuel mineur de la coquille. | `df88811`. | GPL-3.0-only (adaptation mineure) |
| `web/src/features/attendance/SchoolLifeScreens.tsx` | Alignement visuel mineur des cartes de vie scolaire. | `df88811`. | GPL-3.0-only (adaptation mineure) |
| `web/src/features/revisions/RevisionSheets.tsx` | Alignement visuel mineur de l'en-tête et des cartes. | `df88811`. | GPL-3.0-only (adaptation mineure) |
| `web/src/routes/canteen.tsx`, `web/src/routes/grades.tsx`, `web/src/routes/news.tsx` | Enveloppes de route alignées sur la coquille. | `3a5b22b`, `df88811`. | GPL-3.0-only (adaptation mineure) |
| `web/src/lib/format.ts` | Distance longue « il y a 27 jours », « dans 2 heures ». | Commentaire ligne 153 ; `f92c926`. | GPL-3.0-only (adapté Papillon GPL-3.0) |
| `web/src/lib/schemes.data.ts` | Palette par défaut et accents de la marque. | `f92c926`, `ae6266f`. | GPL-3.0-only (adaptation mineure) |
| `web/src/lib/subjectVisual.ts` | Emoji et palette dérivée de la couleur de matière. | `df88811`. | GPL-3.0-only (adapté Papillon GPL-3.0) |
| `web/src/features/teacher/teacher.css` | Coquille Papillon autour du fil ; la surface de conversation reste distincte. | Commentaire ligne 3. | GPL-3.0-only (adaptation mineure) |

Les écrans et cartes non listés (`assistant`, `course-notes`, `help`,
`revisions`, `teacher`, cartes de réglages, routes secondaires) ne portent pas de
code Papillon identifié. Ils composent les primitives ci-dessus et héritent donc
du rendu dérivé ; ils ne doivent pas être présentés comme clean-room sans une
revue séparée.

`web/src/styles/ai.css` est explicitement une surface distincte des cartes
Papillon ; `liquid-glass.css` et `frutiger-aero.css` sont des couches visuelles
propres au dépôt. Ils ne sont pas inventoriés comme dérivés Papillon.

## Contrats et modèles de forme

| Fichier | Ce qui est repris | Source et preuve | Licence |
|---|---|---|---|
| `android/core/src/main/java/fr/veryslopnynotes/core/Attendance.kt` | Modèle unique absence / retard (`kind`), validation et bornes. | Commentaire « parité Papillon : un seul modèle » ; porté depuis `server/domain/attendance.ts` dans `4cb91a7`, sans chemin amont dans `bf11fdd`. | GPL-3.0-only ; **unresolved — do not claim clean-room** (U3) |
| `shared/contracts/models/attendance.ts` | Même forme d'absence / retard et compteurs par période. | Miroir du contrat Kotlin ; aucune source Papillon directe consignée. | GPL-3.0-only ; **unresolved — do not claim clean-room** (U3) |
| `android/data/src/main/java/fr/veryslopnynotes/data/SubjectPrefs.kt` | Préférences matière : couleur `#RRGGBB`, emoji, libellé, fusion. | Commentaire « parité Papillon » ; introduit par `4482750`, sans chemin amont. | GPL-3.0-only ; **unresolved — do not claim clean-room** (U3) |
| `shared/contracts/models/subject-prefs.ts` | Même forme de préférences matière. | Miroir du contrat Kotlin ; aucune source Papillon directe consignée. | GPL-3.0-only ; **unresolved — do not claim clean-room** (U3) |
| `web/src/features/tasks/assignments.ts` | Logique d'écran Tâches portée de `AssignmentsSections.kt` et `AssignmentsRepository.kt` ; la part visuelle Papillon n'est pas isolée. | En-tête du fichier ; `AssignmentsSections.kt` était l'écran Compose aligné sur Papillon, supprimé avec `android/ui/` par `94b974c`. | GPL-3.0-only ; **unresolved — do not claim clean-room** (U4) |

## Assets tiers distincts

Ces éléments ne sont **pas** du code applicatif Papillon. Ils gardent leur
licence et leur notice propres ; l'application les distribue avec le texte
correspondant. Voir [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md).

| Fichier / module | Ce qui est repris | Source et preuve | Licence |
|---|---|---|---|
| `android/pronote/` (tout le module Kotlin) | Port Kotlin du client Pronote TypeScript `pronotets` : crypto, communication, HTTP, resolver, client, modèles et lectures. | README et `docs/COMPATIBILITY.md` ; commits `1f53b7e`, `f0bc42f`, `6940b3b` ; `package.json` déclare `pronotets` `1.0.0`. | MIT — Copyright (c) 2026 Pyronixus ; notice `web/public/licenses/PRONOTETS-MIT.txt` |
| `web/src/ui/icons.tsx` et `web/public/licenses/PAPICONS-MIT.txt` | Icônes Papicons 0.2.3, vendorisées ; le fichier contient aussi des icônes propres au dépôt. | En-tête d'`icons.tsx` : « Icônes Papicons 0.2.3 (MIT, Association Papillon) ». | MIT pour Papicons — Copyright (c) 2025 Association Papillon ; ajouts du dépôt sous GPL-3.0-only |
| `web/src/fonts/SNPro-*.woff2` et `web/public/licenses/SN-PRO-OFL.txt` | Cinq graisses SN Pro sous-ensemblées en WOFF2. | `tokens.css` ; notice OFL ; sources `supernotes/sn-pro`. | OFL-1.1 — Copyright 2024 The SN Pro Project Authors |
| `web/public/licenses/PRONOTETS-MIT.txt`, `PAPICONS-MIT.txt`, `SN-PRO-OFL.txt` | Textes de licence distribués avec l'APK. | `tests/architecture/licenses.test.ts` vérifie leur présence et leur contenu. | Textes canoniques, non modifiés |

`pronotets` reste la référence de parité du protocole ; son port Kotlin est
distribué dans l'app sous GPL-3.0-only, avec la notice MIT conservée. Papicons
est édité par l'Association Papillon mais distribué sous MIT : ce n'est pas une
partie GPL de l'application Papillon.

## Identité visuelle

L'identité courante est propre au dépôt : `e9b7bde` (#843) a remplacé l'icône
et la marque de barre par une page de notes et une coche, avec le vert de marque
`#1c6653`. Aucun fichier courant de `android/app/src/main/res/` ne cite Papillon.

L'ancienne icône de `e960359` / PR #1112 reprenait une silhouette de papillon et
le teal `#008673`. Elle a été remplacée, mais reste dans l'historique Git :

| Fichier historique | Ce qui était repris | Source et preuve | Licence |
|---|---|---|---|
| `android/app/src/main/res/drawable/ic_launcher_foreground.xml`, `ic_launcher_monochrome.xml`, `ic_launcher_splash.xml`, `mipmap-*/ic_launcher.png`, `values/colors.xml` (avant `e9b7bde`), `android/artwork/ic_launcher_512.png` (avant `e9b7bde`) | Silhouette de papillon et teal `#008673` pour l'icône et le splash. | `e960359` / PR #1112 : tracés et PNG « produits localement » ; `colors.xml` disait « Teal de l'icône Papillon déjà publiée ». Aucun fichier source Papillon ni licence d'asset n'est consigné. | GPL-3.0-only pour les fichiers du dépôt ; **unresolved — do not claim clean-room** pour l'origine de l'ancienne identité (U2) |

PR #1112 affirme « aucune dépendance ni asset tiers ajouté ». C'est vrai pour
les fichiers ajoutés, mais ce n'est pas une preuve d'indépendance de la
silhouette ou du teal. Le remplacement par `e9b7bde` ferme le risque courant ;
l'origine de l'ancien motif reste à trancher pour l'historique.

## Documentation

| Fichier | Ce qui est repris | Source et preuve | Licence |
|---|---|---|---|
| `DESIGN.md` | Décrit la référence de mise en page Papillon 8.6.2, les jetons, les écrans et les règles de composition. | En-tête et section Overview ; commits `d7d0b6c`, `f92c926`, `ae6266f`. `e9b7bde` (#843) a retiré le langage de copie et l'identité empruntée ; le crédit GPL reste. | GPL-3.0-only |
| `docs/PRODUCT.md` | Écrans et parcours ; ne contient plus de référence Papillon après #843. | Ancienne version `d7d0b6c` ; état courant sans revendication d'identité Papillon. | GPL-3.0-only |

## Fichiers historiques retirés

Les fichiers suivants ne sont plus dans l'arbre courant mais restent dans
l'historique Git, donc dans la distribution source. Ils sont traités comme
dérivés Papillon :

- `server/domain/averages.ts` : portage initial des algorithmes Papillon,
  supprimé avec la pile serveur morte (`964786c`). Ancêtre de `Averages.kt`, de
  `web/src/features/grades/model.ts` et de `home/parse.ts`.
- `android/ui/**` : ancienne interface Compose complète, dont `PapillonTheme.kt`,
  `PapillonIcons.kt`, `PapComponents.kt`, `TimetableCourseCard.kt`,
  `GradesHero.kt`, `HomeWidgets.kt`, etc., supprimée par `94b974c` au profit de
  l'interface React. Le thème et les glyphes étaient explicitement relevés sur
  Papillon v8.5.5 (`37b4ab4`, `57b2b48`, `d72d4d6`).
- `android/ui/src/main/res/font/figtree_subset.ttf` et sa notice OFL, remplacés
  par SN Pro côté web.

Ces chemins ne sont pas des fichiers courants : ne pas les citer comme preuve
d'un état actuel. Ils comptent pour l'attribution et pour la Source
Correspondante de l'historique.

## Points non résolus

Chaque point ci-dessous est marqué **unresolved — do not claim clean-room** et
reste traité comme dérivé jusqu'à preuve contraire. Les questions sont exactes,
pour qu'une personne puisse y répondre sans relire tout l'historique.

| ID | Fichiers concernés | Question exacte | Traitement actuel |
|---|---|---|---|
| U1 | Tous les ports Papillon | Quel commit ou quelle branche exacte de Papillon a servi à chaque port ? Les commits `8ce488e` et `4cb91a7` citent des chemins, pas un SHA. | Version 8.6.2 documentée ; checkout exact non consigné |
| U2 | Ancienne icône et ancien splash Android (`e960359`) | La silhouette de papillon et le teal `#008673` étaient-ils une création indépendante ou une reprise de l'identité Papillon ? PR #1112 dit « produits localement » ; l'ancien `colors.xml` dit « Teal de l'icône Papillon déjà publiée ». L'icône courante a été remplacée par `e9b7bde`. | **unresolved — do not claim clean-room** pour l'historique ; risque courant fermé par #843 |
| U3 | `Attendance.kt`, `SubjectPrefs.kt`, contrats `attendance.ts` / `subject-prefs.ts` | Les commentaires « parité Papillon » désignent-ils un port de code, ou seulement une compatibilité de forme avec les données Pronote ? | **unresolved — do not claim clean-room** |
| U4 | `web/src/features/tasks/assignments.ts` | Le port depuis `AssignmentsSections.kt` / `AssignmentsRepository.kt` inclut-il des choix visuels Papillon, ou seulement la logique de regroupement ? | **unresolved — do not claim clean-room** |
| U5 | `android/ui/**` historique | Quel commit ou quelle version Papillon a servi aux composants Compose supprimés (`PapillonTheme`, `PapillonIcons`, etc.) ? | **unresolved — do not claim clean-room** |
| U6 | Tous les fichiers visuels | Pour chaque écran, la source est-elle une capture ou une démo publique, ou le code source Papillon ? Seul `tokens.css` cite un fichier source ; `agents/runtime/papillon-ref.sh` utilise les démos publiques de `papillon.bzh`. | **unresolved — do not claim clean-room** |

## Revendications clean-room

Aucun fichier courant ne revendique un développement clean-room. La recherche
`rg -i "clean[ -]?room"` ne trouve que les alternatives rejetées d'ADR-008. La
mention de PR #1112 (« aucune dépendance ni asset tiers ajouté ») ne prouve pas
l'origine indépendante de l'icône : elle est classée U2.

Conformément à ADR-008 §4, tant que des points U1–U6 restent non résolus, un
fichier qui ressemble à un portage est traité comme dérivé et crédité. Ces points
ne doivent pas être utilisés pour affirmer que le dépôt est clean-room.

## Attribution

- **Papillon** — application de vie scolaire, Association Papillon et
  contributeurs, GPL-3.0. Source : <https://github.com/PapillonApp/Papillon>,
  version de référence 8.6.2, tag `8.6.2`. Les fichiers dérivés listés ci-dessus
  restent sous GPL-3.0 et sont distribués avec l'application sous
  GPL-3.0-only. Aucune affiliation ni endorsement n'est revendiqué.
- **pronotets** — Pyronixus, MIT, version 1.0.0. Source :
  <https://www.npmjs.com/package/pronotets>. Notice :
  [`web/public/licenses/PRONOTETS-MIT.txt`](../../web/public/licenses/PRONOTETS-MIT.txt).
- **Papicons** — Association Papillon, MIT, version 0.2.3. Notice :
  [`web/public/licenses/PAPICONS-MIT.txt`](../../web/public/licenses/PAPICONS-MIT.txt).
- **SN Pro** — The SN Pro Project Authors, OFL-1.1. Source :
  <https://github.com/supernotes/sn-pro>. Notice :
  [`web/public/licenses/SN-PRO-OFL.txt`](../../web/public/licenses/SN-PRO-OFL.txt).

Les obligations de distribution, de Source Correspondante et d'offre de source
sont décrites dans [ADR-008](../adr/008-relicense-gpl.md) et
[`docs/RELEASE.md`](../RELEASE.md). Les notices tierces complètes restent dans
[`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md).

## Vérifier cet inventaire

```bash
# Occurrences Papillon dans le code et la documentation.
rg -n -i "papillon|parité" android/core android/data android/app web/src shared/contracts DESIGN.md docs/PRODUCT.md

# Chaîne de portage des moyennes.
git show --format=fuller --no-patch 8ce488e
git show --format=fuller --no-patch 4cb91a7
git show --stat --oneline 78887ca

# Reproduction visuelle et thème.
git show --stat --oneline 37b4ab4 d72d4d6 57b2b48 d7d0b6c f92c926 ae6266f df88811
git show --stat --oneline e9b7bde

# Historique retiré.
git show --stat --oneline 94b974c
git log --diff-filter=D --format='%h %s' -- server/domain/averages.ts
```

## Références

- [ADR-008 — relicence GPL-3.0-only et distribution](../adr/008-relicense-gpl.md)
- [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md)
- [`DESIGN.md`](../../DESIGN.md)
- [`docs/RELEASE.md`](../RELEASE.md)
- [Papillon — dépôt amont](https://github.com/PapillonApp/Papillon)
- [Papillon 8.6.2 — release amont](https://github.com/PapillonApp/Papillon/releases/tag/8.6.2)
