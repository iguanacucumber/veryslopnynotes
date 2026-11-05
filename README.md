<h1 align="center">veryslopnynotes</h1>

<p align="center"><strong>Ton Pronote. Ta session. Rien que toi.</strong></p>

<p align="center">
  <a href="#installer">Installer</a> ·
  <a href="#mettre-à-jour">Mettre à jour</a> ·
  <a href="#compatibilité">Compatibilité</a> ·
  <a href="#assistant-ia-et-vie-privée">IA et vie privée</a> ·
  <a href="#support-et-sécurité">Support</a> ·
  <a href="#développer">Développer</a> ·
  <a href="#licence-et-source">Licence</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: GPL-3.0-only" src="https://img.shields.io/badge/license-GPL--3.0--only-blue.svg"></a>
  <a href="shared/contracts/api.openapi.yaml"><img alt="Contracts 0.11.0" src="https://img.shields.io/badge/contracts-0.11.0-blue.svg"></a>
  <a href="https://bun.sh"><img alt="Bun 1.4.4" src="https://img.shields.io/badge/bun-1.4.4-f9f1de.svg"></a>
</p>

veryslopnynotes est un client Android open source pour Pronote, pensé pour les
élèves : notes, devoirs, emploi du temps, vie scolaire, messages, actualités,
cantine, fiches de révision et aide aux devoirs, sur le téléphone. L'app parle
**directement à l'établissement** ; aucun serveur intermédiaire ne voit la
session. La session Pronote et la clé de l'assistant sont chiffrées sur
l'appareil, et l'app reste lisible hors-ligne après une première
synchronisation.

