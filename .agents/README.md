# Skills d'agents vendorisés

Copie **figée** de skills de l'écosystème open agent skills, installée avec
`npx skills add <source> --copy` et verrouillée par `skills-lock.json`
(source + hash du contenu de chaque skill).

Mise à jour :

```bash
npx skills update            # si les skills sont déjà installés
npx skills add <source>@<skill> -y --copy
```

## Sources et licences

Chaque skill est propriétaire de son dépôt amont. Les licences d'origine sont
copiées dans [`licenses/`](licenses/) — le dépôt `veryslopnynotes` reste MIT,
les contenus tiers gardent **leur** licence.

| Skill | Source upstream | Licence |
|---|---|---|
| `vercel-react-best-practices` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | MIT (déclaré dans le `SKILL.md` ; le dépôt amont n'a pas de fichier `LICENSE`) |
| `web-design-guidelines` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | MIT (idem) |
| `impeccable` | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | Apache-2.0 (+ `NOTICE.md`) |
| `code-review` | [mattpocock/skills](https://github.com/mattpocock/skills) | MIT |
| `playwright-best-practices` | [currents-dev/playwright-best-practices-skill](https://github.com/currents-dev/playwright-best-practices-skill) | MIT |
| `kotlin-specialist` | [jeffallan/claude-skills](https://github.com/jeffallan/claude-skills) | MIT |
| `security-review` | [github/awesome-copilot](https://github.com/github/awesome-copilot) | MIT |
| `systematic-debugging` | [obra/superpowers](https://github.com/obra/superpowers) | MIT |

## Rapport au scan anti-secrets

`make lint` (`agents/runtime/check-secrets.ts`) applique un jeu de motifs
**strict** au dépôt et un jeu **allégé** à `.agents/` : la documentation de
ces skills imite des secrets (en-tête PEM sans corps, clé AWS d'exemple
canonique `AKIAIOSFODNN7EXAMPLE`, `storageState` Playwright, faux token) et
farantait le scan en boucle.

L'allègement est étroit : dans `.agents/`, on exige une **preuve** — corps
de clé PEM (≥32 caractères base64), token GitHub/Slack plausible, vrai
tableau `cookies`, littéral de credential de ≥32 caractères. Un en-tête PEM
nu ou un `AKIA…EXAMPLE` passent ; une vraie clé ne passe pas.

Invariant couvert par `tests/architecture/secret-scan.test.ts`.
