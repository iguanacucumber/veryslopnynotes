# Sécurité

## Signaler une vulnérabilité

Ne pas ouvrir d'issue publique pour une faille exploitable. Utiliser
**GitHub Security Advisories** : onglet *Security* du dépôt, puis
*Report a vulnerability*. Le rapport reste privé le temps de l'analyse.

Le dépôt n'a pas d'adresse de signalement par courriel : tout passe par ce
canal privé.

## Périmètre

- **App Android** (`android/`) : stockage de la session Pronote et de la clé
  LLM, pont WebView, contenu non fiable, journalisation.
- **Interface web** (`web/`) : CSP, absence de réseau, injection dans le pont.
- **Serveur et scraper** (`server/`, `Dockerfile.server`) : SSRF, traversée de
  fichiers, fuite de cookie jar, image Docker.
- **Chaîne de build** (`.github/workflows/`, scripts `agents/`) : injection
  dans le gate, dépendances compromises.

Hors périmètre : une faille propre à Pronote ou à OpenRouter, une
configuration de l'établissement, et un déploiement du scraper fait par un
opérateur hors des règles ci-dessous.

## Règles que le dépôt tient

- **Aucun secret dans le dépôt.** Pas de clé, de session, de mot de passe, de
  `.env`, ni de donnée personnelle. Un secret exposé est **révoqué et
  remplacé** : retirer le commit ne suffit pas.
- **Le scraper est sans authentification** (I8). Il reste sur la boucle locale
  ou derrière un proxy authentifié, jamais exposé publiquement. Une exposition
  publique est un choix de l'opérateur, pas un défaut de l'image.
- **Les actions GitHub sont épinglées** à un SHA de commit, pas à un tag
  mutable. Dependabot propose les mises à jour.

## Versions prises en charge

Seule la branche `main` est maintenue : les correctifs de sécurité y arrivent.
Les versions publiées antérieures ne reçoivent pas de correctif isolé ; la
mise à jour vers la dernière version est la voie de correction.
