# Politique reviews
- 2 reviews locales successives sur SHA courant dans `.agents/prs/<id>.md`.
- REVIEW 1 fonctionnelle, REVIEW 2 adversariale (sécurité, invariants, cas limites).
- Format : `head: <SHA>`, `tests: make check → pass|fail`, `findings: - [blocking|non-blocking] path:line — desc`.
- Modification après review ⇒ invalide les deux. Vérif : `bun run agents/runtime/check-pr.ts`.
