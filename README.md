<h1 align="center">veryslopnynotes</h1>

<p align="center"><strong>Ton Pronote. Ta session. Rien que toi.</strong></p>

<p align="center">
  <a href="android/README.md">App Android</a> ·
  <a href="web/README.md">Interface React</a> ·
  <a href="server/README.md">Scraper</a> ·
  <a href="docs/RELEASE.md">Build & release</a> ·
  <a href="docs/architecture/INVARIANTS.md">Invariants (I1–I35)</a> ·
  <a href="AGENTS.md">Contribuer</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-green.svg"></a>
  <a href="shared/contracts/api.openapi.yaml"><img alt="Contracts 0.11.0" src="https://img.shields.io/badge/contracts-0.11.0-blue.svg"></a>
  <a href="https://bun.sh"><img alt="Bun 1.4.4" src="https://img.shields.io/badge/bun-1.4.4-f9f1de.svg"></a>
</p>

veryslopnynotes est un client Android open source pour Pronote : l'app parle
**directement à l'établissement depuis le téléphone**, aucun serveur
intermédiaire ne voit la session, et tout contenu externe — cours, devoirs,
messages, manuels — est une **donnée**, jamais une instruction. Le serveur du
dépôt est facultatif : il ne sert qu'au scraper de manuels.

> Non affilié à Pronote / Index Éducation. Port Kotlin du protocole
> [`pronotets`](https://www.npmjs.com/package/pronotets) (MIT), avec un compte
> et une autorisation de l'établissement — à vérifier chez toi.

## Ce qui distingue l'app

- **Session locale** : QR + PIN lus dans l'app, jeton chiffré sur l'appareil,
  purgé à la déconnexion ([ADR-003](docs/adr/003-client-direct.md)).
- **Aucun relais** : seul `android/pronote/` contacte l'établissement ; ni
  session ni clé OpenRouter ne passent par un serveur.
- **IA sans outils** : clé chiffrée localement, contenu externe délimité et
  marqué non fiable avant tout prompt ([I4–I6](docs/architecture/INVARIANTS.md)).
- **Hors-ligne d'abord** : cache + TTL par ressource, cache affiché avant le
  réseau, périmètre signalé.
- **WebView sans réseau** : CSP `connect-src 'none'`, aucun `fetch`, pont
  natif allowlisté ([ADR-004](docs/adr/004-webview.md)).

## Démarrage rapide

Prérequis : **Bun 1.4.4** ; pour l'APK, **JDK 17–21** + **SDK Android 37** ;
pour la parité TS ↔ Kotlin, **`kotlinc`** et un `java` dans le `PATH` — sans
eux `make check` **échoue** (un gate vert sans Kotlin exécuté est un faux
vert ; `make check-fast` garde le saut bruyant, pour l'itération).

```bash
bun install
bun run dev:web       # Chromium + pont factice (src/bridge/mock.ts)
make check            # toutes les vérifications, en parallèle
make buildDebugApk    # APK debug -> android/app/build/outputs/apk/debug/
make updateApkToPhone # construire puis installer en conservant les données
make buildRelApk      # APK + AAB release (signés ; custom si STORE_FILE)
```

L'interface React est reconstruite avant Gradle (`preBuild` →
`bun run build:web`) : un build APK sans `bun` échoue bruyamment plutôt que
d'embarquer une UI absente. Détails : [`android/README.md`](android/README.md),
[`web/README.md`](web/README.md), [`docs/RELEASE.md`](docs/RELEASE.md).

## Scraper de manuels (facultatif)

```bash
make runServer                 # HTTPS sur 127.0.0.1:8080 (boucle locale)
make runServer HOST=0.0.0.0    # pour joindre le scraper depuis le téléphone
```

TLS obligatoire (certificat auto-signé hors dépôt, ou `TLS_CERT_FILE` et
`TLS_KEY_FILE` fournis), jamais de repli en clair ; l'adresse du manuel se
règle une fois dans l'app. Le point d'entrée est **sans authentification** :
à garder sur la boucle locale ou derrière un proxy authentifié
([I8](docs/architecture/INVARIANTS.md)). Routes, limites et catalogue :
[`server/README.md`](server/README.md).

## Configuration, structure, docs

- Configuration et apports humains (QR, clé OpenRouter, manuel) :
  [`docs/HUMAN_INPUTS.md`](docs/HUMAN_INPUTS.md).
- Structure : `android/` (APK, pont natif, modules), `web/` (React embarqué),
  `server/` (scraper), `shared/contracts/` (routes + validateurs),
  `agents/` (harnais), `tests/`, `docs/`.
- Flux Pronote : `web (pont) → android/pronote/ → établissement`. Le serveur
  n'y est pas ; règles : [`INVARIANTS.md`](docs/architecture/INVARIANTS.md),
  décisions : [`docs/adr/`](docs/adr/), écrans : [`docs/PRODUCT.md`](docs/PRODUCT.md).

## Contribuer

Workflow, branches, gate, commandes et dépendances : [`AGENTS.md`](AGENTS.md).

## État et limites

Projet en développement (`versionName` `0.1.0`), aucune release publiée.
Limites assumées : accès Pronote dépendant de l'établissement et du QR ;
assistant IA inactif sans clé OpenRouter ; scraper sans authentification par
conception, jamais public ; pas de compte Pronote réel dans la suite par
défaut (fixtures synthétiques et états hors-ligne).

## License

MIT — voir [`LICENSE`](LICENSE). Port du protocole Pronote crédité à
`pronotets` (MIT).

<!-- vim: set tw=80: -->
