# QA-MATRIX.md — appareils, WebView et hors-ligne

Preuve de la matrice demandée par #939. Ce fichier est un **relevé**, pas une
promesse : une ligne ne passe à `Réussi` que si un humain a exécuté le cas sur
l'environnement nommé, avec la date et la preuve (log, capture caviardée). Un
test unitaire garde le câblage, jamais le comportement d'un appareil.

Aucun appareil ni émulateur n'est disponible dans l'environnement de rédaction
(2026-11-03) : les lignes matérielles sont donc `Bloqué`, jamais vertes.

## Statuts

| Statut | Sens |
|---|---|
| `Réussi` | Cas exécuté, résultat attendu observé, preuve jointe. |
| `Échec` | Cas exécuté, résultat attendu non observé ; issue ouverte. |
| `Bloqué` | Cas non exécuté : appareil, réseau ou outil absent. Aucune conclusion. |

## Matrice

| ID | Cas | Critère d'acceptation | Statut | Exécution, preuve ou raison du blocage |
|---|---|---|---|---|
| QA-01 | Android 8.0 (API 26) | Installation, premier lancement, appairage QR, accueil et notes lisibles. | `Bloqué` | Aucun appareil API 26 ni image système dans l'environnement. Après `make buildDebugApk` : `adb -s <série> install -r android/app/build/outputs/apk/debug/app-debug.apk`, puis `adb shell getprop ro.build.version.sdk` doit rendre `26`. |
| QA-02 | Android 12 (API 31) | Même parcours que QA-01 ; clavier et retour matériel conformes. | `Bloqué` | Aucun appareil API 31. Même commande avec un appareil `ro.build.version.sdk = 31`. |
| QA-03 | Android 15 (API 35) | Même parcours ; rendu edge-to-edge et insets IME. | `Bloqué` | Aucun appareil API 35. Même commande avec `ro.build.version.sdk = 35`. |
| QA-04 | Android 16 (API 36) | Même parcours ; `targetSdk` 37 et comportement de compatibilité. | `Bloqué` | Aucun appareil API 36. Même commande avec `ro.build.version.sdk = 36`. |
| QA-05 | WebView ancienne | La page se monte sans `visualViewport` ; le champ focalisé reste visible ; pas d'écran blanc. | `Bloqué` | Le repli est couvert par `tests/web/viewport.test.ts` (`viewportMetrics(800, 0, 0)`), mais aucune WebView ancienne réelle n'est installée. Preuve appareil : `adb shell dumpsys webviewupdate`, puis parcours d'appairage au clavier. |
| QA-06 | 2 Go de RAM | Sous pression mémoire, le cache WebView est vidé sans perdre l'état ni l'écran courant. | `Bloqué` | Le câblage `onTrimMemory` → `pause`/`resume` → `clearCache(false)` est gardé par `tests/architecture/webview-lifecycle.test.ts`, pas la pression réelle. Utiliser un émulateur jetable avec `-memory 2048` et `adb shell dumpsys meminfo <package>`. |
| QA-07 | Police 200 % | Texte à 200 % : aucun contrôle coupé, PIN, barre d'onglets et dialogues restent atteignables. | `Bloqué` | Aucun test de rendu à `fontScale = 2`. Sur appareil de test : `adb shell settings put system font_scale 2.0`, relancer l'app, puis remettre `1.0`. |
| QA-08 | Premier lancement hors-ligne | Sans session ni réseau : démarrage, message explicite, aucun écran blanc ni crash. | `Bloqué` | Les états hors-ligne sont testés (`tests/unit/cache-offline.test.ts`, `tests/web/session-gate.test.ts`) mais pas le démarrage Android réel. Sur appareil : `adb shell svc wifi disable`, `adb shell svc data disable`, `adb shell am force-stop <package>`, relancer et lire `adb logcat`. |
| QA-09 | Stockage plein | Une écriture refusée remonte une erreur visible ; ni fichier tronqué ni faux « enregistré ». | `Bloqué` | Les chemins d'échec sont testés (`tests/web/session.test.ts`, `tests/web/teacher.test.ts`, `tests/unit/scraper-jar.test.ts`) mais pas une partition `/data` pleine. À faire **uniquement sur un émulateur jetable** : réduire la partition data, remplir `/data/local/tmp` jusqu'à `ENOSPC`, puis appairer et enregistrer une fiche. |
| QA-10 | Horloge fausse — contrat de fraîcheur | Une entrée datée dans le futur est périmée : jamais de faux « à jour ». | `Réussi` | Automatisé, sans appareil : `bun test tests/contracts/cache.test.ts` (horloge en avance, miroir Kotlin). |
| QA-11 | Horloge de l'appareil modifiée | Après un saut d'horloge, l'app redémarre, affiche le badge périmé et ne conclut pas à la fraîcheur. | `Bloqué` | La règle de contrat passe (QA-10), mais le réglage d'horloge Android n'est pas exercé. Émulateur : désactiver l'heure automatique, avancer/reculer l'horloge, relancer et vérifier le badge. |
| QA-12 | Portail captif | Les requêtes échouent avec le message réseau prévu ; le portail HTML n'est jamais affiché comme donnée scolaire ; aucun identifiant n'est envoyé au portail. | `Bloqué` | Aucun portail captif simulé dans la suite. Procédure : Wi-Fi invité avec portail, ouvrir l'app, vérifier le message d'erreur et `adb logcat` ; aucune donnée Pronote ne doit partir avant appairage. |
| QA-13 | Appairage et repli : zones sûres | Encoche et geste respectés en portrait et paysage ; « Ouvrir la session » et « Connexion démo » restent au-dessus du geste, clavier ouvert ou fermé ; aucun padding inline n'écrase les jetons `--safe-*`. | `Bloqué` | Contrat gardé par `tests/web/pairing-safe-area.test.ts` et captures web simulées (insets + clavier), mais aucun appareil. Sur appareil : ouvrir `#/pairing`, capturer portrait, puis paysage (encoche latérale), puis clavier ouvert après focus du PIN ; refaire sur l'écran de secours. Vérifier que le dernier bouton est au-dessus de la barre de gestes. |

