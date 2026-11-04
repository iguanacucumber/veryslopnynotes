# DOGFOOD.md — dogfood interne, 14 jours sur un téléphone réel

Protocole du dogfood interne demandé par #965. Ce document ne contient **aucun
résultat** : tant que les 14 jours n'ont pas eu lieu et que la checklist n'est
pas signée, l'issue #965 reste ouverte. Aucun participant n'est nommé d'avance.

## Périmètre et données

- **Un seul téléphone Android réel**, désigné avant J1. Pas d'émulateur, pas de
  tablette, pas de second appareil de secours : un changement d'appareil remet
  le compteur à zéro.
- **Build de dogfood : APK debug**, parce que la release refuse la démo
  (`DEMO_MODE=false`). Le run ne prouve donc pas la release signée ; les
  contrôles release restent dans [`QA-MATRIX.md`](QA-MATRIX.md).
- **Données autorisées** : le compte de démonstration public ouvert par
  « Connexion démo », et du texte synthétique saisi à la main. Aucun QR, aucun
  PIN, aucun compte Pronote réel, aucune note, appréciation, message, actualité,
  pièce jointe ni nom d'établissement.
- **Aucune télémétrie** : pas d'analytics, pas de crash reporter, pas
  d'identifiant d'installation, aucun journal envoyé automatiquement. Le
  journal du dogfood est écrit par l'humain.
- Si un QR réel est scanné par erreur : arrêter, déconnecter, purger les
  données et ne rien recopier dans le journal.

## Préparation (J0)

1. Construire l'APK debug : `make buildDebugApk`. Noter le tag git, le commit
   (`git describe --tags --always --dirty`) et le résultat du build.
2. Installer avec `make updateApkToPhone` ou
   `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`.
3. Dans **À propos**, relever `versionName`, `versionCode`, le tag source, le
   modèle du téléphone, la version d'Android et la version de la WebView.
4. Partir d'un état propre : aucune donnée d'un run précédent. Ouvrir
   **Connexion démo** ; si le bouton est absent, ce n'est pas un build de
   dogfood.
5. Créer le socle synthétique à retrouver après redémarrage et mise à jour :
   une note de cours, une fiche de révision depuis un devoir de démo, un fil
   avec le professeur, un thème et une matière personnalisée.
6. **IA désactivée** : sans clé ni consentement, demander une aide et vérifier
   que l'app refuse explicitement, sans appel réseau.
7. **IA activée** : saisir une clé OpenRouter, donner le consentement et
   l'attestation requise, puis utiliser uniquement cet énoncé synthétique :
   « Soit u0 = 1 et u(n+1) = 2u(n) + 1. Démontre par récurrence que
   u(n) = 2^(n+1) − 1. » Vérifier l'étiquette « IA — à vérifier » et l'action
   « Signaler ».
8. Faire une exportation locale de contrôle et vérifier qu'elle ne contient ni
   jeton de session ni clé. Ne pas la joindre au journal.

## Journal quotidien

Une entrée par jour, même un jour sans usage. Le journal vit dans un
commentaire de #965 ou dans un fichier lié, sans donnée scolaire.

| Champ | Contenu attendu |
|---|---|
| `Date` | Jour du run, format AAAA-MM-JJ. |
| `Build/tag` | `versionName`/`versionCode`, tag ou commit, debug/release. |
| `Appareil/WebView` | Modèle, version et API Android, version de la WebView. |
| `Parcours` | Écrans et actions exercés, avec réussite ou échec. |
| `Erreurs` | Code exact, message, écran, étapes de reproduction, nombre d'occurrences. |
| `Perte de données` | Session, cache, note de cours, fiche, fil, préférences et export retrouvés après redémarrage. |
| `IA désactivée/activée` | État de la clé et du consentement, énoncé synthétique, étiquette et signalement observés. |
| `Hors-ligne` | Mode avion, écrans encore lisibles, erreurs explicites, reprise au retour du réseau. |
| `Mise à jour` | Build précédent → nouveau build, résultat de l'installation, données conservées. |

Modèle à copier, une ligne par jour :

```text
| Date | Build/tag | Appareil/WebView | Parcours | Erreurs | Perte de données | IA désactivée/activée | Hors-ligne | Mise à jour |
| AAAA-MM-JJ | | | | | | | | |
```

