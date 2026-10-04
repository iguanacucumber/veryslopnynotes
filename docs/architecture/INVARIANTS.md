# INVARIANTS.md — règles critiques (bloquantes)

Format : Invariant → test → commande → emplacement.

## I1 — Android sans hôte Pronote/portail
- Invariant : `android/` ne contient aucune URL/référence hôte Pronote ou de portail d'établissement. Un seul hôte serveur allowlist.
- Serveur choisi à l'exécution (écran d'appairage) : l'allowlist n'est plus une
  constante de build mais `ServerConfig.validateBaseUrl` (https, sauf émulateur/
  boucle locale en http ; hôte et port bornés ; identifiants, chemin, query,
  fragment, espaces et caractères de contrôle refusés) + `isAllowed` en préfixe
  strict. `BuildConfig.SERVER_HOST` n'est plus qu'une graine. Un changement de
  serveur purge la session et les caches (`AccountStore.logout()`) avant usage.
- Test : `tests/architecture/invariants.test.ts` (I1) + `agents/runtime/check-architecture.ts` + `tests/unit/android-server-config.test.ts`.
- Commande : `make architecture-test`.
- Emplacement : `android/**/*`.

## I2 — Unique PronoteHttpClient
- Invariant : toute requête Pronote passe par l'unique `PronoteHttpClient`. Hiérarchie Domain → PronoteProvider → adapter → PronoteHttpClient → HTTP.
- Test : `tests/architecture/invariants.test.ts` (I2) + scan définitions multiples.
- Commande : `make architecture-test`.
- Emplacement : `server/integrations/PronoteHttpClient.ts`.

## I3 — Domaine sans SQLite ni HTTP
- Invariant : `server/domain/` ne dépend ni de SQLite ni du framework HTTP. Ports = interfaces.
- Test : `tests/architecture/invariants.test.ts` (I3).
- Commande : `make architecture-test`.
- Emplacement : `server/domain/ports.ts`.

## I4 — Pas de secrets dans prompts LLM
- Invariant : aucun secret/token/credential dans prompt LLM.
- Test : `tests/security/pipeline.test.ts` (I4/I5) + `agents/runtime/check-secrets.ts`.
- Commande : `make check` (security + lint).
- Emplacement : `server/ai/*`.

## I5 — LLM sans outils/réseau/secrets
- Invariant : LLM sans outils, accès réseau, secrets. Sortie texte/JSON validé.
- Test : `tests/security/pipeline.test.ts` + `check-architecture.ts` (scan `server/ai/`).
- Commande : `make check`.
- Emplacement : `server/ai/*`.

## I6 — Contenu externe = UNTRUSTED_DATA
- Invariant : tout contenu externe marqué `Untrusted` avant traitement IA, entre délimiteurs à nonce, déclaré données.
- Test : `tests/security/pipeline.test.ts` (I6) + fixtures attaques (phase 6).
- Commande : `make check`.
- Emplacement : `server/domain/ports.ts` (`untrusted()`), `server/ai/*`.

## I7 — Pas d'effet bord via sortie libre LLM
- Invariant : aucun effet métier déclenché par sortie libre LLM. Notifications/détection DS sur données structurées Pronote, sinon confirmation app.
- Test : review + tests jobs/notifications (phases 5/7, `tests/e2e/`).
- Commande : `make e2e`.
- Emplacement : `server/jobs/*`, `server/api/*`.

## I8 — Zéro credential côté serveur

Le serveur ne lit **aucune** variable de credential et ne détient aucun secret :
`PORT`/`HOST` (l'écoute) sont les seules variables lues, et uniquement dans
`start()` (`server/infrastructure/http.ts`). Tout ce qui s'authentifie vient de
l'app, par requête :

| Ce qui s'authentifie | Où il vit | Comment il voyage |
|---|---|---|
| Session Pronote | mémoire du serveur, renewing par QR | QR + PIN dans `POST /v1/setup` |
| Clé du fournisseur LLM | `LlmKeyStore` (chiffré) dans l'app | corps de `POST /v1/homework/generate` (`apiKey`, `writeOnly`) |
| Secret d'appareil | `TokenStore` (chiffré) dans l'app | `Authorization: Bearer`, relu à chaque requête |

Interdit : `.env*` dans le repo, toute clé de secret dans une variable, un secret
en query string (un corps non), un secret journalisé. Piné par
`tests/architecture/invariants.test.ts` (I8) et `tests/unit/android-homework.test.ts`.
