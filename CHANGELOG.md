# Changelog

Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions
[SemVer](https://semver.org/lang/fr/). Aucune release n'est publiée : la version
en développement est `0.1.0` (`versionName` Android), et `[Unreleased]` devient
la section `0.1.0` le jour du tag.

## [Unreleased]

### Ajouté

- Client Android Pronote : QR + PIN lus dans l'app, session chiffrée sur
  l'appareil et purgée à la déconnexion.
- Interface React embarquée, hors-ligne d'abord : cache + TTL par ressource,
  cache affiché avant le réseau.
- Assistant IA local (clé OpenRouter chiffrée) : contenu externe délimité et
  marqué non fiable avant chaque prompt.
- Scraper de manuels facultatif, HTTPS obligatoire, sans authentification.
- Taille du texte réglable (100/125/150 %) et suivi du réglage Android jusqu'à 200 %.
- Export local et portable (JSON versionné, manifeste) des notes, du cahier de
  cours, des fiches de révision, du fil du professeur, du manuel mémorisé, des
  préférences matière et de l’état de lecture ; partage Android, sans jeton de
  session, clé LLM ni adresse de serveur.
- Avant une déconnexion, un changement de compte ou une suppression totale,
  l'export des notes, fiches de révision et conversations du professeur est
  proposé, avec la perte définitive expliquée ; continuer sans exporter reste
  possible et l'échec d'export est affiché.
- Smoke CI sur émulateur : APK debug installé, appairage démo, accueil vérifié,
  captures et logcat en artefact (non bloquant tant que non stable).
- Tests instrumentés sur émulateur : clé chiffrée, Keystore dégradé puis sain,
  purge complète d'un compte, fichier corrompu et `FLAG_SECURE` (non bloquant
  tant que non stable).
- « Supprimer toutes mes données » : confirmation listant session, cache,
  artefacts hors-ligne, téléchargements, photos, manuel, comptes, WebView,
  état de lecture, clé de l'assistant et serveur, puis purge orchestrée avec
  échec partiel affiché.

### Modifié

- Fontes SN Pro sous-ensemblées en WOFF2 (graisses réellement utilisées,
  préchargement) et budget gzip vérifié à chaque build.
- Santé de release documentée sans télémétrie : signaux store, CI, issues et
  empreintes, seuils de pause/retrait et suivi d'incident.

### Sécurité

- Scraper : sandbox Chromium ACTIF dans l'image, confiné par un profil seccomp
  étroit (namespaces user/PID/net seulement) et une commande Docker sans
  capabilities.
- Release sans adresse de serveur par défaut : le défaut émulateur et le HTTP
  en clair restent confinés au variant debug (SEC-01).
- Liens profonds : schéma privé `veryslopnynotes` limité au debug, aucun
  `VIEW`/`BROWSABLE` ni App Link dans la release (SEC-10).
- Démo de l'éditeur limitée au debug (`DEMO_MODE`) : bouton absent en release,
  `pairing.pairDemo` refusée par le pont, session de démo non restaurée et pont
  factice web exclu du bundle de production (DAT-06).
