# Dérogations de release

> **Aucune dérogation n'est approuvée dans ce document.** Les lignes `to-waive`
> sont des **propositions, non approuvées** : elles décrivent un risque et une
> atténuation pour permettre une décision humaine, elles ne remplacent ni une
> clôture d'issue, ni le gate, ni le sign-off juridique.

Constat initial : **2026-11-04**, sur `origin/main` `c9dfc0d`. Dernière
vérification : **2026-11-05**, sur `origin/main` `9b2e172`, avec les états
GitHub et PR consultés le même jour. L'état des issues change : revérifier
chaque lien et chaque statut avant une approbation ou un tag. Ce document ne
clôt aucune issue et ne marque aucun gate comme satisfait.

## Politique de dérogation

Une dérogation est une acceptation écrite et bornée d'un critère de clôture non
satisfait. Elle ne vaut que pour l'issue, la release et la date qu'elle nomme.
Elle ne crée aucune preuve à la place du travail absent.

### Qui peut approuver

- Une dérogation `tier:B` exige **deux signatures humaines distinctes** : le
  **responsable de release** et le **mainteneur de garde**, rôles définis dans
  [`RELEASE-HEALTH.md`](RELEASE-HEALTH.md). La même personne ne signe pas les
  deux.
- Le demandeur, l'auteur de la PR et un agent ne peuvent ni approuver leur propre
  dérogation ni signer à la place d'un humain.
- Une dérogation qui touche licence, attribution ou droit d'auteur exige en plus
  un **avis écrit du conseil**, archivé selon
  [`legal/SIGNOFF.md`](legal/SIGNOFF.md).
- Une dérogation qui touche la sécurité exige aussi le **mainteneur sécurité**.
  Cette signature ne lève jamais l'interdiction ci-dessous.
- Sans les signatures requises, la ligne reste `to-waive` et ne compte pas pour
  G4.

### Champs obligatoires

Chaque proposition porte les champs `risk`, `mitigation`, `owner` et `expiry`,
plus la preuve, dans cet ordre :

| Champ | Contenu exigé |
|---|---|
| `Risque` | impact concret pour l'utilisateur, les données, la légalité ou la release ; gravité et scénario d'échec |
| `Atténuation` | contrôle compensatoire vérifiable, avec la preuve qui sera jointe au tag |
| `Propriétaire` | humain nommé, responsable de l'atténuation et de la clôture |
| `Expiration` | date calendaire **et** borne de release ; la première des deux s'applique |
| `Preuve` | liens vers l'issue, la PR, le run, le document ou l'artefact qui prouve l'état |

Un champ vide, `TBD`, `à définir` ou une date absente rend la proposition
incomplète et donc refusée. Une approbation sans preuve archivée n'existe pas.

### Interdictions

- **Aucune dérogation `tier:L`.** G4 exige la clôture de chaque issue `tier:L` ;
  une dérogation ne remplace jamais cette clôture et ne peut pas être accordée
  avant ou après G4.
- **Aucune dérogation pour une violation de sécurité, une perte de données ou
  une revendication de confidentialité** (`privacy claim`) : clé exposée, purge
  incomplète, consentement manquant, notice qui affirme un fait faux, contrôleur
  ou contact inventé. Ces sujets se corrigent, ils ne se dérogent pas.