> Projet indépendant, non affilié à Pronote / Index Éducation ni à Papillon /
> Association Papillon, ni à OpenRouter ou à un établissement. Pronote et Index
> Éducation sont des marques de leurs titulaires. Port Kotlin du protocole
> [`pronotets`](https://www.npmjs.com/package/pronotets) (MIT), à utiliser avec
> un compte autorisé et dans le cadre fixé par l'établissement.

## Installer

**Aucune release n'est publiée à ce jour** : le projet est en développement
(`versionName` `0.1.0`), et aucun APK, tag ni lien de téléchargement n'existe
encore. La page [Releases](https://github.com/iguanacucumber/veryslopnynotes/releases)
sera la seule source officielle.

Quand une release signée sera publiée, installer l'APK revient à :

1. Télécharger l'APK joint à la release, pas une copie trouvée ailleurs.
2. Vérifier le SHA-256 du fichier et l'empreinte du certificat de signature.
   La release publie les deux valeurs attendues ; `apksigner` vient des
   Build-Tools du SDK Android.

```bash
sha256sum veryslopnynotes-<version>.apk
apksigner verify --print-certs veryslopnynotes-<version>.apk
```

3. Comparer les valeurs affichées à celles de la release. Si l'une diffère,
   ne pas installer le fichier et le signaler via un Advisory privé.

Android accepte le sideload après autorisation des sources inconnues.
N'installer qu'un APK **release signé** : un APK debug n'est pas une release
officielle et ne pourra pas recevoir les mises à jour publiées. Un build release
sans clé ÉCHOUE (fail-closed) au lieu de produire un APK non publiable.

## Mettre à jour

L'app ne vérifie pas elle-même les mises à jour. Deux voies, toujours avec un
APK release signé par le même certificat :

- **Manuel** : télécharger la nouvelle release et l'installer par-dessus.
- **Obtainium (facultatif)** : ajouter l'URL du dépôt ; Obtainium interroge
  GitHub et propose les releases avec APK. Ce n'est pas un service du projet.

### Canal bêta

Les tags `vX.Y.Z-beta.N` publient une **pré-release** GitHub, signée avec la
même clé que la finale. Bêta → bêta (`N` croissant) et bêta → finale `X.Y.Z`
s'installent par-dessus l'app sans perte : la finale porte un `versionCode`
supérieur à ses bêtas. Revenir d'une finale à une bêta, ou d'une bêta à une
bêta antérieure, est un **downgrade** : Android le refuse, et désinstaller
efface les données listées ci-dessous. Ne suivre la bêta que depuis un APK
release signé, jamais depuis un APK debug.

Android refuse une mise à jour dont le certificat diffère. Ne jamais passer
d'un APK debug à un APK release par-dessus : la migration exige une
désinstallation.

### Désinstaller efface les données

**Une désinstallation efface les données locales** : session Pronote, cache,
clé OpenRouter et conversations IA, pièces jointes, préférences. Une migration
debug → release exige cette désinstallation, donc cette perte. Depuis
Réglages, exporter d'abord une copie (l'export n'est pas réimportable dans
l'app), puis ressaisir le QR/PIN et la clé.

Mise à jour sans perte : garder le même certificat. Debug → debug avec
`make updateApkToPhone` ; release → release en installant l'APK par-dessus.

## Compatibilité

- **Android 8.0+ (API 26)**, cible API 37 ; iOS, desktop et navigateur seul ne
  sont pas pris en charge.
- **WebView système Chromium 100+** (mars 2022). En dessous, l'app affiche un
  écran natif qui nomme le minimum et la version détectée, sans charger la
  WebView ni planter.
- **QR + PIN uniquement** : pas d'identifiant/mot de passe, pas de SSO d'ENT,
  pas de double authentification (MFA). L'établissement doit exposer un QR.
- **Pas de rappels ni de notifications** ; une synchronisation de fond
  silencieuse rafraîchit le cache environ toutes les 6 h.
- **Compte élève uniquement** : l'app sert un compte à la fois ; les comptes
  parent sont hors périmètre, sans accès aux enfants depuis un compte parent.

## Assistant IA et vie privée

L'assistant est **facultatif**. Sans consentement explicite (versionné) et
sans clé, aucun appel n'est fait. L'écran demande aussi une attestation :
18 ans ou plus, ou autorisation du représentant légal avec un compte
OpenRouter géré par un adulte.

- **Ta clé, ton compte** : la clé OpenRouter est stockée chiffrée sur
  l'appareil et envoyée directement à OpenRouter, jamais à un serveur du
  projet. Chaque demande consomme tes crédits OpenRouter et peut être
  facturée.
- **Ce qui peut partir** : question, cours, extraits de manuel ou de page,
  pièces jointes, photos et historique du fil, selon l'aperçu de consentement.
  Les messages Pronote ne font pas partie des sources IA.
- **Limites** : OpenRouter et les fournisseurs qu'il route peuvent conserver
  les demandes selon leurs politiques ; l'app ne peut le garantir. Une
  réponse peut être fausse, incomplète ou inventée. Elle est traitée comme
  une donnée : aucun envoi, aucune validation et aucune modification ne se
  font sans ton geste.
- **Local** : les données scolaires ne passent par un serveur du projet ni
  par un relais ; la session reste sur l'appareil. Pas de compte chez le
  projet, pas de publicité, pas de télémétrie, pas de rapport de crash
  automatique. Les données de compte se purgent à la déconnexion ; « Supprimer
  toutes mes données » emporte aussi le consentement IA, l'adresse du scraper
  et les exports.
- **Flux réseau** : l'app contacte l'établissement, OpenRouter seulement si tu
  utilises l'IA, et le scraper facultatif si tu le configures. GitHub sert au
  téléchargement d'une release, pas à l'app.

Le scraper de manuels est un serveur séparé, facultatif, à garder sur la boucle
locale ou derrière un proxy authentifié : [`server/README.md`](server/README.md).

## Support et sécurité

Le support passe **uniquement par GitHub Issues** : question d'usage, bug,
incompatibilité ou demande d'accessibilité. Aucun courriel, chat ou message
privé n'est publié. Une issue est publique : n'y mets jamais de donnée
scolaire, de QR/PIN, de session, de clé ni de capture non caviardée. Le
diagnostic exporté (Réglages → Aide) aide sans contenu scolaire.

- **Support, accessibilité et problèmes connus** :
  [ouvrir une issue](https://github.com/iguanacucumber/veryslopnynotes/issues/new/choose).
- **Faille de sécurité ou secret exposé** : jamais une issue publique ; passe
  par les [GitHub Security Advisories](https://github.com/iguanacucumber/veryslopnynotes/security/advisories/new).
  Le projet ne publie ni courriel, ni clé PGP, ni `security.txt`.

## Développer

Prérequis : **Bun 1.4.4** ; **JDK 17–21** + **SDK Android 37** pour l'APK ;
**`kotlinc`** et un `java` dans le `PATH` pour la parité TS ↔ Kotlin. Sans cet
outillage, `make check` échoue : le gate ne simule pas un vert. `make
check-fast` saute `android-compile` et `audit` — boucle interne, pas une
preuve avant PR.

```bash
bun install
bun run dev:web       # interface + pont factice, sans téléphone
make check            # gate complet
make buildDebugApk    # APK debug
make updateApkToPhone # installe le debug en conservant les données
make buildRelApk      # APK release signé (clé hors dépôt requise, échec sans clé)
```

Parcours agent et gate : [`AGENTS.md`](AGENTS.md),
[`docs/architecture/BUILD.md`](docs/architecture/BUILD.md). Modules :
[`android/README.md`](android/README.md), [`web/README.md`](web/README.md),
[`server/README.md`](server/README.md). Carte des docs et invariants
(I1–I36) : [`docs/CONTEXT.md`](docs/CONTEXT.md),
[`docs/architecture/INVARIANTS.md`](docs/architecture/INVARIANTS.md).

## Licence et source

Code et contributions sous **GPL-3.0-only** ; le code source complet est ce
dépôt public, sans composant propriétaire. Voir [`LICENSE`](LICENSE) et
[ADR-008](docs/adr/008-relicense-gpl.md). Le port du protocole Pronote est
crédité à `pronotets` (MIT) ; les règles et conventions reprises de Papillon
(GPL-3.0, Association Papillon) restent créditées à leurs auteurs, sans
affiliation. Notices tierces : [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

<!-- vim: set tw=80: -->
