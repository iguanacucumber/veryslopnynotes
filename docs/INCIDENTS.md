# Incidents et suivi de release

Un incident est un écart observable entre une release publiée et son contrat :
crash, ANR, perte de données, artefact non conforme, gate rouge sur un commit
taggé ou serveur indisponible. Les signaux, seuils et décisions de retrait sont
dans [`RELEASE-HEALTH.md`](RELEASE-HEALTH.md) ; ce document règle le triage et
la communication.

## Déclencheurs

- Un seuil S1, S2, S3, S4, S5 ou S6 de `RELEASE-HEALTH.md` est franchi.
- Deux rapports indépendants de perte de données visent la même version.
- Un signalement `SECURITY.md` est exploitable ou une clé est exposée.
- Le même échec se produit trois fois : il ouvre une issue `incident` (AGENTS.md).

## Triage

| Priorité | Exemple | Accusé de réception | Décision |
|---|---|---|---|
| P0 | Perte de données, démarrage cassé, faille exploitable, clé exposée | ≤ 4 h | Retrait ou correctif ≤ 24 h |
| P1 | Crash ou ANR au-dessus du seuil de pause | ≤ 1 jour ouvré | Pause ou correctif ≤ 72 h |
| P2 | Régression sans perte de données, artefact douteux | ≤ 3 jours ouvrés | Correctif à la prochaine release |
| P3 | Gêne mineure, question de comportement | ≤ 5 jours ouvrés | Vers la file normale |

Un rapport sans version, sans étape de reproduction et sans trace est demandé en
complément une fois, puis classé P3. Le triage ne demande ni identifiant
d'appareil ni journal automatique : la trace vient de l'utilisateur, jamais d'une
collecte cachée.

## Règle de pause

Deux rapports indépendants de **perte de données** sur la même version en
7 jours, ou un seuil de crash/ANR de `RELEASE-HEALTH.md` franchi, imposent la
pause immédiate du déploiement. La reprise exige les quatre preuves de
`RELEASE-HEALTH.md` : 24 h sous les seuils, gate vert, empreintes republiées,
rapports clos ou expliqués.

## Issue « known-issues »

Une issue épinglée `[known-issues] vX.Y.Z` (label `bug`) liste, pour chaque
version publiée ou en bêta, les défauts connus, leur contournement, leur
propriétaire et la version cible. Elle est mise à jour à chaque revue de bêta et
close quand la version n'est plus proposée. Aucun défaut connu ne reste seulement
dans un fil de discussion.

## Revue de bêta

Revue de bêta : J+0, J+1, J+3, J+7, puis hebdomadaire jusqu'à J+30. Ordre du
jour : vitals S1/S2, verdict CI S3, rapports S4, empreintes S5, santé serveur S6,
issue `known-issues`, décision de poursuite, de pause ou de retrait. Le
responsable de release tient la revue ; l'absence de signal se note « muet »,
pas « vert ».

## Procédure

1. Ouvrir une issue `incident` avec version, signal, seuil franchi et preuve.
2. Geler la publication ou le déploiement concerné ; ne pas merger de correctif
   sans gate vert.
3. Appliquer la décision de [`RELEASE-HEALTH.md`](RELEASE-HEALTH.md) : pause,
   retrait, retour arrière serveur ou correctif.
4. Publier un avis court sur l'issue et dans les notes de version : versions
   touchées, contournement, version corrigée, empreintes.
5. Clore après les quatre preuves de reprise. Trois échecs identiques donnent une
   entrée d'invariant via `OPERATING.md`.

## Runbooks

Un runbook est une fiche courte, lue pendant l'incident. Les quatre fiches
ci-dessous suivent le même ordre : détection, triage, communication,
confinement et correctif, retrait ou retour arrière. Le tableau de triage et les
seuils de [`RELEASE-HEALTH.md`](RELEASE-HEALTH.md) restent l'autorité ; une fiche
ne crée ni seuil ni priorité nouveaux.

Canaux autorisés, sans contact inventé :

- **Issue GitHub `incident`** : cas non sensible, avec version, symptôme et
  preuve.
- **GitHub Security Advisory** : faille exploitable ou clé exposée ; le fil
  reste privé jusqu'au correctif ([`SECURITY.md`](../SECURITY.md)).
- **Notes de release, `CHANGELOG.md`, page de release** : ce que voit
  l'utilisateur ; l'app n'a ni push ni message distant.
- **Play Console** : arrêt du déploiement, notes de version, empreintes.
- **Tableau de bord OpenRouter** : révocation de la clé LLM par son détenteur,
  hors dépôt.
- **Logs locaux de l'opérateur** : santé du scraper (S6) ; jamais un journal
  envoyé par l'app.

