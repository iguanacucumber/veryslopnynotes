# Annonce de release v1.0.0

> **Brouillon — aucune release n'est publiée par ce document.** Il prépare le
> texte de l'annonce et les notes de version de `v1.0.0`, sans créer de tag, de
> GitHub Release, de checksum, d'empreinte ni d'URL de release. Les valeurs
> entre chevrons (`<…>`) sont des **placeholders** : tant qu'il en reste un, le
> texte n'est pas publiable. L'issue [#978](https://github.com/iguanacucumber/veryslopnynotes/issues/978)
> reste ouverte tant que la page de release signée n'existe pas réellement et
> n'a pas été vérifiée.

## Statut et mode d'emploi

La version visée est `1.0.0` ; le tag attendu est `v1.0.0`. Aucun tag ni aucune
release ne doivent être supposés existants tant que les valeurs de publication
ne sont pas remplies. Le texte ci-dessous ne devient publiable qu'après la
checklist signée de `docs/RELEASE-CHECKLIST.md` (#956,
PR [#1138](https://github.com/iguanacucumber/veryslopnynotes/pull/1138)), le
sign-off juridique de [#976](https://github.com/iguanacucumber/veryslopnynotes/issues/976)
et la clôture des bloqueurs de [#972](https://github.com/iguanacucumber/veryslopnynotes/issues/972).
La règle de lancement de [#982](https://github.com/iguanacucumber/veryslopnynotes/issues/982)
s'applique sans exception.

1. Remplir le tableau « Valeurs de publication » avec les valeurs réellement
   publiées, jamais avec une valeur déduite ou recopiée d'un APK tiers.
2. Relire chaque affirmation contre le code, le `CHANGELOG.md` et la page de
   release générée par `.github/workflows/release.yml`.
3. Cocher la checklist avec une preuve liée (run, issue, PR, fichier
   téléchargé). Une case cochée sans preuve ne compte pas.
4. Publier l'annonce seulement si la section « Ne pas annoncer si » est vide.

## Annonce prête à publier

### VerySlopyNyNotes 1.0.0

VerySlopyNyNotes est un client Android open source pour Pronote. L'app parle
**directement à l'établissement depuis le téléphone** : aucun serveur du projet
ne reçoit la session scolaire ni la clé OpenRouter. Les données scolaires, le
cache, les fiches et les pièces jointes restent sur l'appareil.

Cette première version stable rassemble le client Android, l'interface React
embarquée, la session locale par QR + PIN, la consultation hors-ligne et
l'assistant IA facultatif. Le serveur du dépôt reste optionnel : il ne sert
qu'au scraper de manuels.

### Limites à connaître avant d'installer

- **Android 8.0 ou plus (API 26), WebView système Chromium 100 ou plus
  récente.** iOS, desktop et navigateur seul ne sont pas pris en charge.
- **QR + PIN uniquement.** Pas d'identifiant/mot de passe, pas de SSO d'ENT,
  pas de double authentification (MFA) et aucun contournement : l'établissement
  doit exposer un QR compatible. Un compte protégé par une vérification
  supplémentaire ne peut pas être appairé.
- **Un compte élève à la fois.** Les comptes parent, l'accès aux enfants depuis
  un compte parent et la gestion de plusieurs comptes simultanés sont hors
  périmètre.
- **Pas de rappels ni de notifications.** Une synchronisation de fond
  silencieuse rafraîchit notes, devoirs et emploi du temps environ toutes les
  6 h ; il n'y a ni push, ni alerte, ni notification en temps réel.
- **Assistant IA facultatif, avec ton compte et ta clé OpenRouter.** Sans
  consentement explicite versionné et sans clé, aucun appel n'est fait. Chaque
  demande consomme tes crédits OpenRouter et peut être facturée. OpenRouter et
  les fournisseurs qu'il route peuvent conserver les demandes selon leurs
  politiques ; l'app ne peut ni le garantir ni l'empêcher. Une réponse peut
  être fausse, incomplète ou inventée : elle ne remplace jamais un cours, une
  note ou une décision de l'établissement.
- **Aucune télémétrie.** L'APK n'embarque ni SDK d'analytics, ni rapport de
  crash, ni identifiant d'installation, ni journal automatique. Le projet ne
  reçoit aucune donnée scolaire. GitHub peut journaliser les téléchargements
  selon sa propre politique ; ce n'est pas une mesure embarquée.
- **Projet indépendant, non affilié à Pronote / Index Éducation ni à Papillon /
  Association Papillon**, ni à OpenRouter ou à un établissement. Pronote et
  Index Éducation sont des marques de leurs titulaires respectifs. Le projet
  n'est ni édité, ni approuvé, ni parrainé par ces services.
- **Une désinstallation efface les données locales** : session Pronote, cache,
  clé OpenRouter et conversations IA, pièces jointes, préférences. Une migration
  debug → release exige une désinstallation, donc cette perte. L'export proposé
  dans les réglages sert de copie, pas de restauration dans l'app.

### Installer, vérifier et mettre à jour

Télécharger **uniquement** depuis la page
[Releases](https://github.com/iguanacucumber/veryslopnynotes/releases) du dépôt,
le jour où la version y est réellement publiée. Ne jamais installer un APK
trouvé sur un miroir, dans une pièce jointe ou dans un artifact CI non publié.

La release joint l'APK, `SHA256SUMS`, `mapping.txt`, `seeds.txt` et l'archive
source. Vérifier avant d'installer :

```sh
sha256sum -c SHA256SUMS
apksigner verify --print-certs veryslopnynotes-<version>.apk
```

Comparer le SHA-256 affiché à `<sha256-apk>` et l'empreinte du certificat à
`<empreinte-certificat>` (normalisée : sans `:`, en minuscules). Si l'une
diffère, ne pas installer le fichier et le signaler via un Advisory privé.

- **Installation** : autoriser l'installation depuis une source inconnue, puis
  installer l'APK. Aucun store n'est requis ; l'app ne vérifie pas elle-même
  les mises à jour.
- **Mise à jour release → release** : installer le nouvel APK par-dessus
  l'ancien, avec le **même certificat**. Les données locales sont conservées.
- **Bêta → finale** : installer la finale `vX.Y.Z` par-dessus la dernière bêta,
  sans désinstaller ; son `versionCode` est supérieur.
- **Debug → release** : certificats différents, donc désinstallation
  obligatoire et perte des données. Exporter d'abord depuis les réglages, puis
  ressaisir le QR/PIN et la clé.
- **Downgrade interdit** : Android refuse une version inférieure. Revenir en
  arrière exige une désinstallation, donc la perte des données.
- **Obtainium (facultatif)** : suivre la page Releases avec APK. Ce n'est pas
  un service du projet et l'app ne fait aucun appel de mise à jour.

### Source, licence et vérification du code

Le code est distribué sous **GPL-3.0-only** : voir
[LICENSE](https://github.com/iguanacucumber/veryslopnynotes/blob/main/LICENSE) et
[THIRD_PARTY_NOTICES.md](https://github.com/iguanacucumber/veryslopnynotes/blob/main/THIRD_PARTY_NOTICES.md).
La page de release pointe le tag exact, l'archive source jointe et l'archive
`archive/refs/tags/<tag>.tar.gz` ; l'offre de source reste accessible tant que
l'APK est proposé. Le dépôt public est la source correspondante :
<https://github.com/iguanacucumber/veryslopnynotes>.

### Vie privée, support et sécurité

- **Confidentialité** :
  [PRIVACY.md](https://github.com/iguanacucumber/veryslopnynotes/blob/main/PRIVACY.md)
  décrit les flux réseau, la rétention locale, les destinataires et les droits.
  L'assistant IA ne part qu'après consentement et ne reçoit jamais les messages
  Pronote.
- **Conditions** :
  [TERMS.md](https://github.com/iguanacucumber/veryslopnynotes/blob/main/TERMS.md).
  La licence du code reste GPL-3.0-only et n'est pas restreinte par ces
  conditions.
- **Support** : **GitHub Issues uniquement**, via
  [docs/SUPPORT.md](https://github.com/iguanacucumber/veryslopnynotes/blob/main/docs/SUPPORT.md).
  Aucun courriel, formulaire, chat ou message privé n'est publié. Une issue est
  publique : ne jamais y mettre de donnée scolaire, de QR/PIN, de jeton, de clé
  OpenRouter ou de capture non caviardée.
- **Sécurité** : une faille exploitable, un secret exposé ou une fuite de
  données passe par un [Advisory privé](https://github.com/iguanacucumber/veryslopnynotes/security/advisories/new),
  jamais par une issue publique. Voir
  [SECURITY.md](https://github.com/iguanacucumber/veryslopnynotes/blob/main/SECURITY.md).
- **Problèmes connus** : lire l'issue épinglée `[known-issues] <tag>` et
  [docs/COMPATIBILITY.md](https://github.com/iguanacucumber/veryslopnynotes/blob/main/docs/COMPATIBILITY.md)
  avant d'ouvrir un doublon.

### Valeurs de publication

| Élément | Valeur à remplir après publication |
|---|---|
| Tag publié | `<tag>` — doit être `v1.0.0` et pointer sur le commit vérifié |
| Date de publication | `<AAAA-MM-JJ>` |
| URL de la GitHub Release | `<url-release>` |
| APK | `veryslopnynotes-<version>.apk` |
| SHA-256 de l'APK | `<sha256-apk>` |
| Empreinte SHA-256 du certificat | `<empreinte-certificat>` — normalisée |

Une valeur absente, inventée ou reprise d'un autre fichier bloque la
publication. Le SHA-256 du fichier et l'empreinte du certificat sont deux
preuves distinctes : le premier prouve le téléchargement, la seconde l'identité
du signataire.

## Notes de version (modèle GitHub)

Le workflow `.github/workflows/release.yml` publie le corps de la GitHub
Release à partir de la section `## [<version>]` de `CHANGELOG.md`, puis ajoute
les liens source et le bloc `SHA256SUMS`. Le modèle ci-dessous sert à relire ce
corps ; il ne remplace pas le `CHANGELOG.md` et ne se publie pas à la main.

```markdown
## Very Slop Notes <version>

<résumé en une ou deux phrases, sans promesse absente du code>

### Points importants

- <changement visible 1>
- <changement visible 2>

### Limites

- Pas de rappels ni de notifications ; synchronisation de fond silencieuse.
- QR + PIN uniquement, un compte élève à la fois ; MFA non prise en charge.
- Assistant IA facultatif, clé OpenRouter personnelle, crédits facturables.
- Aucune télémétrie embarquée ; support et sécurité via GitHub uniquement.
- Projet indépendant, non affilié à Pronote / Index Éducation ni à Papillon.

### Vérification

- APK : `veryslopnynotes-<version>.apk`
- SHA-256 : `<sha256-apk>`
- Certificat : `<empreinte-certificat>`
- `SHA256SUMS` : joint ; `sha256sum -c SHA256SUMS` doit réussir.
- `apksigner verify --print-certs` doit afficher le certificat ci-dessus, jamais
  `CN=Android Debug`.

### Installation et mise à jour

Installer l'APK depuis cette page. Une mise à jour release → release s'installe
par-dessus avec le même certificat ; debug → release exige une désinstallation
et efface les données locales. Le downgrade n'est pas pris en charge.

### Source (GPL-3.0-only)

- Dépôt : https://github.com/iguanacucumber/veryslopnynotes
- Tag exact : `<tag>`
- Archive source jointe : `veryslopnynotes-<version>-source.tar.gz`
- Licence : GPL-3.0-only (`LICENSE`), notices tierces dans
  `THIRD_PARTY_NOTICES.md`.

### Problèmes connus

Issue épinglée `[known-issues] <tag>`, label `bug`.
```

## Checklist avant publication

La checklist signée `docs/RELEASE-CHECKLIST.md` (#956) est l'autorité : ses
16 sections, leurs champs propriétaire/date/preuve et sa règle « Ne pas livrer
si » doivent être complets avant de reprendre ce texte. Ce kit ne duplique pas
ses preuves ; il ajoute les contrôles propres à l'annonce.

- [ ] `docs/RELEASE-CHECKLIST.md` existe, est la version signée, et chaque étape
      porte un propriétaire, une date et une preuve liée.
- [ ] [#976](https://github.com/iguanacucumber/veryslopnynotes/issues/976) :
      `docs/legal/SIGNOFF.md` ne contient plus aucun `pending` ; la copie
      signée est archivée et la revue juridique est close.
- [ ] [#972](https://github.com/iguanacucumber/veryslopnynotes/issues/972) :
      chaque issue `tier:L` est close ; chaque issue `tier:B` est close ou
      dérogée dans `docs/RELEASE-WAIVERS.md`, avec deux signatures humaines
      distinctes, risque, atténuation, propriétaire, expiration et preuve.
      Aucune dérogation expirée.
- [ ] [#969](https://github.com/iguanacucumber/veryslopnynotes/issues/969) :
      la bêta privée a eu lieu, l'issue est close et l'issue
      `[known-issues]` de la version est tenue à jour.
- [ ] [#982](https://github.com/iguanacucumber/veryslopnynotes/issues/982) :
      la règle de lancement est satisfaite ; aucun `tier:L` n'est encore ouvert.
- [ ] `make check` est vert sur le commit qui portera le tag ; les jobs
      `release-artifact`, `licenses` et `apk-size` sont verts.
- [ ] `CHANGELOG.md` : `## [Unreleased]` a été renommé
      `## [<version>] - <AAAA-MM-JJ>`, un nouveau `[Unreleased]` vide existe, et
      la section correspond exactement aux notes relues.
- [ ] Le tag `<tag>` est créé sur le commit vérifié, poussé une seule fois, et
      `release.yml` calcule la même version que le tag.
- [ ] L'environnement `release` a été approuvé ; les quatre secrets de signature
      sont présents ; le workflow n'a utilisé aucun repli debug.
- [ ] La page de GitHub Release est réellement publiée avec l'APK,
      `SHA256SUMS`, l'archive source, `mapping.txt` et `seeds.txt`.
- [ ] L'APK téléchargé depuis cette page passe `sha256sum -c SHA256SUMS` et
      `apksigner verify --print-certs` ; son certificat n'est pas
      `CN=Android Debug` et son empreinte est `<empreinte-certificat>`.
- [ ] Le SHA-256 de l'APK téléchargé est `<sha256-apk>` ; les valeurs de
      `SHA256SUMS` sont identiques à celles affichées sur la page.
- [ ] L'archive source jointe contient `LICENSE` et le code du tag exact ;
      l'offre de source est accessible.
- [ ] Une installation propre sur un appareil Android 8.0+ avec WebView
      Chromium 100+ a été vérifiée, ainsi qu'une mise à jour release → release
      sans désinstallation.
- [ ] Les valeurs de publication sont remplies : tag, date, URL, SHA-256,
      empreinte. Aucun `<…>` ne reste dans le texte publié.
- [ ] L'annonce reprend les limites réelles (rappels, IA, QR/compte,
      télémétrie, non-affiliation) et ne promet rien qui ne soit pas dans le
      code ou le `CHANGELOG.md`.
- [ ] Aucun secret, aucune donnée scolaire, aucun nom d'établissement, aucun QR
      ni PIN ne figure dans l'annonce, les notes ou les captures.
- [ ] Les liens confidentialité, conditions, support et sécurité répondent et
      pointent vers la version publiée.
- [ ] [#978](https://github.com/iguanacucumber/veryslopnynotes/issues/978) reste
      ouvert jusqu'à ce que la page de release signée soit vérifiée ; sa
      clôture exige le lien de la page et la preuve de vérification.

## Ne pas annoncer si

- Le sign-off juridique de [#976](https://github.com/iguanacucumber/veryslopnynotes/issues/976)
  n'est pas archivé, ou `docs/legal/SIGNOFF.md` contient encore `pending`.
- Un `tier:L` de [#972](https://github.com/iguanacucumber/veryslopnynotes/issues/972)
  est ouvert, ou un `tier:B` n'est ni clos ni dérogé avec les deux signatures,
  les champs obligatoires et une preuve. Une dérogation expirée ne compte pas.
- `docs/RELEASE-CHECKLIST.md` est absent, non signé, incomplet, ou une étape
  n'a ni propriétaire, ni date, ni preuve.
- La bêta privée [#969](https://github.com/iguanacucumber/veryslopnynotes/issues/969)
  n'a pas eu lieu ; l'absence de retour n'est pas une preuve de succès.
- Il n'existe pas de **page de release GitHub réelle et signée**. Un tag local,
  un brouillon de release, un artifact CI ou un APK envoyé en pièce jointe ne
  compte pas.
- `release.yml` est rouge, l'environnement `release` n'a pas été approuvé, un
  secret de signature manque, ou le certificat est `CN=Android Debug`.
- `SHA256SUMS` est absent, `sha256sum -c` échoue, ou le SHA-256 de l'APK
  publié diffère de `<sha256-apk>`.
- L'empreinte du certificat de l'APK téléchargé diffère de
  `<empreinte-certificat>`, ou aucune empreinte n'a été publiée.
- Le tag est absent, déplacé, poussé sur un autre commit, ou la version
  calculée ne correspond pas au tag.
- `CHANGELOG.md` n'a pas de section `## [<version>] - <AAAA-MM-JJ>` ou les
  notes publiées ne correspondent pas à cette section.
- Une valeur `<…>` reste dans le texte, ou une date, un checksum, une empreinte,
  un tag ou une URL de release a été inventé.
- Une vérification sur appareil propre ou une mise à jour release → release
  n'a pas été faite.
- Un défaut P0, une perte de données ou une faille de sécurité connu reste
  ouvert sans correctif ni issue `known-issues` décrivant le contournement.
- L'annonce contient une donnée scolaire, un secret, un nom d'établissement,
  une capture non caviardée ou une promesse absente du code.
- La page de release ou l'annonce présentent comme officiel un service de
  Pronote, d'Index Éducation, de Papillon ou d'OpenRouter.

## Liens du kit

- Procédure de release et build : [`RELEASE.md`](RELEASE.md)
- Clé, signature et empreintes : [`SIGNING.md`](SIGNING.md)
- Dérogations et bloqueurs : [`RELEASE-WAIVERS.md`](RELEASE-WAIVERS.md)
- Checklist signée (à merger) : `docs/RELEASE-CHECKLIST.md` (#956)
- Bêta privée et sortie vers la finale : [`BETA.md`](BETA.md)
- Santé de release, signaux et retrait : [`RELEASE-HEALTH.md`](RELEASE-HEALTH.md)
- Support et problèmes connus : [`SUPPORT.md`](SUPPORT.md)
- Compatibilité : [`COMPATIBILITY.md`](COMPATIBILITY.md)
- Confidentialité : [`PRIVACY.md`](../PRIVACY.md)
- Conditions : [`TERMS.md`](../TERMS.md)
- Sécurité : [`SECURITY.md`](../SECURITY.md)
- Licence et notices : [`LICENSE`](../LICENSE),
  [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md)
