# Support et problèmes connus

Le support de VerySlopyNyNotes passe **uniquement par GitHub Issues**. Aucun
courriel, formulaire, chat, message privé, numéro ni serveur du projet n'est
publié : il ne faut supposer aucune adresse, et une demande envoyée ailleurs ne
sera pas traitée. Le canal privé **GitHub Security Advisories** est réservé aux
vulnérabilités ([`SECURITY.md`](../SECURITY.md)).

## Canal et délais

- Question d'usage, dépannage, incompatibilité ou bug non exploitable :
  <https://github.com/iguanacucumber/veryslopnynotes/issues/new/choose>.
- Faille exploitable, secret exposé ou données d'un autre compte :
  <https://github.com/iguanacucumber/veryslopnynotes/security/advisories/new>,
  jamais une issue publique.
- Le support est communautaire. Les délais ci-dessous sont des objectifs de
  maintenance, pas un engagement contractuel.

| Priorité | Exemple | Accusé cible | Décision cible |
|---|---|---|---|
| P0 | Perte de données, démarrage cassé, faille exploitable, clé exposée | ≤ 4 h | ≤ 24 h |
| P1 | Crash ou ANR au-dessus du seuil, parcours principal bloqué | ≤ 1 jour ouvré | ≤ 72 h |
| P2 | Régression sans perte de données, artefact douteux | ≤ 3 jours ouvrés | Prochaine release |
| P3 | Gêne mineure, question d'usage, demande de précision | ≤ 5 jours ouvrés | File normale |

Un rapport sans version, sans étapes de reproduction et sans message exact est
demandé en complément une fois, puis classé P3. Le triage ne demande ni
identifiant d'appareil ni journal automatique : la trace vient de l'utilisateur,
jamais d'une collecte cachée. Le détail des priorités et de la règle de pause
est dans [`INCIDENTS.md`](INCIDENTS.md).

## Ouvrir un rapport utile

Utiliser le modèle **Bug** et ouvrir **une issue par problème**. Un rapport
exploitable donne :

- la version de l'application (Réglages Android → Applications →
  VerySlopyNyNotes, ou le nom de l'APK) ;
- la version d'Android et la version de la WebView (Android System WebView ou
  Chrome) ;
- l'écran concerné et les étapes exactes, numérotées ;
- le comportement attendu puis le comportement obtenu ;
- le message exact, le code affiché et la ressource concernée (notes, devoirs,
  messages, autre), sans contenu scolaire ;
- l'état de l'appairage : QR + PIN accepté ou refusé, MFA demandée, mode
  démonstration, autre ;
- une capture **caviardée** si elle est utile.

