// Jobs v0 — détection DS/interro sur données structurées (issue #24,
// phase 7, I7). Heuristique à mots-frontières sur titres devoirs (+ sujet/
// salle EDT quand libellés dispos, phase 2+). `high` = effet notif auto
// possible (phase 7) ; `needs_confirm` = confirmation app obligatoire, aucun
// effet métier direct. Aucun LLM : fonction pure, push = #22/#23.

import type { Assignment, TimetableEntry } from "../../shared/contracts/models";

export type ExamConfidence = "high" | "needs_confirm";

export interface ExamCandidate {
  readonly source: "assignment" | "timetable";
  readonly id: string;
  readonly subject: string;
  readonly date: string;
  readonly confidence: ExamConfidence;
  readonly matched: string;
}

const HIGH = [
  "ds",
  "dst",
  "devoir surveille",
  "devoir commun",
  "controle",
  "interro",
  "interrogation",
  "evaluation",
  "examen",
  "partiel",
  "bac blanc",
  "brevet blanc",
];

const MAYBE = ["test", "qcm", "quiz", "bac", "brevet"];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

function matchKeyword(text: string, keywords: string[]): string | null {
  const norm = ` ${normalize(text).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()} `;
  for (const k of keywords) {
    if (norm.includes(` ${k} `)) return k;
  }
  return null;
}

export function examConfidence(title: string): { confidence: ExamConfidence; matched: string } | null {
  const high = matchKeyword(title, HIGH);
  if (high) return { confidence: "high", matched: high };
  const maybe = matchKeyword(title, MAYBE);
  if (maybe) return { confidence: "needs_confirm", matched: maybe };
  return null;
}

export function detectExams(assignments: Assignment[], entries: TimetableEntry[]): ExamCandidate[] {
  const out: ExamCandidate[] = [];
  for (const a of assignments) {
    const hit = examConfidence(a.title);
    if (hit) {
      out.push({
        source: "assignment",
        id: a.id,
        subject: a.subject,
        date: a.dueDate,
        confidence: hit.confidence,
        matched: hit.matched,
      });
    }
  }
  for (const e of entries) {
    const hit = examConfidence(`${e.subject} ${e.room ?? ""}`);
    if (hit) {
      out.push({
        source: "timetable",
        id: e.id,
        subject: e.subject,
        date: e.start,
        confidence: hit.confidence,
        matched: hit.matched,
      });
    }
  }
  return out;
}
