# ACCESSIBILITY.md — déclaration d'accessibilité

Déclaration publique de VerySlopyNyNotes (`versionName` `0.1.0`, aucun APK
publié). Dernière revue : **2026-11-03**. Prochaine revue : **2027-05-03**.

Périmètre : l'interface React embarquée dans l'application Android (`web/`).
Les écrans natifs (mise à jour WebView, permissions Android, partage système),
Pronote et OpenRouter ne sont pas couverts.

## Cible de conformité

La cible est **WCAG 2.2 niveaux A et AA** pour les 25 routes visitées par
`make web-smoke`, en thème clair et sombre. La référence exécutable est
axe-core 4.14.0 avec les règles `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`,
`wcag22a` et `wcag22aa`.

Cette cible est **partiellement vérifiée, jamais certifiée** : aucun audit
externe, aucun test avec un lecteur d'écran et aucun test sur appareil réel.
Aucune conformité totale n'est revendiquée. Ce qui est réellement automatisé :

- analyse `axe` de chaque route, en clair puis en sombre, sans violation ;
- contraste des jetons appliqués (`encre`, `surface`, `accent`, `erreur`,
  bouton plein) ≥ 4,5:1, sur les quatre palettes et leurs deux modes ;
- garde unique `prefers-reduced-motion` dans tout l'arbre CSS ;
- contrats de taille de texte (100/125/150 %, système suivi jusqu'à 200 %) ;
- piège et retour de focus des dialogues, vérifiés par des tests de source.

Les preuves appareil vivent dans [`QA-MATRIX.md`](QA-MATRIX.md) et font foi :
une ligne `Bloqué` n'est pas une conformité.

## Limites connues

| Limite | Effet pour l'utilisateur | Preuve ou statut | Contournement connu |
|---|---|---|---|
| Aucun appareil ni émulateur Android | Le rendu et les gestes réels ne sont pas constatés. | QA-01 à QA-04 et QA-13 : `Bloqué` dans [`QA-MATRIX.md`](QA-MATRIX.md). | Installer l'APK debug sur un appareil et suivre la procédure de la ligne QA. |
| Lecteur d'écran non testé | TalkBack peut annoncer un libellé imprévu, un ordre de lecture incorrect ou rater un état dynamique. | Aucun test vocal ; seuls les rôles et libellés ARIA sont vérifiés automatiquement. | Utiliser TalkBack et signaler l'écran, le contrôle et l'annonce attendue. |
| Police système à 200 % | Un contrôle peut être coupé ou chevauché même si le reflow est prévu à partir de 150 %. | QA-07 : `Bloqué`. Le contrat `textZoom` est testé, pas le rendu à `fontScale = 2`. | Choisir 100 %, 125 % ou 150 % dans Réglages → Apparence. |
| WebView ancienne | Entre Chromium 100 et la version testée, une régression de rendu ou de focus reste possible. | QA-05 : `Bloqué`. Seul Chromium 156.0.8078.4 est scanné ; Chromium 100 est le minimum accepté, pas une preuve. | Mettre à jour Android System WebView ou Chrome, puis relancer l'app. |
| Zones sûres, encoche et geste | Un bouton peut passer sous la barre de gestes sur un appareil non représenté par les captures web. | QA-13 : `Bloqué`. Les insets sont simulés dans les tests web. | Signaler le modèle, l'orientation et l'écran ; les jetons `--safe-*` restent la référence. |
| Mouvement réduit non constaté sur appareil | Le réglage Android n'a pas été exercé, même si la garde CSS globale est testée. | Contrat CSS dans `tests/web/motion.test.ts` ; aucun appareil. | Activer « Supprimer les animations » dans Android et vérifier les transitions. |

## Environnements testés

| Environnement | Version | Statut | Ce qui est prouvé |
|---|---|---|---|
| Poste Linux de rédaction | Bun 1.4.4, Playwright 1.64.1 | `Réussi` (2026-11-03) | `make web-smoke` : 25 routes × clair/sombre, `axe-core` 4.14.0, contrastes, captures 390 × 844. |
| Moteur de test Chromium | Chrome for Testing 156.0.8078.4 | `Réussi` (2026-11-03) | Rendu et scans automatisés. Ce n'est **pas** la WebView système d'un téléphone. |
| Android 8.0 (API 26), WebView Chromium 100+ | Minimum annoncé | `Bloqué` (QA-01, QA-05) | Aucun appareil ni image système. Rien n'est certifié sur ce minimum. |
| Android 12 (API 31) | — | `Bloqué` (QA-02) | Aucun appareil. |
| Android 15 (API 35) | — | `Bloqué` (QA-03) | Aucun appareil. |
| Android 16 (API 36) | — | `Bloqué` (QA-04) | Aucun appareil. |

La version de WebView installée sur un appareil se lit avec
`adb shell dumpsys webviewupdate`. Le minimum, la détection et le refus explicite
sont décrits dans [`COMPATIBILITY.md`](COMPATIBILITY.md).

## Technologies d'assistance

| Technologie | État | Détail |
|---|---|---|
| TalkBack (Android) | Non testé | Aucun appareil ni émulateur. Les libellés, rôles et états ARIA sont posés, mais aucune annonce vocale n'est vérifiée. |
| Switch Access | Non testé | Aucun parcours au commutateur. |
| Clavier matériel ou Bluetooth | Non testé | Le piège de focus des dialogues est testé en source (`tests/web/dialog-a11y.test.ts`), pas sur appareil. |
| Agrandissement et loupe Android | Non testé | Le zoom texte est borné à 200 % ; la loupe système n'est pas exercée. |
| Taille de police système | Partiellement vérifié | Contrat jusqu'à 200 % et reflow à partir de 150 %, sans validation visuelle sur appareil. |
| Mouvement réduit | Partiellement vérifié | Garde CSS globale testée ; réglage Android non exercé. |

## Contact et support

Un problème d'accessibilité s'ouvre comme une issue **bug** :
<https://github.com/iguanacucumber/veryslopnynotes/issues/new/choose>.

Joindre, sans aucune donnée scolaire : version de l'app, version d'Android,
version de la WebView, lecteur d'écran et sa version, écran et étape, message
exact, comportement attendu. Ne jamais joindre de nom, d'URL d'établissement,
de note, de message ni de capture non caviardée.

Une faille exploitable ne s'ouvre pas en issue publique : passer par
**GitHub Security Advisories** (<https://github.com/iguanacucumber/veryslopnynotes/security/advisories/new>),
comme décrit dans [`SECURITY.md`](../SECURITY.md). Le dépôt n'a pas d'adresse
de courriel de signalement. Les mainteneurs répondent au mieux, sans délai
garanti. Les demandes d'adaptation raisonnable suivent le même canal.

## Mise à jour

Cette déclaration est revue :

1. dans toute PR qui change l'interface, les couleurs, la taille du texte, le
   focus ou les animations ;
2. avant toute publication d'APK ou de release ;
3. après un changement de version Android ou de WebView prise en charge ;
4. au moins tous les **6 mois**, prochaine échéance le **2027-05-03**.

La revue met à jour la date en tête, les versions réellement testées et les
limites ; une ligne [`QA-MATRIX.md`](QA-MATRIX.md) ne passe à `Réussi` qu'avec
une date, un environnement et une preuve. Le propriétaire est l'équipe de
maintenance du dépôt, via une PR.

## Voir aussi

[`QA-MATRIX.md`](QA-MATRIX.md) pour les preuves appareil,
[`COMPATIBILITY.md`](COMPATIBILITY.md) pour les versions prises en charge,
[`PRODUCT.md`](PRODUCT.md) pour les écrans et [`CONTEXT.md`](CONTEXT.md) pour
la carte des documents.
