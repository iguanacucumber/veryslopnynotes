# CONTEXT.md — carte tâche → invariant

Une tâche connue mène à un invariant précis : lire l'ancre, pas le thème
entier. Entrées : chemins sous `docs/architecture/`, `#i<n>` = ancre de l'ID.
Registre : [`INVARIANTS.md`](architecture/INVARIANTS.md).

## Tâche → entrées

| Tâche | Entrées |
|---|---|
| Réseau, session, client Pronote, file de requêtes | I1 `invariants/frontieres.md#i1`, I17 `invariants/donnees.md#i17`, I19 `invariants/donnees.md#i19` |
| Prompt IA, contenu externe, fiche PDF, cours et pièces jointes | I4 `invariants/ia.md#i4`, I6 `invariants/ia.md#i6`, I14 `invariants/ia.md#i14`, I15 `invariants/ia.md#i15`, I35 `invariants/ia.md#i35` |
| Photo prise ou envoyée | I32 `invariants/ia.md#i32` |
| Écran React, réponse périmée, pont WebView, bundle | I10 `invariants/frontieres.md#i10`, I13 `invariants/build.md#i13`, I25 `invariants/ia.md#i25` |
| Compte : purge, cache hors-ligne, dédup, sauvegarde | I16 `invariants/donnees.md#i16`, I18 `invariants/donnees.md#i18`, I31 `invariants/donnees.md#i31`, I33 `invariants/donnees.md#i33` |
| Scraper de manuels, contrats HTTP | I8 `invariants/frontieres.md#i8` |
| Build, gate, skills, version Kotlin | I11 `invariants/build.md#i11`, I22 `invariants/frontieres.md#i22`, I34 `invariants/build.md#i34` |

## Carte des documents

| Fichier | En une ligne | Quand le lire |
|---|---|---|
| `README.md` | produit, démarrage, limites | présenter le projet |
| `AGENTS.md` | 5 lois, workflow, gate | avant de toucher au dépôt |
| `docs/CONTEXT.md` | cette carte | chercher l'invariant d'une tâche |
| `docs/architecture/INVARIANTS.md` | index des 20 invariants actifs | choisir une entrée |
| `docs/architecture/invariants/OPERATING.md` | format, ajout, retrait | créer ou réviser un invariant |
| `docs/architecture/BUILD.md` | les 9 étapes du gate | modifier `Makefile` ou CI |
| `docs/PRODUCT.md` | écrans et parcours | changer un comportement visible |
| `docs/HUMAN_INPUTS.md` | QR, clé OpenRouter, manuel | config utilisateur |
| `docs/RELEASE.md` | build, signature, release | livrer un APK |
| `docs/adr/` | décisions et leurs raisons | contester une règle |
| `android/`, `web/`, `server/` README | détail par module | travailler dans un module |
