# Politique reviews
- 1 review dans `.agents/prs/<id>.md` par défaut ; 2e adversariale seulement si sensible (voir `AGENTS.md § Review`).
- Format : `head: <SHA>`, `tests: bun run check → pass|fail`, `findings: - [blocking|non-blocking] path:line — desc`.
- Modif après review ⇒ review périmée. Vérif : `bun run agents/runtime/check-pr.ts`.
- Mergable ⇒ merge auto (`gh pr create` + `gh pr merge --merge`), sans validation humaine.