Aucun canal hors de cette liste : pas d'adresse de courriel, pas de numéro, pas
de compte de messagerie, pas d'identifiant d'appareil. Un rapport sans version,
sans reproduction et sans trace suit la règle de triage existante.

| Runbook | Signal d'entrée | Priorité initiale | Retrait par défaut |
|---|---|---|---|
| Rupture de protocole | S4, ou S3 si le correctif casse le gate | P1 si l'appairage est impossible, sinon P2 | non : correctif |
| Mauvaise release | S1, S2, S3, S4, S5 | P0 à P2 selon le tableau de triage | oui si l'artefact est fautif |
| Clé exposée | S4 sécurité, scan secret, Advisory | P0 | oui si un artefact publié contient la clé |
| Incompatibilité d'établissement | S4 | P2 si régression, sinon P3 | non : limitation |

### Rupture de protocole

**Détection.** Trois rapports indépendants du même symptôme sur la même version
en 7 jours (S4), ou un échec d'appairage, d'ouverture de session ou de ressource,
avec la version de l'app et le message exact. Un gate rouge (S3) sur le correctif
compte aussi. Reproduire avec la démonstration publique et, si un mainteneur
dispose d'un compte autorisé, avec un établissement appairé ; consigner un
échange Pronote caviardé dans `tests/fixtures/pronote/` (gitignoré, jamais
publié). Distinguer trois ruptures : QR illisible ou refusé, session non ouverte,
ressource dont le schéma a changé.

**Triage.** P0 si perte de données, démarrage cassé ou faille exploitable — la
rupture seule n'en est pas une, l'app échoue fermée. P1 si l'appairage ou
l'ouverture de session est impossible pour tous les utilisateurs d'un
établissement, ou pour tous les établissements sur une version, sans
contournement. P2 si une ressource ou un établissement est seul touché, ou si un
contournement existe. Si la démonstration casse aussi, c'est une régression de
l'app, pas une évolution de Pronote.

**Communication.** Issue `incident` publique si aucune donnée sensible ; Advisory
privé si la rupture touche un secret ou une faille. Ajouter l'entrée
`known-issues` avec version touchée, symptôme, contournement et version cible.
Prévenir dans la note de release du correctif. Ne demander ni URL ou nom
d'établissement, ni note, ni message, ni capture non caviardée : le message
exact et les versions suffisent.

**Confinement et correctif.** Geler la publication et le merge du correctif
jusqu'au gate vert. Si le QR change, l'app ne peut pas appairer sans QR :
afficher une erreur explicite et documenter la limite, sans repli mot de passe,
SSO ou MFA (contrat QR, [`COMPATIBILITY.md`](COMPATIBILITY.md)). Si le schéma
d'une ressource change : mettre à jour le parseur TS et Kotlin à parité, ajouter
la fixture caviardée, garder les champs inconnus ignorés, puis publier un
correctif avec `versionCode` supérieur. Si c'est une régression de l'app : revert
par PR ou correction, test de non-régression, gate. Interdits : désactiver TLS,
relayer par le serveur, scraper Pronote depuis le serveur (lois 1 et 2).

**Retrait ou retour arrière.** Pas de retrait par défaut : une évolution de
Pronote n'est pas un artefact fautif. Retirer la version si elle est la cause
(gate rouge, régression, empreinte fausse) selon
[`RELEASE-HEALTH.md`](RELEASE-HEALTH.md) : arrêt du déploiement Play, puis
correctif `versionCode` supérieur ; en sideload, retirer APK/AAB et empreintes et
republier la dernière version bonne. Si aucun correctif n'est possible, publier
la limitation dans [`COMPATIBILITY.md`](COMPATIBILITY.md), garder l'issue ouverte
comme `known-issues` et clore l'incident avec la preuve, pas avec un faux
« corrigé ».

### Mauvaise release

**Détection.** S3 : gate rouge sur le commit taggé ou artefact non reproductible.
S5 : SHA-256, certificat `apksigner` ou digest d'image différent de la
publication. S1/S2 : seuils de crash ou d'ANR. S4 : perte de données ou même
symptôme. Vérifier d'abord si l'artefact est publié (Play, release GitHub,
sideload) ou seulement construit : cela change le retrait, pas le triage.

**Triage.** Appliquer le tableau existant : P0 pour perte de données, démarrage
cassé, faille ou clé exposée ; P1 pour crash/ANR au-dessus du seuil de pause ou
parcours principal cassé sans contournement ; P2 pour régression sans perte de
données ou artefact douteux ; P3 pour gêne mineure. Un artefact dont l'empreinte
ou le certificat ne correspond pas est P0/S5 même sans symptôme : on ne peut pas
prouver ce qui a été publié.

