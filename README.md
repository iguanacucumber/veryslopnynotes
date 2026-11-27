<p align="center">
  <img src="android/artwork/ic_launcher_512.png" alt="Icône de veryslopnynotes" width="88">
</p>

<h1 align="center">veryslopnynotes</h1>

<p align="center"><strong>Ton Pronote. Ta session. Rien que toi.</strong></p>

<p align="center">
  <a href="LICENSE"><img alt="Licence : GPL-3.0-only" src="https://img.shields.io/badge/license-GPL--3.0--only-blue.svg"></a>
  <a href="shared/contracts/api.openapi.yaml"><img alt="Contracts 0.11.0" src="https://img.shields.io/badge/contracts-0.11.0-blue.svg"></a>
  <a href="https://bun.sh"><img alt="Bun 1.4.4" src="https://img.shields.io/badge/bun-1.4.4-f9f1de.svg"></a>
  <img alt="Android 8.0+" src="https://img.shields.io/badge/Android-8.0%2B-3DDC84?logo=android&logoColor=white">
</p>

<p align="center">
  <a href="#installer">Installer</a> ·
  <a href="#compatibilité">Compatibilité</a> ·
  <a href="#assistant-ia-et-vie-privée">IA et vie privée</a> ·
  <a href="#développer">Développer</a>
</p>

Un client Android open source pour Pronote, côté élève. L'app parle
directement à l'établissement : aucun serveur intermédiaire ne voit la
session. Après une première synchronisation, elle reste lisible hors ligne.

> **Pas encore de release.** Le projet est en développement
> (`versionName` `0.1.0`). Aucun APK, tag ni lien de téléchargement n'existe
> aujourd'hui. La page [Releases](https://github.com/iguanacucumber/veryslopnynotes/releases)
> sera la seule source officielle.

## Fonctionnalités

| Fonction | Détail |
|---|---|
| **Notes** | moyennes, notes par matière, évolution |
| **Devoirs** | cahier de textes, tâches, pièces jointes |
| **Emploi du temps** | cours, salles, professeurs |
| **Vie scolaire** | absences, retards, sanctions |
| **Messages** | fils avec l'établissement, actualités |
| **Cantine** | menus |
| **Révisions** | fiches de révision, aide aux devoirs avec l'IA |

## Installer

Quand une version signée sera publiée :

1. Télécharge l'APK joint à la release, pas une copie trouvée ailleurs.
2. Vérifie le SHA-256 du fichier et l'empreinte du certificat de signature :

```bash
sha256sum veryslopnynotes-<version>.apk
apksigner verify --print-certs veryslopnynotes-<version>.apk
```

3. Compare les valeurs affichées avec celles de la release. Si l'une diffère,
   n'installe pas le fichier et signale-le via un Advisory privé.

Android demande d'autoriser les sources inconnues. N'installe qu'un APK
**release signé** : un APK debug n'est pas une release et ne recevra pas les
mises à jour publiées. Un build release sans clé échoue au lieu de produire un
APK non publiable.

<details>
<summary>Mises à jour, canal bêta et perte de données</summary>

L'app ne vérifie pas elle-même les mises à jour. Installe la nouvelle release
par-dessus la précédente, avec le même certificat. Obtainium peut suivre les
releases GitHub si tu l'utilises ; ce n'est pas un service du projet.

Android refuse une mise à jour dont le certificat diffère. Passer d'un APK
debug à un APK release demande donc une désinstallation.

### Canal bêta

Les tags `vX.Y.Z-beta.N` publient une pré-release GitHub, signée avec la même
clé que la finale. Bêta → bêta et bêta → finale s'installent par-dessus sans
perte : la finale porte un `versionCode` supérieur à ses bêtas. Revenir d'une
finale à une bêta, ou d'une bêta à une bêta antérieure, est un
**downgrade** : Android le refuse. Ne suis la bêta que depuis un APK release
signé, jamais depuis un APK debug.

### Désinstaller efface les données

Une désinstallation efface la session Pronote, le cache, la clé OpenRouter et
les conversations IA, les pièces jointes et les préférences. Depuis Réglages,
exporte d'abord une copie (l'export n'est pas réimportable dans l'app), puis
ressaisis le QR/PIN et la clé.

</details>

## Compatibilité

| Élément | Minimum ou limite |
|---|---|
| **Android** | 8.0+ (API 26), cible API 37 |
| **WebView** | Chromium 100+ ; en dessous, un écran natif indique le minimum et la version détectée |
| **Connexion** | QR + PIN uniquement : pas de mot de passe, de SSO d'ENT ni de MFA |
| **Compte** | compte élève uniquement, un à la fois ; les comptes parent sont hors périmètre |
| **Rappels** | pas de rappels ni de notifications ; une synchronisation silencieuse rafraîchit le cache environ toutes les 6 h |