Le [diagnostic exporté](#diagnostic-exporté) fournit la version, Android, la
WebView et le dernier code d'erreur sans recopier de contenu. Le joindre est
facultatif et se fait par le sélecteur Android, jamais automatiquement.

## Données interdites

Un rapport est public : ne jamais y publier de donnée scolaire ou personnelle.
Sont interdits, y compris dans une capture ou un fichier joint :

- nom ou prénom, nom ou URL d'établissement, classe, identifiant scolaire ;
- note, appréciation, emploi du temps, devoir, message, actualité, pièce
  jointe ou manuel ;
- QR, PIN, jeton de session, clé OpenRouter, mot de passe ou autre secret ;
- capture non caviardée, export de données, journal ou identifiant d'appareil.

Si une donnée scolaire est publiée par erreur, la retirer. Si un secret est
publié, le révoquer d'abord, puis ouvrir un Advisory privé : retirer le message
ne suffit pas. Les règles de sécurité et de révocation sont dans
[`SECURITY.md`](../SECURITY.md) et [`INCIDENTS.md`](INCIDENTS.md).

## Diagnostic exporté

**Réglages → Aide → Exporter un diagnostic** prépare un petit fichier JSON
local. L'aperçu affiché **est** le fichier partagé : il montre les champs exacts
avant tout partage. Rien n'est envoyé automatiquement ; Android ouvre le
sélecteur et l'utilisateur choisit lui-même la destination.

Le fichier porte le format `veryslopnynotes.diagnostic`, sa version de schéma et
sa date de génération, puis uniquement : version de l'application, version
Android, niveau d'API Android, version de la WebView, dernier code d'erreur,
ressource concernée, niveau de classe grossier, état de la session et liste des
familles volontairement exclues. Il ne contient jamais de payload Pronote, nom,
URL, identifiant, jeton, QR, PIN, donnée scolaire ni journal. Une valeur hors
allowlist devient `unknown`.

Aucun envoi réseau, aucun stockage hors de l'appareil : le fichier vit dans le
cache, purgé avec le compte. Un diagnostic partagé reste un document que
l'utilisateur choisit de joindre ; le projet n'en reçoit rien tant qu'il n'est
pas publié dans l'issue.

## Problèmes connus

Chaque version publiée ou en bêta a **une** issue épinglée dont le titre est
exactement `[known-issues] vX.Y.Z`, avec le label `bug`. Elle liste chaque
défaut connu, son contournement, son propriétaire et la version cible. Elle est
mise à jour à chaque revue de bêta et close quand la version n'est plus
proposée. Un défaut connu ne reste jamais seulement dans un fil de discussion.

Avant d'ouvrir un bug, lire cette issue et [`COMPATIBILITY.md`](COMPATIBILITY.md).
Si le défaut y figure déjà, commenter l'issue épinglée au lieu d'ouvrir un
doublon. La procédure de revue est dans [`INCIDENTS.md`](INCIDENTS.md).

## Versions et release

La page [Releases](https://github.com/iguanacucumber/veryslopnynotes/releases)
est la seule source de téléchargement officielle. Elle joint l'APK/AAB, ses
empreintes et les notes de version. Aucune release n'est encore publiée à ce
jour (`versionName` `0.1.0`, projet en développement) ; l'app ne vérifie pas
elle-même les mises à jour.

La version installée se lit dans Réglages Android → Applications →
VerySlopyNyNotes, dans À propos (versionName, versionCode et empreinte SHA-256 du
certificat), ou dans le nom de l'APK ; le diagnostic la reprend. Une
installation debug et une release signée ne se mettent pas à jour l'une par
l'autre : la migration exige une désinstallation, donc la perte des données
locales. Les règles de build et de signature sont dans [`RELEASE.md`](RELEASE.md).

## Support, bug ou sécurité

| Situation | Canal | Suite |
|---|---|---|
| Question d'usage, dépannage, limite d'établissement | Issue publique | Réponse communautaire, ou renvoi vers la limite documentée |
| Défaut reproductible de l'application | Issue publique, modèle **Bug**, label `bug` | Triage, reproduction, correctif ou `known-issues` |
| Défaut déjà listé dans la version | Issue épinglée `[known-issues] vX.Y.Z` | Commentaire sur l'issue épinglée, pas de doublon |
| Faille exploitable, secret exposé, fuite de données | GitHub Security Advisories, jamais une issue | Accusé sous 7 jours ouvrés, avis ou correctif sous 90 jours ([`SECURITY.md`](../SECURITY.md)) |
| Demande de fonctionnalité | Issue publique, modèle **Demande de fonctionnalité** | File produit, pas un support |
| Pronote, portail d'établissement, OpenRouter, Android ou WebView | Support officiel de l'éditeur concerné | Le projet ne contourne ni MFA/SSO, ni la facturation OpenRouter, ni un portail |

Un rapport de sécurité n'est pas une demande de support et reste privé jusqu'à
la publication de l'avis. Les versions Android et WebView prises en charge sont
dans [`COMPATIBILITY.md`](COMPATIBILITY.md) ; la santé d'une release se lit dans
[`RELEASE-HEALTH.md`](RELEASE-HEALTH.md).

## Voir aussi

[`SECURITY.md`](../SECURITY.md) pour les vulnérabilités,
[`INCIDENTS.md`](INCIDENTS.md) pour le triage et les problèmes connus,
[`COMPATIBILITY.md`](COMPATIBILITY.md) pour les limites d'appairage et de
versions, [`CONTEXT.md`](CONTEXT.md) pour la carte des documents.