**Communication.** Issue `incident` avec `versionCode`, signal, seuil, SHA-256,
certificat et décision. Page de release : mention « retiré », motif et version de
remplacement. `CHANGELOG.md` et notes GitHub/Play pour le correctif. Si la faille
est exploitable, Advisory privé d'abord. Ne jamais supprimer silencieusement une
release : un APK installé ne se désinstalle pas à distance et l'utilisateur doit
savoir quoi faire.

**Confinement et correctif.** Arrêter le déploiement Play (halt rollout), geler
les merges, retirer l'artefact des canaux de téléchargement. Identifier le commit
fautif, reproduire avec l'artefact exact sur la matrice
[`QA-MATRIX.md`](QA-MATRIX.md), comparer signature et empreinte. Corriger par
revert PR ou fix forward, ajouter un test de non-régression, passer le gate.
Rebuilder depuis un checkout propre, incrémenter `versionCode` (Play refuse un
code inférieur et ne réutilise pas un code), vérifier `apksigner`, SHA-256 et
absence de secret. Serveur : redéployer le digest précédent épinglé dans
`Dockerfile.server`, jamais une reconstruction non vérifiée.

**Retrait ou retour arrière.** Play : arrêt du déploiement, pas de retour à un
`versionCode` inférieur ; le correctif part avec un code supérieur.
GitHub/sideload : marquer la release « retirée », retirer APK/AAB et empreintes,
republier la dernière version connue bonne avec ses propres empreintes. Serveur :
digest précédent. Un artefact non publié n'est pas retiré : il est jeté. Après
retrait, revue dans les 7 jours et reprise aux quatre preuves de
[`RELEASE-HEALTH.md`](RELEASE-HEALTH.md) (24 h sous les seuils, gate vert,
empreintes republiées, rapports clos ou expliqués).

### Clé exposée

Une clé exposée est toujours P0, même si l'exploitation n'est pas prouvée. On
révoque d'abord, on retire ensuite.

