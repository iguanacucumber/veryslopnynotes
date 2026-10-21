# web/ — interface React de l'APK

Le frontend de l'application. Il est **embarqué localement** dans la WebView
Android (`android/app/src/main/assets/web/`), jamais chargé depuis un serveur.

## Règles

- **Aucun réseau depuis le JS.** `connect-src 'none'` ; pas de `fetch`, XHR,
  WebSocket, fonte distante ou image distante. Toute lecture/écriture passe par
  `src/bridge/client.ts`, qui appelle le Kotlin (`window.VSN.call`).
- **Aucun secret côté JS.** La session Pronote et la clé OpenRouter restent
  natives. Le pont ne renvoie que des payloads, des booléens et des messages.
- **Contenu Pronote = donnée.** Pas de `dangerouslySetInnerHTML`, pas de HTML
  construit depuis un payload.
- **Offline-first.** `useResource` affiche le cache avant le réseau et expose
  `stale` / `error`.
- **Un payload, une requête.** Le payload est rattaché à sa requête (clé +
  query) : changer de requête (période, algorithme, semaine) l'invalide —
  l'écran montre un chargement, jamais les chiffres d'une autre requête
  (`src/lib/resource.ts`, #527).

## Développement

```sh
bun run dev:web     # Chromium + pont factice (src/bridge/mock.ts)
bun run typecheck:web
bun run build:web   # écrit dans android/app/src/main/assets/web/
```

Le pont factice imite les payloads réels : les écrans se développent sans
téléphone ni session Pronote. Il est **développement seul** (#423) : le build de
production ne l'embarque pas, et un pont natif absent y est un échec bruyant
(aucune école fictive servie en silence).

## Structure

- `src/App.tsx` : routes (HashRouter), porte de session.
- `src/ui/AppShell.tsx` : barre du haut, onglets, titres/retours.
- `src/ui/AppContext.tsx` : thème, palette, rafraîchissement global, notices, ressources.
- `src/ui/components.tsx` : cartes, états vides, erreurs, avatar.
- `src/styles/tokens.css` : jetons de la palette par défaut (repli si le JS échoue).
- `src/lib/schemes.ts` : les 20 palettes (claire + sombre), posées en variables CSS sur `<html>`.
- `src/routes/*.tsx` : un écran par route.
- `src/features/*` : logique/parsers par écran.

## Contrat du pont

`src/bridge/types.ts` est la source des méthodes. Kotlin (`VsnBridge.kt`)
répond en JSON. Les formes de payload sont celles que les écrans Compose
lisaient déjà (`android/data/PronotePayloads.kt`) : ne pas inventer un nouveau
schéma par écran.

## Budget

- JS initial < 250 Ko gzip.
- Pas de bibliothèque de composants : CSS + composants maison.
- `prefers-reduced-motion` coupe les transitions.
- Mouvement (#336) : transitions de route par View Transition native
  (`src/ui/viewTransition.ts`, repli en navigation simple si l'API manque), et
  animations CSS en `transform`/`opacité` uniquement (testé).
- Couleurs : tout passe par les variables de `src/styles/tokens.css`, posées par
  `src/lib/schemes.ts` (20 palettes × clair/sombre). Aucune couleur en dur dans
  un écran : une palette retirée retombe sur la palette par défaut.