iOS, desktop et navigateur seul ne sont pas pris en charge. L'établissement
doit exposer un QR Pronote.

## Assistant IA et vie privée

L'assistant est facultatif. Sans consentement explicite et sans clé, aucun
appel n'est fait. L'écran demande une attestation : 18 ans ou plus, ou accord
du représentant légal avec un compte OpenRouter géré par un adulte.

- **Ta clé, ton compte.** La clé OpenRouter est chiffrée sur l'appareil et
  envoyée directement à OpenRouter, jamais à un serveur du projet. Chaque
  demande consomme tes crédits OpenRouter et peut être facturée.
- **Ce qui peut partir.** Question, cours, extraits de manuel ou de page,
  pièces jointes, photos et historique du fil, selon l'aperçu de consentement.
  Les messages Pronote ne font pas partie des sources IA.
- **Ce qui reste local.** La session Pronote reste sur l'appareil.
  Les données scolaires ne passent par un serveur du projet, ni par un relais.
  Pas de compte chez le projet, pas de publicité, pas de télémétrie, pas de
  rapport de crash automatique.
- **Ce que l'app ne contrôle pas.** OpenRouter et les fournisseurs qu'il route
  peuvent conserver les demandes selon leurs politiques. Une réponse peut être
  fausse, incomplète ou inventée ; elle n'est validée ou appliquée qu'après ton
  geste.
- **Suppression.** La déconnexion ou un changement de compte purge cache,
  fiches, préférences et pièces jointes. « Supprimer toutes mes données »
  emporte aussi le consentement IA, l'adresse du scraper et les exports.

L'app contacte l'établissement, OpenRouter seulement si tu utilises l'IA, et le
scraper facultatif seulement si tu le configures. GitHub sert au téléchargement
d'une release, pas au fonctionnement de l'app.

Le scraper de manuels est un serveur séparé, à garder sur la boucle locale ou
derrière un proxy authentifié : [`server/README.md`](server/README.md).

## Développer

Prérequis : **Bun 1.4.4** ; **JDK 17–21** et **SDK Android 37** pour l'APK ;
**`kotlinc`** et un `java` dans le `PATH` pour la parité TS ↔ Kotlin. Sans cet
outillage, `make check` échoue : le gate ne simule pas un vert.

```bash
bun install
bun run dev:web       # interface + pont factice, sans téléphone
make check            # gate complet
make buildDebugApk    # APK debug
make updateApkToPhone # installe le debug en conservant les données
make buildRelApk      # APK release signé (clé hors dépôt requise)
```

`make check-fast` saute `android-compile` et `audit` : c'est une boucle
interne, pas une preuve avant PR.

Parcours agent et gate : [`AGENTS.md`](AGENTS.md),
[`docs/architecture/BUILD.md`](docs/architecture/BUILD.md). Modules :
[`android/README.md`](android/README.md), [`web/README.md`](web/README.md),
[`server/README.md`](server/README.md). Carte des docs et invariants
(I1–I36) : [`docs/CONTEXT.md`](docs/CONTEXT.md),
[`docs/architecture/INVARIANTS.md`](docs/architecture/INVARIANTS.md).

## Support et sécurité

Le support passe uniquement par GitHub Issues : question d'usage, bug,
incompatibilité ou demande d'accessibilité. Une issue est publique : n'y mets
jamais de donnée scolaire, de QR/PIN, de session, de clé ni de capture non
caviardée. Le diagnostic exporté (Réglages → Aide) aide sans contenu scolaire.

- [Ouvrir une issue](https://github.com/iguanacucumber/veryslopnynotes/issues/new/choose)
- [Signaler une faille ou un secret exposé](https://github.com/iguanacucumber/veryslopnynotes/security/advisories/new)
  via un Advisory privé, jamais une issue publique

## Licence et source

Code et contributions sous **GPL-3.0-only**. Le dépôt public contient tout le
code source, sans composant propriétaire. Voir [`LICENSE`](LICENSE) et
[ADR-008](docs/adr/008-relicense-gpl.md). Notices tierces :
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

Projet indépendant, non affilié à Pronote / Index Éducation ni à Papillon /
Association Papillon, ni à OpenRouter ou à un établissement. Pronote et Index
Éducation sont des marques de leurs titulaires. Le port du protocole vient de
`pronotets` (MIT) ; les règles reprises de Papillon (GPL-3.0, Association
Papillon) restent créditées à leurs auteurs.
