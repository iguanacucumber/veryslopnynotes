# Santé de release

Ce document définit ce qu'est une release en bonne santé sans collecter de
télémétrie. Il applique les cinq lois d'[`AGENTS.md`](../AGENTS.md) : les données
scolaires restent sur l'appareil hors synchronisation Pronote et appels IA
demandés, et aucun signal de télémétrie ne sort de l'app sans geste humain. Le
modèle de menace est dans
[`THREAT-MODEL.md`](THREAT-MODEL.md), la procédure d'incident dans
[`INCIDENTS.md`](INCIDENTS.md).

## Aucune télémétrie

**Aucune télémétrie n'est ajoutée par ce document.** L'APK n'embarque ni SDK
d'analytics ni crash reporter, ne crée aucun identifiant d'installation,
n'envoie aucun journal et ne contacte aucun serveur de mesure. Les signaux
ci-dessous sont des observations agrégées du store, du dépôt, de l'artefact ou
d'un rapport humain : aucune ligne de code de l'app ne les produit.

Sont interdits sans ADR qui modifie explicitement les cinq lois : SDK
Firebase/Crashlytics/Sentry/analytics, identifiant d'appareil, journal
automatique, balise réseau de mesure. Un signal qui exigerait l'un de ces
moyens est refusé, pas ajouté « juste pour la release ».

## Signaux observés

| ID | Signal | Source et preuve | Ce qu'on lit | Propriétaire | Cadence |
|---|---|---|---|---|---|
| S1 | Crash Android | Play Console → Android vitals, agrégé par version | Taux de crash sur 24 h et 7 jours, par canal | Responsable de release | J+0, J+1, J+3, J+7 |
| S2 | ANR Android | Play Console → Android vitals, agrégé par version | Taux d'ANR sur 24 h et 7 jours, par canal | Responsable de release | J+0, J+1, J+3, J+7 |
| S3 | Gate CI | GitHub Actions `ci.yml` (`make check`), `coverage`, scans secret et sécurité | Verdict du commit ou du tag, artefacts et logs du gate | Mainteneur de garde | Chaque PR, chaque push sur `main`, chaque tag |
| S4 | Rapports d'issue | Issues GitHub `bug`/`incident` et signalements `SECURITY.md` | Version, symptôme, reproductibilité, perte de données | Triage de release | Quotidien pendant la fenêtre de release |
| S5 | Intégrité des artefacts | SHA-256 de l'APK/AAB, certificat `apksigner`, digest de l'image Docker | Empreinte publiée = empreinte locale, signataire attendu | Responsable de release | Chaque publication |
| S6 | Santé serveur | `HEALTHCHECK` sur `/v1/ready` et logs locaux de l'opérateur | Prêt, erreurs 5xx et latence du déploiement | Opérateur serveur | Quotidien |

Limite assumée : un utilisateur qui installe l'APK hors store n'alimente ni S1
ni S2. Sa release ne se surveille que par S4 (rapport humain) et S5
(intégrité) ; on ne comble pas ce trou par de la télémétrie.

## Propriétaires et cadence

| Rôle | Décide de | Cadence |
|---|---|---|
| Responsable de release | Pause du déploiement, retrait, publication d'un correctif | Pré-vol, J+0, J+1, J+3, J+7, revue finale J+30 |
| Mainteneur de garde | Relance du gate, triage initial, ouverture d'une issue `incident` | Quotidien, et à chaque gate rouge |
| Opérateur serveur | Retour à l'image précédente, redémarrage, drain | Quotidien |
| Mainteneur sécurité | Retrait immédiat, avis de sécurité, rotation de clé | Immédiat sur signal de compromission |

Revue de la politique : **premier lundi du mois**. On y relit les seuils, les
signaux muets et les incidents du mois ; un seuil ne change que par un diff
visible dans ce fichier. Après chaque retrait, une revue a lieu dans les 7 jours.

## Seuils et déclencheurs

Un taux n'est un déclencheur qu'à partir de **100 sessions** sur la version et
la fenêtre considérées. En dessous, le signal est qualitatif : il alimente la
revue, il ne déclenche pas seul un retrait.

| Condition | Seuil | Action | Délai |
|---|---|---|---|
| S1 crash | ≥ 1,0 % des sessions sur 24 h | Pause du déploiement, correctif en préparation | Immédiat |
| S1 crash | ≥ 2,0 % ou crash au démarrage ou perte de données | Retrait du canal, correctif obligatoire | ≤ 24 h |
| S2 ANR | ≥ 0,5 % des sessions sur 24 h | Pause du déploiement | Immédiat |
| S2 ANR | ≥ 1,0 % des sessions sur 24 h | Retrait du canal, correctif obligatoire | ≤ 24 h |
| S3 gate | Gate rouge sur le commit taggé ou artefact non reproductible | Aucune publication ; retrait si déjà publié | Immédiat |
| S4 issues | 3 rapports indépendants du même symptôme sur la même version en 7 jours | Pause et blocage de la reprise | ≤ 24 h |
| S4 données | 2 rapports indépendants de perte de données sur la même version en 7 jours | Pause immédiate, retrait à l'étude | Immédiat |
| S4 sécurité | Faille exploitable ou clé exposée | Retrait, avis `SECURITY.md`, rotation | ≤ 1 h |
| S5 intégrité | SHA-256 ou certificat différent de la publication | Publication refusée ; retrait et avis si déjà publié | Immédiat |
| S6 serveur | 3 échecs de `/v1/ready` consécutifs ou ≥ 5 % de 5xx pendant 15 min | Retour à l'image précédente | ≤ 15 min |

## Retrait, retour arrière et reprise

**Retrait (yank)** = l'artefact n'est plus proposé au téléchargement et sa page
de release porte la mention « retiré », avec le motif et la version de
remplacement. Sur Play, on arrête le déploiement (halt rollout) ; on ne peut pas
republier un `versionCode` inférieur, donc le correctif part avec un
`versionCode` supérieur. En sideload, on retire l'APK/AAB et ses empreintes,
puis on republie la dernière version connue bonne avec ses propres empreintes.

**Retour arrière serveur** = redéploiement du digest précédent, épinglé dans
`Dockerfile.server`, jamais une reconstruction non vérifiée. Le digest et le
SHA-256 de l'artefact sont republiés ensemble.

Décision : le responsable de release prononce la pause ; le retrait exige le
responsable de release **et** le mainteneur de garde. Une compromission de clé
ou une faille exploitable exige en plus le mainteneur sécurité. Toute décision
ouvre une issue `incident` et se consigne dans [`INCIDENTS.md`](INCIDENTS.md).

**Reprise** : la version corrigée repasse sous les seuils pendant 24 h
consécutives, le gate est vert sur son commit, les empreintes sont republiées et
les rapports d'issue sont clos ou expliqués. Sans ces quatre preuves, le canal
reste en pause. Un troisième échec identique ouvre une issue `incident` et une
entrée d'invariant selon `OPERATING.md`.
