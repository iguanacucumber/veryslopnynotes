# Bêta privée

Ce document est le kit de la bêta privée de VerySlopyNyNotes (suivi
[#969](https://github.com/iguanacucumber/veryslopnynotes/issues/969)). Il décrit
comment rejoindre le canal, installer et mettre à jour un APK signé, donner un
retour sans donnée scolaire et sortir vers la version finale.

Il ne prouve ni recrutement ni consentement. **Aucune pré-release bêta n'est
publiée à ce jour** : tant qu'aucune version `vX.Y.Z-beta.N` n'apparaît sur la
page [Releases](https://github.com/iguanacucumber/veryslopnynotes/releases), la
bêta n'est pas ouverte. La cible est de **5 à 10 participants** ; ce nombre est
un objectif, pas un résultat.

## Rejoindre la bêta privée

La bêta est privée par sa cohorte invitée, pas par un contrôle d'accès : le
dépôt et ses pré-releases sont publics. Une personne qui a l'URL peut
télécharger l'APK ; ne pas redistribuer le lien ou le fichier hors du groupe
invité.

1. Le mainteneur invite nominativement chaque participant et lui envoie le lien
   de la pré-release, pas un APK en pièce jointe.
2. Avant l'installation, le participant lit cette page,
   [`PRIVACY.md`](../PRIVACY.md), [`TERMS.md`](../TERMS.md) et
   [`SUPPORT.md`](SUPPORT.md), puis confirme :
   - être majeur, ou disposer de l'accord de son représentant légal ;
   - utiliser un compte autorisé par son établissement et respecter ses règles ;
   - accepter que le retour passe par une issue GitHub publique, sans donnée
     scolaire.
3. Le mainteneur recueille un accord explicite avant l'installation (version
   testée, canal de retour). Cet accord reste **hors du dépôt public** et ne
   contient aucune donnée scolaire. Ce kit ne fournit ni formulaire ni registre
   de consentement : aucune preuve de consentement n'est publiée dans une issue.
4. Le participant installe uniquement l'APK joint à la pré-release
   `vX.Y.Z-beta.N`, marquée **Pre-release** sur GitHub, avec son fichier
   `SHA256SUMS`.

Un participant qui ne peut pas accepter ces limites ne rejoint pas la bêta.
L'application ne vérifie ni l'âge, ni l'autorisation de l'établissement, ni
l'accord du représentant légal : ces vérifications sont humaines.

## Installer et mettre à jour

Seul un **APK release signé** publié sur la page Releases est accepté. Un APK
debug, un build release sans clé ou une copie trouvée ailleurs ne reçoit aucune
mise à jour du projet.

1. Télécharger depuis la pré-release :
   - `veryslopnynotes-X.Y.Z-beta.N.apk` ;
   - `SHA256SUMS` ;
   - l'archive source si elle est utile à la vérification.
2. Vérifier l'empreinte et le certificat avant d'installer :

   ```sh
   sha256sum veryslopnynotes-X.Y.Z-beta.N.apk
   apksigner verify --print-certs veryslopnynotes-X.Y.Z-beta.N.apk
   ```

   Comparer la valeur SHA-256 au fichier `SHA256SUMS` de la release et
   l'empreinte du certificat à celle publiée sur la page. Si l'une diffère, ne
   pas installer le fichier et le signaler via un
   [Advisory privé](https://github.com/iguanacucumber/veryslopnynotes/security/advisories/new).
3. Autoriser l'installation depuis une source inconnue, puis installer l'APK.
4. Noter la version installée : Réglages Android → Applications →
   VerySlopyNyNotes, ou le nom de l'APK.

Mises à jour :

- **Bêta → bêta** : installer la bêta suivante (`vX.Y.Z-beta.N` avec `N` qui
  croît) par-dessus, sans désinstaller. Le `versionCode` croît avec `N`.
- **Bêta → finale** : installer `vX.Y.Z` par-dessus la dernière bêta. La finale
  porte un `versionCode` supérieur à toutes ses bêtas ; les données locales sont
  conservées par la mise à jour.
- **Manuel ou Obtainium (facultatif)** : Obtainium interroge GitHub et propose
  les releases avec APK ; ce n'est pas un service du projet. Pour rester sur la
  finale, ne plus suivre les pré-releases.

Ne jamais installer une bêta par-dessus une version finale, ni une bêta
antérieure : Android refuse un `versionCode` inférieur (downgrade). Revenir en
arrière exige une désinstallation, donc la perte des données locales. Une
migration debug → release exige aussi une désinstallation : exporter d'abord
depuis Réglages, puis ressaisir le QR/PIN et la clé. Les règles de signature
sont dans [`SIGNING.md`](SIGNING.md) et [`RELEASE.md`](RELEASE.md).

## Aucune télémétrie

**L'APK de bêta n'embarque ni SDK d'analytics, ni rapport de crash, ni
identifiant d'installation, ni journal automatique.** Aucune donnée n'est
envoyée au projet, et aucune ligne de code de l'app ne produit un signal de
mesure. Le suivi de la bêta repose uniquement sur les rapports humains via
GitHub Issues et sur l'intégrité des artefacts.

GitHub peut journaliser les téléchargements de releases selon sa propre
politique ; ce n'est pas de la télémétrie embarquée. Le projet ne demande ni
identifiant d'appareil, ni journal automatique, ni capture non caviardée. Une
absence de retour n'est pas une preuve de succès : elle se note « muet », pas
« vert ». Le détail des signaux et seuils est dans
[`RELEASE-HEALTH.md`](RELEASE-HEALTH.md).

## Consentement et vie privée

L'application est locale d'abord : elle ne crée aucun compte chez le projet et
n'envoie aucune donnée scolaire à un serveur du projet. Les seuls flux réseau
sont l'établissement (Pronote), OpenRouter si le participant utilise l'assistant
avec sa propre clé, le scraper de manuels facultatif qu'il configure, et GitHub
pour la release. Le détail est dans [`PRIVACY.md`](../PRIVACY.md).

- L'assistant IA est **facultatif** et exige un consentement versionné ainsi
  qu'une attestation d'âge ou d'autorisation parentale. Sans attestation,
  aucune clé n'est enregistrée et aucun appel IA n'est possible. Le retrait
  efface la clé et le fil.
- Un participant mineur utilise l'app avec l'accord de son représentant légal et
  dans le cadre autorisé par son établissement. L'app ne vérifie pas cet accord.
- La notice de confidentialité est une **version de travail, revue juridique en
  attente** : ce kit ne revendique aucune validation juridique.
- Ne jamais publier dans une issue : nom, URL ou nom d'établissement, classe,
  identifiant scolaire, note, appréciation, emploi du temps, devoir, message,
  actualité, pièce jointe, QR, PIN, jeton, clé OpenRouter, capture non
  caviardée, export ou identifiant d'appareil.
- Le diagnostic exporté est facultatif : l'aperçu affiché est le fichier exact,
  rien n'est envoyé automatiquement, et le participant choisit lui-même la
  destination via le sélecteur Android. Il ne remplace pas la lecture de
  [`SUPPORT.md`](SUPPORT.md).
- Une faille exploitable, un secret exposé ou une fuite de données passe par un
  [Advisory privé](https://github.com/iguanacucumber/veryslopnynotes/security/advisories/new),
  jamais par une issue publique.
- La déconnexion purge les données du compte ; « Supprimer toutes mes données »
  et la désinstallation effacent les données locales selon
  [`PRIVACY.md`](../PRIVACY.md). Un export déjà partagé reste hors du contrôle
  de l'app.

## Donner un retour

Le seul canal de retour est **GitHub Issues**. Aucun courriel, formulaire, chat,
message privé ou numéro n'est publié.

- Ouvrir une issue avec le modèle
  [Retour bêta](https://github.com/iguanacucumber/veryslopnynotes/issues/new?template=beta_feedback.yml),
  une issue par problème.
- Indiquer la version de l'app (bêta et `versionCode` si affiché), la version
  d'Android, la version de la WebView, l'écran concerné, les étapes exactes, le
  comportement attendu et le comportement obtenu.
- Joindre le message ou le code exact, sans contenu scolaire. Une capture doit
  être caviardée. Le diagnostic exporté est facultatif.
- Lire d'abord l'issue épinglée `[known-issues] vX.Y.Z` et
  [`COMPATIBILITY.md`](COMPATIBILITY.md). Si le défaut est déjà connu, commenter
  l'issue épinglée au lieu d'ouvrir un doublon.
- Une question d'usage ou une demande de fonctionnalité suit
  [`SUPPORT.md`](SUPPORT.md) et le modèle de demande de fonctionnalité.
- Un rapport sans version, sans étapes et sans message exact est demandé en
  complément une fois, puis classé P3.

## Triage et problèmes connus

Chaque version de bêta a **une** issue épinglée `[known-issues] vX.Y.Z` (label
`bug`) qui liste chaque défaut connu, son contournement, son propriétaire et la
version cible. Elle est mise à jour à chaque revue de bêta et close quand la
version n'est plus proposée. Un défaut connu ne reste jamais seulement dans un
fil de discussion.

Le triage suit [`INCIDENTS.md`](INCIDENTS.md) et [`SUPPORT.md`](SUPPORT.md) :

| Priorité | Exemple | Accusé cible | Décision cible |
|---|---|---|---|
| P0 | Perte de données, démarrage cassé, faille exploitable, clé exposée | ≤ 4 h | Retrait ou correctif ≤ 24 h |
| P1 | Crash ou ANR au-dessus du seuil, parcours principal bloqué | ≤ 1 jour ouvré | Pause ou correctif ≤ 72 h |
| P2 | Régression sans perte de données, artefact douteux | ≤ 3 jours ouvrés | Correctif à la prochaine release |
| P3 | Gêne mineure, question d'usage | ≤ 5 jours ouvrés | File normale |

Revue de bêta : J+0, J+1, J+3, J+7, puis hebdomadaire jusqu'à J+30. L'ordre du
jour couvre l'intégrité des artefacts, les rapports, l'issue `known-issues` et
la décision de poursuite, de pause ou de retrait. Deux rapports indépendants de
perte de données sur la même version en 7 jours, ou un seuil de
[`RELEASE-HEALTH.md`](RELEASE-HEALTH.md) franchi, imposent la pause. Une bêta ne
devient pas finale par silence : la promotion exige une décision explicite et
un gate vert.

## Sortir de la bêta

1. Télécharger la finale `vX.Y.Z` sur la page Releases et vérifier son SHA-256
   et son certificat, comme pour la bêta.
2. Installer la finale **par-dessus** la dernière bêta, sans désinstaller. Même
   certificat et `versionCode` supérieur : les données locales sont conservées.
3. Ne plus suivre les pré-releases (Obtainium ou téléchargement manuel), et
   vérifier que la version installée est bien `X.Y.Z`.
4. Lire la section finale de [`CHANGELOG.md`](../CHANGELOG.md) et l'issue
   `[known-issues]` correspondante ; la bêta n'est plus proposée.

Ne pas revenir à une bêta ou à une version antérieure après la finale :
Android refuse le downgrade. Si une désinstallation est inévitable, exporter
d'abord ; elle efface session, cache, clé, conversations, pièces jointes et
préférences. Si une bêta est retirée, suivre l'avis de la page de release et ne
jamais installer un APK trouvé ailleurs. Une fois la finale installée, le
support redevient celui de [`SUPPORT.md`](SUPPORT.md), sans canal bêta.

## Checklist du participant

- [ ] J'ai lu `docs/BETA.md`, `PRIVACY.md`, `TERMS.md` et `SUPPORT.md`.
- [ ] J'ai donné mon accord explicite au mainteneur avant l'installation, et je
      dispose de l'autorisation de mon établissement (et de mon représentant
      légal si je suis mineur).
- [ ] Je sais que la pré-release est publique et que je ne redistribue ni le
      lien ni l'APK hors du groupe invité.
- [ ] J'utilise un appareil de test ou j'ai exporté mes données ; j'accepte la
      perte locale en cas de désinstallation.
- [ ] J'ai téléchargé l'APK uniquement depuis la page Releases et vérifié le
      SHA-256 et le certificat avec `apksigner`.
- [ ] J'ai installé la bêta sans désinstaller une version précédente et j'ai
      noté la version et le `versionCode`.
- [ ] J'ai testé l'appairage, les écrans principaux et une mise à jour
      bêta → bêta ou bêta → finale.
- [ ] Je signale via le modèle « Retour bêta », sans donnée scolaire ; une
      faille passe par un Advisory privé.
- [ ] Je sais que l'APK n'embarque aucune télémétrie et qu'aucun journal n'est
      envoyé automatiquement.
- [ ] J'ai installé la finale `vX.Y.Z` ou j'ai quitté la bêta explicitement,
      sans downgrade.

## Preuves attendues

Ce document ne remplit aucune preuve à lui seul. L'issue #969 reste ouverte
tant que les éléments suivants ne sont pas réels et vérifiables :

- 5 à 10 participants invités, avec un accord explicite recueilli avant
  l'installation et conservé hors du dépôt public ;
- une installation de `vX.Y.Z-beta.N` puis une mise à jour par-dessus, sans
  désinstallation ni perte de données, et une finale `vX.Y.Z` installée ;
- une issue épinglée `[known-issues] vX.Y.Z` tenue à jour et des retours triés ;
- la confirmation qu'aucune télémétrie n'est embarquée.

Un nombre de participants, un consentement ou une preuve d'installation ne
s'invente pas : sans trace réelle, le suivi reste ouvert.
