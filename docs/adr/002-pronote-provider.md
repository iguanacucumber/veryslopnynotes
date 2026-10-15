# ADR-002 — provider Pronote (superseded)

- Statut : superseded by [ADR-003](003-client-direct.md).

## Décision historique

Le 2026-10-02, le provider Pronote côté serveur a reçu un `no-go` conditionnel,
faute de compte de test pour une mesure en conditions réelles. Cette décision
précédait le port Kotlin et l'accès direct depuis le téléphone.

Depuis #205, l'app ouvre la session Pronote et lit les données directement ; le
serveur ne relaie plus ces requêtes. Le client TypeScript restant n'est utilisé
que par l'outil local de capture du corpus #199, hors processus serveur.

Les anciens critères, routes et commandes de mesure de cette ADR sont archivés
dans l'historique Git ; ils ne décrivent plus l'architecture courante.
