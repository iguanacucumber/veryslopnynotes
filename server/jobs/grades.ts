// Jobs v0 — diff structurée des notes (issue #17, phase 5, I7). Données
// structurées uniquement : aucun appel LLM, aucune sortie libre ne déclenche
// d'événement (garde testée dans jobs-guard.test.ts). Correction de note =
// événement dédié GradeCreated (nouvelle information à notifier).

import type { Grade } from "../../shared/contracts/models";

export interface GradeDiff {
  readonly added: Grade[];
  /** Même id, contenu différent (correction prof) → à notifier aussi. */
  readonly changed: Grade[];
  readonly removed: string[];
}

export function fingerprint(g: Grade): string {
  return JSON.stringify([g.subject, g.value, g.scale, g.coefficient ?? null, g.date]);
}

/** Diff contre empreintes persistées (moteur sync, snapshot versionné). */
export function diffAgainstPrints(previous: Record<string, string>, current: Grade[]): GradeDiff {
  const added: Grade[] = [];
  const changed: Grade[] = [];
  const seen = new Set<string>();
  for (const g of current) {
    seen.add(g.id);
    const print = previous[g.id];
    if (print === undefined) added.push(g);
    else if (print !== fingerprint(g)) changed.push(g);
  }
  const removed = Object.keys(previous).filter((id) => !seen.has(id));
  return { added, changed, removed };
}

export function diffGrades(previous: Grade[], current: Grade[]): GradeDiff {
  const prints: Record<string, string> = {};
  for (const g of previous) prints[g.id] = fingerprint(g);
  return diffAgainstPrints(prints, current);
}
