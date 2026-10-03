// Fixtures 100 % synthétiques pour #78 (évaluations par compétences).
// Matières, notes et identifiants inventés : aucun secret, aucune URL réelle,
// aucun établissement réel. Rien ici ne vient de Pronote (I1/I6 : données).
import type { Evaluation, Skill } from "../../../shared/contracts/models";

export const syntheticAccountId = "acc-fake-78";

/** Compétence publiée avec couleur (hex) — l'app affiche la couleur du serveur. */
export const syntheticSkill: Skill = { id: "sk-nombres", label: "Nombres décimaux", color: "#3f51b5" };

/** Compétence sans couleur publiée : l'app dérive une couleur stable depuis l'id. */
export const syntheticSkillNoColor: Skill = { id: "sk-geometrie", label: "Géométrie" };

export const syntheticEvaluation: Evaluation = {
  id: "ev-fake-1",
  accountId: syntheticAccountId,
  periodId: "p-1",
  subject: "Maths-Fake",
  skillId: syntheticSkill.id,
  label: syntheticSkill.label,
  note: 12,
  scale: 20,
  date: "2026-09-20T10:00:00.000Z",
  classAverage: 10.5,
  color: syntheticSkill.color,
};

/** Non notée : `note: null` — doit être ignorée par TOUT calcul. */
export const syntheticUngradedEvaluation: Evaluation = {
  id: "ev-fake-2",
  accountId: syntheticAccountId,
  subject: "Maths-Fake",
  skillId: syntheticSkill.id,
  label: syntheticSkill.label,
  note: null,
  scale: 20,
  date: "2026-09-27T10:00:00.000Z",
};

/** Compétence jamais notée : chips "non noté", `value: null`. */
export const syntheticEmptySkillEvaluation: Evaluation = {
  id: "ev-fake-3",
  accountId: syntheticAccountId,
  subject: "Maths-Fake",
  skillId: syntheticSkillNoColor.id,
  label: syntheticSkillNoColor.label,
  note: null,
  scale: 20,
  date: "2026-09-28T10:00:00.000Z",
};

/** Note sur /10 : l'agrégat la ramène sur /20. */
export const syntheticScaledEvaluation: Evaluation = {
  id: "ev-fake-4",
  accountId: syntheticAccountId,
  subject: "Maths-Fake",
  skillId: syntheticSkill.id,
  label: syntheticSkill.label,
  note: 15,
  scale: 10,
  date: "2026-10-01T10:00:00.000Z",
};

export const syntheticEvaluations: Evaluation[] = [
  syntheticEvaluation,
  syntheticUngradedEvaluation,
  syntheticScaledEvaluation,
  syntheticEmptySkillEvaluation,
];

/** Client pronotets synthétique : évaluations par compétences incomplètes. */
export function syntheticCompetencyClient() {
  return {
    periods: [
      {
        id: "p-1",
        name: "Trimestre 1",
        start: new Date("2026-09-01T00:00:00.000Z"),
        end: new Date("2026-11-30T23:59:59.000Z"),
        evaluations: async () => [
          {
            id: "ev-1",
            name: "Nombres décimaux",
            subject: { name: "Maths-Fake" },
            acquisitions: [{ domainId: "sk-nombres", color: "#3F51B5" }],
            outOf: "20",
            grade: "12",
            date: new Date("2026-09-20T10:00:00.000Z"),
          },
          {
            // Pas de note publiée (établissement sans saisie) : note: null.
            id: "ev-2",
            name: "Nombres décimaux",
            subject: { name: "Maths-Fake" },
            acquisitions: [{ domainId: "sk-nombres" }],
            outOf: "20",
            date: new Date("2026-09-27T10:00:00.000Z"),
          },
          {
            // Champs minimaux : ni note, ni couleur, ni acquisition.
            id: "ev-3",
            name: "Géométrie",
            subject: { name: "Maths-Fake" },
            date: new Date("2026-09-28T10:00:00.000Z"),
          },
        ],
      },
    ],
  };
}

/** Client sans l'onglet évaluations (établissement non configuré) -> page vide. */
export function syntheticClientWithoutEvaluations() {
  return { periods: [{ id: "p-1", name: "Trimestre 1", grades: async () => [] }] };
}
