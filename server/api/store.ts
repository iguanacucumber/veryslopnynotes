// API v0 — source de lecture (issue #10). Interface fine côté api/ pour
// ne toucher ni à server/domain/ (I3) ni à server/infrastructure/ (#11).
// Mémoire = seed/tests uniquement ; l'adaptateur SQLite (#11) implémentera
// ReadStore sans changer le routeur.

import type { Assignment, Grade, TimetableEntry } from "../../shared/contracts/models";

export interface ReadStore {
  grades(): Grade[];
  assignments(): Assignment[];
  entries(): TimetableEntry[];
}

export interface StoreSeed {
  readonly grades?: Grade[];
  readonly assignments?: Assignment[];
  readonly entries?: TimetableEntry[];
}

const SEED_GRADE: Grade = {
  id: "seed-g1",
  accountId: "seed-acc",
  subject: "Maths",
  value: 15,
  scale: 20,
  date: "2026-09-20T10:00:00.000Z",
};

const SEED_ASSIGNMENT: Assignment = {
  id: "seed-a1",
  accountId: "seed-acc",
  subject: "Français",
  title: "Rédaction",
  dueDate: "2026-10-05T08:00:00.000Z",
  done: false,
};

const SEED_ENTRY: TimetableEntry = {
  id: "seed-t1",
  accountId: "seed-acc",
  subject: "Histoire",
  start: "2026-10-03T08:00:00.000Z",
  end: "2026-10-03T09:00:00.000Z",
};

export function createMemoryStore(seed: StoreSeed = {}): ReadStore {
  const grades = structuredClone(seed.grades ?? [SEED_GRADE]);
  const assignments = structuredClone(seed.assignments ?? [SEED_ASSIGNMENT]);
  const entries = structuredClone(seed.entries ?? [SEED_ENTRY]);
  return {
    grades: () => structuredClone(grades),
    assignments: () => structuredClone(assignments),
    entries: () => structuredClone(entries),
  };
}
