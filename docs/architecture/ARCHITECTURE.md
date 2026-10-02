# ARCHITECTURE.md — squelette (phase 1 détaillera)

4 couches strictes : `android/` `server/` `shared/` `agents/`.
Ports/adaptateurs côté serveur : domaine = interfaces (`server/domain/ports.ts`).
`shared/contracts/` = source vérité API/événements/modèles.
Règles or réseau + IA + invariants : voir `INVARIANTS.md`.
ADR : `docs/adr/`.
