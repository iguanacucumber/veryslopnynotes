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

### Sécurité

- Scraper : sandbox Chromium ACTIF dans l'image, confiné par un profil seccomp
  étroit (namespaces user/PID/net seulement) et une commande Docker sans
  capabilities.
- Release sans adresse de serveur par défaut : le défaut émulateur et le HTTP
  en clair restent confinés au variant debug (SEC-01).
- Liens profonds : schéma privé `veryslopnynotes` limité au debug, aucun
  `VIEW`/`BROWSABLE` ni App Link dans la release (SEC-10).
