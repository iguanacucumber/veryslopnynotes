import { describe, expect, test } from "bun:test";
import type { Assignment, TimetableEntry } from "../../shared/contracts/models";
import { detectExams, examConfidence } from "../../server/jobs/exams";
import type { ExamConfidence } from "../../server/jobs/exams";

const assignment = (id: string, title: string, subject = "Maths"): Assignment => ({
  id,
  accountId: "acc",
  subject,
  title,
  dueDate: "2026-10-06T08:00:00.000Z",
  done: false,
});

// Titre → confiance attendue (null = pas un DS).
const CASES: [string, ExamConfidence | null][] = [
  ["DS n°3 — fonctions", "high"],
  ["Devoir surveillé de maths", "high"],
  ["CONTRÔLE chapitre 4", "high"],
  ["Interro surprise vocabulaire", "high"],
  ["Interrogation écrite", "high"],
  ["Évaluation finale", "high"],
  ["Examen blanc d'histoire", "high"],
  ["Devoir commun de SVT", "high"],
  ["DST de physique", "high"],
  ["QCM chapitre 2", "needs_confirm"],
  ["Test de leçon", "needs_confirm"],
  ["Quiz en ligne", "needs_confirm"],
  ["DM pour lundi", null],
  ["Exposé sur la Révolution", null],
  ["Testez vos connaissances p.42", null],
  ["Lien Quizlet à réviser", null],
  ["Fiche méthode", null],
  ["Lire le chapitre 5", null],
];

describe("unit exams", () => {
  test("précision : chaque titre classé exactement", () => {
    for (const [title, expected] of CASES) {
      const hit = examConfidence(title);
      expect({ title, got: hit?.confidence ?? null }).toEqual({ title, got: expected });
    }
  });

  test("detectExams : sources, dates et zéro faux positif EDT", () => {
    const assignments = CASES.map(([title], i) => assignment(`a${i}`, title));
    const entries: TimetableEntry[] = [
      {
        id: "t1",
        accountId: "acc",
        subject: "Histoire",
        start: "2026-10-03T08:00:00.000Z",
        end: "2026-10-03T09:00:00.000Z",
      },
    ];
    const found = detectExams(assignments, entries);
    const expected = CASES.filter(([, c]) => c !== null).length;
    expect(found.length).toBe(expected);
    expect(found.every((c) => c.source === "assignment")).toBe(true);
    expect(found.find((c) => c.id === "a0")).toMatchObject({
      subject: "Maths",
      date: "2026-10-06T08:00:00.000Z",
      confidence: "high",
      matched: "ds",
    });
    // Incertains isolés : confirmation app requise (I7), jamais d'effet auto.
    const uncertain = found.filter((c) => c.confidence === "needs_confirm").map((c) => c.id);
    expect(uncertain.length).toBe(3);
  });
});
