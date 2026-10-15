# server/ — scraper de manuels

L'app parle directement à Pronote et à OpenRouter ; ce serveur ne participe pas
à ces flux (ADR-003). Il ne sert que deux routes :

- `GET /v1/health` pour la sonde.
- `POST /v1/manuals/scrape` pour extraire une page de manuel.

Le scraper est sans authentification et accepte identifiants éditeur dans le
corps de requête. Risque SSRF et d'épuisement du compte : garder sur réseau de
confiance ou placer un proxy authentifié devant. `make runServer` et Docker
lancent ce seul service.
