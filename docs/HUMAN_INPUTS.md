# HUMAN_INPUTS.md — apports humains attendus (sans valeurs secrètes)

- URL Pronote établissement + type ENT/CAS (texte, jamais commité). Depuis #118, saisissables
  dans l'app (assistant de configuration) : le `.env.local` n'est plus le seul chemin.
- Comptes test Pronote (via `.env.local` local uniquement).
- Comptes manuels + plateforme (via `.env.local`, première connexion interactive Playwright).
- Clé OpenRouter + modèle souhaité (via `.env.local`).
- Choix VPS à IP fixe (recommandé) ou acceptation ré-auth après changement IP.
- Token push / clés VAPID (via `.env.local`).
- Clé signature APK release (hors repo).
- Arbitrage ADR-002 (provider Pronote) si go/no-go négatif.
