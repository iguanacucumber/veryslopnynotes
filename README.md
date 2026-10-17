<h1 align="center">veryslopnynotes</h1>

<p align="center">
  <a href="android/README.md">App Android</a> |
  <a href="docs/RELEASE.md">Build & release</a> |
  <a href="docs/architecture/INVARIANTS.md">Invariants</a> |
  <a href="AGENTS.md">Contribuer</a>
</p>

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Contracts](https://img.shields.io/badge/contracts-0.8.0-blue.svg)](shared/contracts/api.openapi.yaml)
[![Bun](https://img.shields.io/badge/bun-1.4.2-f9f1de.svg)](https://bun.sh)

veryslopnynotes est un projet qui vise à consulter son Pronote sans jamais confier sa session à un
serveur, afin de :

- Tenir la session sur le téléphone seul ([ADR-003](docs/adr/003-client-direct.md))
- Garder session Pronote et clé LLM hors du serveur
- Traiter le contenu externe comme une donnée, jamais comme une instruction
- Rester hors-ligne d'abord : cache par ressource, repli si le réseau tombe

Voir [`android/README.md`](android/README.md) pour l'app et
[`docs/architecture/INVARIANTS.md`](docs/architecture/INVARIANTS.md) pour les règles de sécurité.

> Projet non affilié à Pronote / Index Éducation. Accès Pronote via la bibliothèque communautaire
> [`pronotets`](https://www.npmjs.com/package/pronotets), avec un compte et une autorisation de
> l'établissement — à toi de vérifier que cet usage est autorisé chez toi.

Features
--------

- **Notes & moyennes** — 3 algorithmes (matière, pondérée par coefficient, médiane), moyenne du
  bulletin publiée sinon estimée, influence par note, courbe d'historique, périodes.
- **Devoirs** — consigne, contenus, pièces jointes, filtre par semaine, toggle « fait » écrit dans
  Pronote (action confirmée, jamais déclenchée par l'IA).
- **Aide devoirs (IA)** — corrigé sourcé ou refus motivé ; la clé chiffrée part directement de
  l'app vers OpenRouter, sans transiter par le serveur.
- **Cours (EDT)** — vue semaine, professeur, salle, annulés/déplacés, badge « prochain cours ».
- **Vie scolaire** — absences, retards, sanctions, compteurs par période.
- **Actualités, cantine, messagerie** — fils, réponse, création, état lu, suppression.
- **Profil & accueil** — multi-comptes parent, déconnexion qui purge session et cache, mode anonyme.
- **Matières personnalisées** — couleur, emoji, libellé appliqué partout, thème clair/sombre.
- **Capacités dynamiques** — onglets non publiés par l'établissement masqués, pas vides-cassés.
- **Hors-ligne** — cache par ressource avec TTL et badge « périmé ».
- **Fiches de révision** — réponses sourcées (cours + manuels), citations vérifiées, export PDF.
- **Alertes sécurité** — injections neutralisées, pour vérifier que le contenu externe n'a jamais
  été exécuté.

Détail app : [`android/README.md`](android/README.md). Le serveur optionnel sert uniquement au
scraping de manuels : [`server/README.md`](server/README.md).

Installation
------------

Prérequis : [Bun](https://bun.sh) 1.4.2 ; pour l'app, JDK 17–21 et SDK Android 34
([détails](docs/RELEASE.md)).

```bash
bun install
make check                     # secrets + typecheck + unit + arch + contracts + compile Kotlin
make runServer                 # scraper de manuels facultatif, HTTPS sur :8080
```

Client Android :

```bash
make buildDebugApk             # APK debug  -> android/app/build/outputs/apk/debug/
make buildRelApk               # APK release (signé si STORE_FILE est dans l'environnement)
```

Les trois cibles Gradle trouvent leur JDK et leur SDK toutes seules et **échouent** si l'outillage
manque : un APK demandé en silence n'en est pas un. Détails build/signature :
[`android/README.md`](android/README.md) et [`docs/RELEASE.md`](docs/RELEASE.md).

L'app n'a pas besoin du serveur pour Pronote ni pour l'assistant IA. `make runServer` lance le
scraper de manuels facultatif ; il ne relaie ni session Pronote ni clé OpenRouter.

Configuration
-------------

**Pas de `.env` ni de secrets de serveur.** Le QR et son PIN sont déchiffrés sur le téléphone ; la
clé OpenRouter est chiffrée sur l'appareil et envoyée directement au fournisseur. Exception : le
scraper reçoit les identifiants du portail de manuels dans le corps de sa requête. Son endpoint est
sans authentification : ne pas l'exposer publiquement (voir [I8](docs/architecture/INVARIANTS.md)).

Seules variables lues, aucune secrète : `PORT`, `HOST`, `TLS_CERT_FILE`, `TLS_KEY_FILE`.
`make runServer` génère un certificat auto-signé hors du dépôt (`~/.cache/veryslopnynotes/tls`) ;
fournissez les deux variables TLS pour un certificat émis (mkcert, Let's Encrypt).

Apports humains (compte Pronote, clé OpenRouter, signature) : [`docs/HUMAN_INPUTS.md`](docs/HUMAN_INPUTS.md).

Tests
-----

```bash
make check                  # tout : secrets, typecheck, unit, arch, contracts, compile Kotlin
make unit / contracts / architecture-test
```

Fixtures 100 % synthétiques, aucun accès réseau dans la suite par défaut. Un changement qui casse un
invariant est bloquant, même s'il passe fonctionnellement. Sans JDK 17-21 / SDK Android, la
compilation Kotlin est skipée en l'écrivant — jamais un faux vert.

Project layout
--------------

    ├─ android/          app native Kotlin + Compose; accès Pronote direct
    ├─ server/           scraper de manuels facultatif
    ├─ shared/contracts/ routes scraper, OpenAPI et validateurs conservés pour les tests
    ├─ agents/           scans, capture et harnais de test locaux
    ├─ tests/            tests unitaires, contrats et architecture
    └─ docs/             décisions, invariants, recette et release

Flux Pronote : `app → android/pronote/ → établissement`. Le serveur n'est pas dans ce flux.
Invariants : [`docs/architecture/INVARIANTS.md`](docs/architecture/INVARIANTS.md).

Contributing
------------

Le circuit est **une issue = une branche = une PR** (`agent/<n>-<slug>`), zéro commit direct sur
`main`. PR via MCP GitHub uniquement (`gh` CLI interdit), relecture du diff + `make check` avant
merge. Invariant cassant = PR bloquante.

- [`AGENTS.md`](AGENTS.md) — workflow, garde-fous, règles d'or
- [`docs/adr/`](docs/adr/) — décisions d'architecture (stack, provider Pronote, client direct)

Nouvelles dépendances : justifiées dans la PR, version épinglée, licence MIT-compatible.

License
-------

MIT — voir [`LICENSE`](LICENSE). Identité et écrans propres, aucun asset tiers copié.

<!-- vim: set tw=80: -->