## Couverture automatisée exécutée

Ces tests ne remplacent aucune ligne `Bloqué` : ils prouvent le contrat, le
câblage ou le message, pas le comportement de l'appareil.

| Commande | Ce qui est prouvé | Résultat (2026-11-03) |
|---|---|---|
| `bun test tests/architecture/docs.test.ts` | Cette matrice et ses liens restent complets. | `Réussi` |
| `bun test tests/contracts/cache.test.ts` | Horloge en avance = entrée périmée ; parité Kotlin. | `Réussi` |
| `bun test tests/web/viewport.test.ts` | Repli sans `visualViewport` et champ focalisé visible. | `Réussi` |
| `bun test tests/web/pairing-safe-area.test.ts` | Zones sûres de l'appairage et du repli, geste et clavier compris. | `Réussi` |
| `bun test tests/architecture/webview-lifecycle.test.ts` | Pause/reprise et `clearCache(false)` sous pression mémoire. | `Réussi` |
| `bun test tests/unit/cache-offline.test.ts` | Repli sur cache et échec propre sans cache. | `Réussi` |
| `bun test tests/web/session.test.ts` | Stockage indisponible dit à l'utilisateur. | `Réussi` |
| `make check-fast` | Gate local sans compilation Kotlin ni audit réseau. | `Réussi` |

Session du 2026-11-03 sur un poste Linux : 48 tests docs, 40 tests ciblés
ci-dessus (0 échec), puis `make check-fast` OK — `unit` 934, `architecture`
187, `contracts` 22, `web-test` 578. Aucun de ces chiffres ne vaut un résultat
appareil.

## Manques assumés

- Aucune ferme d'appareils, aucun émulateur Android dans la CI : les versions
  API, la RAM, la police, le stockage plein et le portail captif restent
  manuels.
- Aucune WebView ancienne réelle : seul le repli JavaScript est testé.
- Aucun test de rendu à `fontScale = 2` : le critère reste visuel.
- Le premier lancement hors-ligne et le portail captif demandent un appareil
  ou un émulateur avec réseau contrôlé.
- Un `Réussi` sans date, appareil et preuve ne doit pas être accepté en revue.

## Voir aussi

[`COMPATIBILITY.md`](COMPATIBILITY.md) pour les limites produit et
[`BUILD.md`](architecture/BUILD.md) pour le gate et sa reprise en CI.

## Mise à jour d'une ligne

1. Exécuter la procédure de la ligne sur l'environnement nommé.
2. Joindre la preuve dans la PR ou l'issue (log borné, capture caviardée,
   aucune donnée scolaire).
3. Remplacer `Bloqué` par `Réussi` ou `Échec`, avec la date et la preuve.
4. Un `Échec` ouvre une issue et ne se referme pas par un simple revert de
   cette ligne.