| Clé | Où elle vit | Révocation | Effet |
|---|---|---|---|
| OpenRouter (utilisateur) | préférences chiffrées de l'appareil, jamais le serveur | tableau de bord OpenRouter, par le détenteur | l'ancienne clé cesse d'être acceptée ; saisir une nouvelle clé ; l'app ne peut pas révoquer à distance |
| Signature release | keystore hors dépôt | Play Console (réinitialisation de la clé d'upload ou rotation de signature) ou nouvelle identité | les mises à jour signées par l'ancienne clé ne sont plus acceptées ; sideload : réinstallation, donc perte des données locales |
| `SCRAPER_TOKEN` | environnement de l'opérateur, mode public seulement | remplacer la valeur et redémarrer | l'ancien jeton reçoit 401 ; le cookie jar reste local |
| Secret CI/GitHub | réglages du dépôt | révoquer et recréer dans GitHub | rejouer le gate et vérifier les artefacts |

**Détection.** S4 sécurité ([`SECURITY.md`](../SECURITY.md)), scan gitleaks de
tout l'historique ou push protection, rapport privé, ou secret repéré dans un
log, un artefact ou une capture. Pour OpenRouter, le détenteur peut voir une
dépense ou un quota anormal dans son tableau de bord : signal externe, pas une
télémétrie de l'app. Pour le scraper, les logs locaux montrent des requêtes
inattendues. Ne jamais reproduire la clé dans l'issue, même partiellement.

**Triage.** P0 immédiat, sans attendre la preuve d'exploitation : identifier le
type, la portée (dépôt, historique, artefact publié, appareil), la validité et le
propriétaire. Une clé de signature ou un secret CI remet en cause toutes les
mises à jour ; une clé OpenRouter d'un seul appareil engage la dépense d'un
compte.

**Communication.** Advisory privé tant que la faille est exploitable ; aucune
issue publique avec la valeur. Après révocation et correctif, publier l'avis :
versions touchées, action utilisateur, empreinte du nouveau certificat, jamais la
clé. Pour une clé OpenRouter, le détenteur agit dans son tableau de bord ; l'app
ne peut ni révoquer ni pousser un message. Pour une clé de signature, l'avis est
public : tous les utilisateurs doivent vérifier le certificat avant de mettre à
jour. Pas de courriel, pas d'identifiant d'appareil.

**Confinement et correctif.** Révoquer ou faire tourner la clé d'abord ; retirer
le commit ne suffit pas ([`SECURITY.md`](../SECURITY.md)). OpenRouter :
révoquer, créer une nouvelle clé, la saisir dans l'app, puis « Oublier »
l'ancienne si elle est encore stockée. Signature : arrêter de signer avec la clé
compromise, réinitialiser la clé d'upload ou lancer la rotation de signature dans
Play Console, republier le certificat ; en sideload, prévenir que la
réinstallation purge les données locales. `SCRAPER_TOKEN` : remplacer la
variable, redémarrer, vérifier que l'ancien jeton reçoit 401 et que le service
n'écoute pas hors loopback sans `ALLOW_PUBLIC=1`. Secret CI : révoquer, recréer,
relire les runs et artefacts récents, rejouer `make check`. Corriger la cause
(journalisation, garde de prompt, configuration), ajouter le test qui échoue sans
le correctif, rescanner l'historique.

**Retrait ou retour arrière.** Retirer tout artefact publié qui contient la clé
(APK/AAB, image, archive) : arrêt Play, page « retiré », correctif `versionCode`
supérieur. Une clé LLM d'un seul appareil ne justifie pas un retrait de release :
rotation et clôture. Une clé de signature compromise ne se répare pas par un
simple retrait : les installations font confiance à l'ancienne clé ; l'avis et la
nouvelle identité de signature sont la correction, et les utilisateurs sideload
doivent réinstaller. Consigner la rotation et la décision dans l'issue `incident`
ou l'Advisory.

### Incompatibilité d'établissement

**Détection.** S4 : un ou plusieurs rapports sur un établissement, avec message
exact et versions. Chercher dans la matrice
[`COMPATIBILITY.md`](COMPATIBILITY.md) : portail sans QR, MFA, SSO d'ENT,
version Pronote qui change le QR ou une ressource. Si le cas est déjà listé « non
pris en charge », ce n'est pas une régression. Si le même établissement
fonctionnait avant une release de l'app, appliquer « Mauvaise release ». Ne
demander ni URL, ni nom d'établissement, ni donnée scolaire.

**Triage.** P3 pour une configuration explicitement non prise en charge : réponse
documentée, pas de correctif. P2 pour une régression d'un cas pris en charge,
sans perte de données. P1 si tous les utilisateurs d'un établissement sont
bloqués par une régression de l'app. P0 seulement pour perte de données,
démarrage cassé ou faille.

**Communication.** Répondre sur l'issue avec le lien vers
[`COMPATIBILITY.md`](COMPATIBILITY.md) et la limite exacte ; renvoyer vers le
client officiel Pronote ou le portail de l'établissement comme contournement hors
app, sans promettre une intégration. Fermer comme « non pris en charge » avec la
raison, ou garder en `known-issues` si une version de l'app est en cause. Mettre
à jour [`COMPATIBILITY.md`](COMPATIBILITY.md) seulement si une nouvelle classe de
limite est confirmée, par PR. Ne jamais publier l'identité de l'établissement.

**Confinement et correctif.** Aucun ajout de mot de passe, SSO, MFA ou scraping
de portail sans ADR qui change le contrat QR
([`COMPATIBILITY.md`](COMPATIBILITY.md), [ADR-002](adr/002-pronote-provider.md),
[ADR-003](adr/003-client-direct.md)). Si le cas est pris en charge : reproduire
avec un compte autorisé, caviarder la fixture, corriger le parseur ou le message,
tester la parité TS/Kotlin, publier un correctif. Si le message est ambigu, le
rendre explicite vers la limite connue. Ne pas ajouter de télémétrie pour
connaître la version de l'établissement.

**Retrait ou retour arrière.** Aucun retrait pour une incompatibilité
d'établissement : l'app n'a pas publié un artefact fautif. Si une release de
l'app a cassé un cas pris en charge, appliquer « Mauvaise release » (arrêt,
correctif, `versionCode` supérieur). Si la limite est mal documentée, corriger
[`COMPATIBILITY.md`](COMPATIBILITY.md) par PR ; aucun retour arrière d'artefact.
Clore avec la limitation et rouvrir si le cas devient pris en charge.

## Exercice sur table

L'exercice vérifie qu'on sait décider sans télémétrie, pas qu'on sait rédiger.
Il se tient avant chaque tag mineur ou majeur, et dans les 7 jours qui suivent un
retrait. Durée : 45 min. Rôles : responsable de release, mainteneur de garde,
mainteneur sécurité, opérateur serveur (voir
[`RELEASE-HEALTH.md`](RELEASE-HEALTH.md)). Un seul scénario, tiré d'un runbook,
avec une injection :

- « Trois rapports : l'appairage échoue après une mise à jour Pronote. »
- « Le SHA-256 de l'APK publié ne correspond pas à la release. »
- « Une clé OpenRouter apparaît dans une issue publique. »
- « Un établissement exige la MFA et demande un contournement. »

Dérouler : signal et seuil, priorité, qui décide, premier canal, trois premières
actions, décision de retrait, preuve de clôture. Consigner dans une issue de
suivi : date, scénario, rôles, décisions, lacunes, propriétaire et issue de suite.
Une lacune devient une issue ; trois échecs identiques suivent la règle
d'invariant. Sans cette trace, l'exercice n'est pas une preuve.