Chaque semaine, couvrir au moins une fois : accueil, cours, tâches, notes, vie
scolaire, messages, actualités, cantine, fiches de révision, cahier de cours,
professeur, alertes, profil et réglages. Faire au moins un redémarrage complet,
un passage hors-ligne puis une reprise, et une mise à jour par-dessus le build
précédent (`adb install -r`, jamais de désinstallation).

## Triage P0/P1 et règle d'arrêt

| Priorité | Définition dans le dogfood | Action | Reprise |
|---|---|---|---|
| P0 | Perte de données non volontaire, démarrage cassé, fuite entre comptes, secret ou clé exposé. | Arrêt immédiat. Ne pas désinstaller : préserver l'état. Ouvrir une issue `incident` (Advisory privé si sécurité) et prévenir le propriétaire. | Après correctif vérifié sur le même téléphone ; le compteur des 14 jours repart à zéro. |
| P1 | Parcours principal bloqué sans contournement, crash ou ANR reproductible, appairage démo impossible, étiquette IA ou action « Signaler » absente, faux état « à jour ». | Suspendre la journée, ouvrir une issue `bug` ou `incident` avec la reproduction. Triage sous 1 jour ouvré. | Correctif ou contournement accepté et vérifié ; le compteur est suspendu tant que la P1 est ouverte. |
| P2 | Régression avec contournement, sans perte de données. | Consigner et ouvrir une issue. | Le run continue. |
| P3 | Gêne mineure, ton, lenteur, question de comportement. | Consigner. | Le run continue. |

**Règle d'arrêt.** Une P0 arrête le run le jour même. Une P1 suspend le
compteur. Une P0/P1 qui touche les données — perte, corruption, mélange de
comptes, faux état frais — interdit la sortie tant qu'elle est ouverte. Un jour
sans entrée ne compte pas ; une réinstallation propre, un reset d'usine ou un
changement de téléphone remet le compteur à zéro.

## Critères de sortie

La checklist n'est valide qu'avec les 14 entrées et leurs preuves. Une case
cochée sans preuve ne compte pas.

- [ ] 14 jours consécutifs sur le même téléphone réel, une entrée par jour.
- [ ] Build/tag, appareil et WebView relevés chaque jour ; build final identifié.
- [ ] Tous les parcours de la semaine couverts au moins deux fois sur la période.
- [ ] IA désactivée et activée exercées avec le texte synthétique, sans donnée scolaire.
- [ ] Mode avion et reprise réseau exercés ; cache lisible, erreurs explicites.
- [ ] Au moins une mise à jour par-dessus un build précédent, données conservées.
- [ ] Perte de données vérifiée après redémarrage, hors-ligne et mise à jour.
- [ ] Aucune P0/P1 de données ouverte ; P2/P3 ouvertes ou acceptées avec un propriétaire.
- [ ] Aucune donnée scolaire, aucun identifiant d'appareil et aucune télémétrie dans les preuves.
- [ ] Journal et preuves liés dans #965 ; checklist ci-dessous signée.

```text
Propriétaire du dogfood : ______________________________
Date de clôture : ______________________________________
Build final (tag/commit) : ______________________________
Décision : [ ] GO    [ ] NO-GO
```

## Preuves et confidentialité

Preuves attendues : le journal des 14 jours, les versions relevées dans **À
propos**, les captures **caviardées**, les extraits `adb logcat` bornés, la
sortie de `adb install -r` et la checklist signée. Une preuve sans date, build
et appareil n'est pas recevable.

Sont interdits dans le journal et les pièces jointes, comme dans
[`SUPPORT.md`](SUPPORT.md) : nom ou prénom, établissement, classe, note,
message, actualité, pièce jointe, QR, PIN, jeton, clé OpenRouter, capture non
caviardée, export de données, numéro de série ou identifiant d'appareil. Le
journal est public : une donnée scolaire publiée par erreur se retire, un secret
se révoque d'abord.

La sortie de #965 exige un commentaire final avec le lien du journal, le build
final et la checklist signée. Le propriétaire du dogfood signe ; aucune
signature ni aucun résultat n'est prérempli dans ce document.

## Voir aussi

[`QA-MATRIX.md`](QA-MATRIX.md) pour les preuves appareil,
[`INCIDENTS.md`](INCIDENTS.md) pour le triage et les runbooks,
[`RELEASE-HEALTH.md`](RELEASE-HEALTH.md) pour les seuils sans télémétrie.
