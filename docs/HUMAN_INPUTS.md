# HUMAN_INPUTS.md — apports humains attendus (sans valeurs secrètes)

Depuis 0.7.0 le serveur ne détient **aucun credential** : il n'y a plus de `.env`, donc
rien n'est attendu de ce côté. Ces apports existent, mais ils sont saisis par
l'utilisateur dans l'app, ou transmis par le client qui appelle l'API.

- QR + PIN du compte établissement : saisis par l'utilisateur dans l'assistant
  (`POST /v1/setup`). Aucune URL d'établissement n'est attendue du dépôt.
- Clé OpenRouter : saisie par l'utilisateur dans l'app (Réglages → « Assistant devoirs »),
  chiffrée sur le téléphone, transmise par l'app à chaque appel devoirs (`apiKey` de
  `POST /v1/homework/generate`). Le modèle est une constante de code, rien à fournir.
- Choix VPS à IP fixe (recommandé) ou acceptation ré-auth après changement IP.
- Clé signature APK release (hors repo).
- **Corpus de fixtures Pronote (#199)** : l'opérateur lance
  `bun run agents/runtime/capture-pronote.ts` sur un compte réel et saisit à la
  main URL d'établissement + `login`/`jeton` du QR + PIN (le PIN est lu sans
  écho). L'outil écrit `tests/fixtures/pronote/<domaine>.json`, **gitignoré** :
  aucune de ces valeurs n'est attendue du dépôt, et rien ne doit y entrer. Sans
  cette capture, le port Kotlin (#200/#201) et le harnais de parité (#202)
  s'annoncent SKIP bruyamment — ils ne peuvent pas vérifier ce qu'ils n'ont pas
  sous les yeux.
- Non fournis volontairement : compte éditeur de manuels (scraping désactivé, plus de
  source de credential) et clés VAPID (push non configuré).
- Arbitrage ADR-002 (provider Pronote) si go/no-go négatif.