- **Aucune dérogation pour le sign-off juridique** [`#976`](https://github.com/iguanacucumber/veryslopnynotes/issues/976)
  ni pour la règle de lancement de [`#982`](https://github.com/iguanacucumber/veryslopnynotes/issues/982).
- **Aucune dérogation au gate** `make check`, à un invariant ou à une loi
  d'[`AGENTS.md`](../AGENTS.md). Un gate rouge reste rouge.
- Une dérogation n'est jamais rétroactive. Une dérogation expirée rouvre le
  blocage et interdit le tag ou la release suivante jusqu'à clôture ou
  renouvellement écrit.

### Effet et durée

Une dérogation approuvée permet à G4 de compter l'issue comme traitée, sans la
fermer. L'issue reste ouverte comme trace ; elle est close quand le travail est
fait, ou reste ouverte avec la dérogation expirée. Le renouvellement reprend les
mêmes champs et les mêmes signatures ; il n'est pas tacite.

Toute dérogation est publique dans ce fichier. Aucun secret, aucune adresse
privée et aucune donnée scolaire n'y figurent.

## Règle de lancement (#982)

Règle reprise de [`#982`](https://github.com/iguanacucumber/veryslopnynotes/issues/982) :

> Aucun tag public `v1.0.0` tant que chaque issue `tier:L` n'est pas close, que
> l'APK signé ne se vérifie pas sur un appareil propre, et que le sign-off
> juridique n'est pas archivé.

G4 exige en outre que chaque `tier:B` soit **close ou dérogée dans ce fichier**
avec risque, atténuation et propriétaire. Ce document prépare cette décision ; il
ne déclare ni G0, ni G1, ni G3, ni G4 satisfaits.

## Décision par blocage

Statuts autorisés :

- `open` : aucun travail suffisant et aucune dérogation approuvée ;
- `to-waive` : proposition écrite ci-dessous, **non approuvée** ;
- `closed` : issue close avec une preuve liée.

Vérifié le **2026-11-05** : les blocages clos [#827](https://github.com/iguanacucumber/veryslopnynotes/issues/827), [#828](https://github.com/iguanacucumber/veryslopnynotes/issues/828), [#919](https://github.com/iguanacucumber/veryslopnynotes/issues/919) (PR [#1155](https://github.com/iguanacucumber/veryslopnynotes/pull/1155)), [#936](https://github.com/iguanacucumber/veryslopnynotes/issues/936) et [#956](https://github.com/iguanacucumber/veryslopnynotes/issues/956) sont retirés des tableaux ; leurs preuves restent dans l'historique Git et les issues. La checklist de publication est mergée ([PR #1138](https://github.com/iguanacucumber/veryslopnynotes/pull/1138), [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md)) mais reste **à remplir et signer par deux humains pour v1.0** : sa clôture ne vaut pas preuve de release. Les deux lignes `to-waive` restent des **propositions non approuvées**.

### Bloqueurs `tier:B`

| ID | Sujet | Statut | Risque | Atténuation | Propriétaire | Expiration | Preuve |
|---|---|---|---|---|---|---|---|
| [#831](https://github.com/iguanacucumber/veryslopnynotes/issues/831) | Responsable du traitement et contact vie privée | `open` | Notice publiée sans responsable ni contact : revendication de confidentialité non vérifiable. **Non dérogeable.** | Aucune : choisir l'entité et le contact dans le dossier, puis mettre à jour `PRIVACY.md` et le sign-off. | `iguanacucumber` + conseil | — | [CONTROLLER.md](legal/CONTROLLER.md), PR [#1147](https://github.com/iguanacucumber/veryslopnynotes/pull/1147), [PRIVACY.md](../PRIVACY.md) §1 et §15, [SIGNOFF.md](legal/SIGNOFF.md) §2 |
| [#838](https://github.com/iguanacucumber/veryslopnynotes/issues/838) | Audit des fichiers dérivés de Papillon et attribution | `to-waive` | Inventaire incomplet : attribution GPL incertaine et risque de contestation à la distribution. | Voie de relicence de [#827](https://github.com/iguanacucumber/veryslopnynotes/issues/827) close ; `ADR-008`, `RELICENSING.md` et `THIRD_PARTY_NOTICES.md` restent la base ; avis écrit du conseil sur le périmètre manquant avant le tag ; aucune release binaire sans cet avis. | `iguanacucumber` | `2026-12-31` ou tag `v1.0.0`, au premier des deux | [ADR-008](adr/008-relicense-gpl.md), [RELICENSING.md](legal/RELICENSING.md), [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md), [SIGNOFF.md](legal/SIGNOFF.md) §1 |
| [#928](https://github.com/iguanacucumber/veryslopnynotes/issues/928) | Assertions CI sur l'artefact de release | `to-waive` | Une assertion manquante peut laisser passer un certificat debug, une notice absente, un secret embarqué, une permission inattendue ou une version incohérente. | Vérifications manuelles consignées dans la checklist de [`#956`](https://github.com/iguanacucumber/veryslopnynotes/issues/956), mergée : `apksigner`, notices GPL, scan secret, permissions, version. Aucun tag sans checklist remplie **et signée par deux humains**. | `iguanacucumber` | `2026-12-31` ou tag `v1.0.0`, au premier des deux | [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md), [release-artifact.yml](../.github/workflows/release-artifact.yml), PR [#1138](https://github.com/iguanacucumber/veryslopnynotes/pull/1138) |
| [#972](https://github.com/iguanacucumber/veryslopnynotes/issues/972) | Ce document et la clôture des bloqueurs | `open` | Le processus de dérogation ne peut pas se déroger lui-même ; les `tier:L` [#965](https://github.com/iguanacucumber/veryslopnynotes/issues/965) et [#969](https://github.com/iguanacucumber/veryslopnynotes/issues/969) restent ouverts. | Ce fichier consigne l'état vérifié ; l'issue reste ouverte jusqu'à la clôture des `tier:L`. | `iguanacucumber` | — | Ce fichier, [#982](https://github.com/iguanacucumber/veryslopnynotes/issues/982) |
| [#976](https://github.com/iguanacucumber/veryslopnynotes/issues/976) | Sign-off juridique et vie privée | `open` | Signature juridique absente : lancement interdit par la règle de #982. **Non dérogeable.** | Aucune : le dossier [SIGNOFF.md](legal/SIGNOFF.md) doit passer de `pending` à `signed` avec preuve archivée. | `iguanacucumber` + conseil | — | [SIGNOFF.md](legal/SIGNOFF.md), PR [#1141](https://github.com/iguanacucumber/veryslopnynotes/pull/1141) |
| [#978](https://github.com/iguanacucumber/veryslopnynotes/issues/978) | Tag `v1.0.0` et annonce | `open` | L'acte de publication lui-même ne se déroge pas ; il reste bloqué par les lignes ci-dessus. | Aucune : exécuter le tag et l'annonce après G4. | `iguanacucumber` | — | [RELEASE-ANNOUNCEMENT.md](RELEASE-ANNOUNCEMENT.md), [#982](https://github.com/iguanacucumber/veryslopnynotes/issues/982) |

### Bloqueurs `tier:L` — non dérogeables

Aucune ligne de ce tableau ne peut passer `to-waive`. G4 exige leur clôture.

| ID | Sujet | Statut | Preuve / état constaté |
|---|---|---|---|
| [#965](https://github.com/iguanacucumber/veryslopnynotes/issues/965) | Dogfood interne de deux semaines | `open` | Protocole [DOGFOOD.md](DOGFOOD.md) mergé (PR [#1144](https://github.com/iguanacucumber/veryslopnynotes/pull/1144)) ; aucun run, journal ni checklist signée : aucun résultat n'est revendiqué. |
| [#969](https://github.com/iguanacucumber/veryslopnynotes/issues/969) | Bêta privée par tag pré-release | `open` | Kit [BETA.md](BETA.md) mergé (PR [#1143](https://github.com/iguanacucumber/veryslopnynotes/pull/1143)) et canal [#936](https://github.com/iguanacucumber/veryslopnynotes/issues/936) clos ; aucun tag, release bêta ni participant réel, donc la bêta n'a pas eu lieu. |

## Approbations

Les blocs ci-dessous restent **vides**. Ils ne sont remplis qu'après décision
écrite, avec les deux signatures requises et la preuve archivée. Un agent ne
remplit aucun champ.

### Dérogation proposée #838 — inventaire Papillon

- Statut : **proposée, non approuvée**
- Décision : [ ] approuvée  [ ] refusée
- Responsable de release — nom : ______________________ date : __________
- Mainteneur de garde — nom : ______________________ date : __________
- Avis du conseil (licence) — nom : ______________________ date : __________
- Portée approuvée : ______________________________________________________
- Preuve archivée (PR, issue, run) : _____________________________________
- Expiration confirmée : _________________________________________________

### Dérogation proposée #928 — assertions de l'artefact

- Statut : **proposée, non approuvée**
- Décision : [ ] approuvée  [ ] refusée
- Responsable de release — nom : ______________________ date : __________
- Mainteneur de garde — nom : ______________________ date : __________
- Mainteneur sécurité — nom : ______________________ date : __________
- Portée approuvée : ______________________________________________________
- Preuve archivée (checklist signée, PR, run) : ___________________________
- Expiration confirmée : _________________________________________________

## Mise à jour

Toute approbation, expiration ou clôture se fait par PR visible : mettre le
statut à jour, lier la preuve, puis retirer ou renouveler le bloc d'approbation.
Une dérogation expirée reste dans l'historique du fichier ; elle ne disparaît
pas silencieusement.
