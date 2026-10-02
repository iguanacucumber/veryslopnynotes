# Conventions Git
- Messages : `<scope>: <objet>` (ex. `server: ajoute PronoteHttpClient`), impératif, une ligne + corps si besoin.
- Pas de commit direct sur `main`. Toujours branche agent + PR validée.
- Avant commit : `make check`. Avant publication : 2 reviews locales + `check-pr.ts`.
