# Politique secrets
- Secrets réels uniquement `.env.local` (jamais commité). Modèle : `.env.example`.
- Jamais en issue/PR/log/fixture. Secret commité = rotation immédiate + issue incident.
- `make check` inclut `check-secrets.ts`. Dépôt public : voir AGENTS.md.
