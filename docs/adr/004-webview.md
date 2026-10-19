# ADR-004 — frontend web local dans l'APK

- Statut : accepté (issue #333)
- Remplace : le frontend Compose de `android/ui/` (le backend natif reste)

## Contexte

`android/ui/` représente ~18 800 lignes de Compose, avec un thème et des
animations très spécifiques. Le protocole Pronote, la session chiffrée, le cache
hors-ligne, la synchronisation de fond, les notifications et l'export PDF vivent
déjà dans `android/pronote/`, `android/data/` et `android/core/` et sont testés.

Une application purement web est impossible : le serveur Pronote n'émet pas
d'en-têtes CORS, la session repose sur des cookies cross-site, et la WebView
n'accède ni au Keystore, ni à WorkManager, ni au scanner. Un proxy serveur
violerait ADR-003 et I8.

## Décision

- Le frontend est une app **React 19 + TypeScript + Vite** dans `web/`.
- Elle est **embarquée dans l'APK** et servie par la WebView sur
  `https://appassets.androidplatform.net/` (origine sûre, pas de `file://`).
- **Aucun réseau depuis la WebView** : CSP `connect-src 'none'`, pas de
  `fetch`/XHR/WebSocket. Tout passe par un pont JSON (`window.VSN.call`) dont
  les méthodes sont allowlistées dans `web/src/bridge/types.ts` et
  `android/app/.../VsnBridge.kt`.
- Le pont ne reçoit/renvoie **jamais** le jeton de session ni la clé LLM. Il
  expose des lectures/écritures sémantiques ; le Kotlin garde la session, le
  Keystore, le cache et les appels Pronote/OpenRouter.
- Le cutover est fait : `android/ui/` et les dépendances Compose sont
  supprimés. Tout build APK dépend de `bun run build:web` (tâche Gradle
  `preBuild`), et `MainActivity` monte toujours `NativeWebShell`.
- L'app web tourne aussi dans Chromium avec un pont factice
  (`web/src/bridge/mock.ts`) pour Playwright et le développement. Ce pont est
  un artefact de développement : le build de production ne l'embarque pas et
  un pont natif absent y est un échec bruyant (I13, #423).

## Alternatives rejetées

- **PWA / navigateur seul** : CORS Pronote, cookies tiers, Keystore et
  WorkManager indisponibles. Un proxy serveur contredirait ADR-003.
- **Port complet du protocole en TypeScript** : le client `pronotets` est
  Node-only (`node:crypto`, `node:zlib`, `Buffer`) ; le RSA PKCS#1 v1.5 et MD5
  ne sont pas dans WebCrypto. Plus de surface, plus de crypto à auditer, alors
  que le port Kotlin est déjà prouvé.
- **Capacitor/Tauri** : couche de plugins inutile pour une app Android unique
  qui possède déjà ses intégrations natives.
- **WebView distante** : contenu distant = surface d'injection et rupture I6.
  La WebView ne charge que des assets locaux.

## Conséquences

- Le contrat du pont est testé des deux côtés ; toute méthode ajoutée doit
  l'être dans les types TS et dans l'allowlist Kotlin.
- Les tests d'architecture vérifient l'absence de réseau et d'HTML injecté
  (`tests/architecture/web.test.ts`), et la CSP.
- Les captures `make shot` passent par les deep links existants
  (`veryslopnynotes://<route>`), désormais traduits en `#/<route>`.
- Compatibilité WebView : cible ES2018, pas de `:has()`/`dvh` sans repli,
  tests sur API 26.
- Budget : JS initial < 250 Ko gzip, pas de bibliothèque de composants.
- La parité visuelle est vérifiée écran par écran ; les références de capture
  Compose ne sont plus la source de vérité.
