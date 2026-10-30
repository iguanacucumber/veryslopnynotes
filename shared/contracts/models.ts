// Contrats v0 — modèles app↔serveur (source de vérité, phase 1, issue #4).
// Les API convertissent domaine → contrats, sans logique Pronote/métier.
// Versionnée : tout changement cassant = bump majeur + PR justificative.
//
// Les modèles sont découpés par domaine dans `models/` ; ce fichier est le
// barrel qui préserve l'API publique inchangée (`shared/contracts/models`).
//
// Index par domaine :
//   core          versions, RevisionSheet, Grade, Period
//   averages      moyennes (algorithmes Papillon)
//   assignments   devoirs, pièces jointes, cours de devoir
//   timetable     EDT
//   subject-prefs préférences matière
//   news          actualités
//   canteen       menus + solde
//   attendance    absences, retards, sanctions
//   profile       profil compte
//   capabilities  onglets dynamiques
//   messages      discussions, messages, destinataires
//
// Voir shared/contracts/README.md, docs/architecture/INVARIANTS.md (I7 : push
// et détection DS sur données structurées uniquement, jamais sortie LLM).
export * from "./models/index";
