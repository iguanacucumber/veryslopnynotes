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
| `code-review` | [mattpocock/skills](https://github.com/mattpocock/skills) | MIT |

## Rapport au scan anti-secrets

`make lint` (`agents/runtime/check-secrets.ts`) applique un jeu de motifs
**strict** au dépôt et un jeu **allégé** à `.agents/` : l'exemple de
documentation de `code-review` imite un secret sans l'être et
farantait le scan en boucle.

L'allègement est étroit : dans `.agents/`, on exige une **preuve** — corps
de clé PEM (≥32 caractères base64), token GitHub/Slack plausible, vrai
tableau `cookies`, littéral de credential de ≥32 caractères. Un en-tête PEM
nu ou un `AKIA…EXAMPLE` passent ; une vraie clé ne passe pas.

Invariant couvert par `tests/architecture/secret-scan.test.ts`.
