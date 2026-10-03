// server/domain/competences.ts — agrégat par compétence (issue #78, parité Papillon).
// I3 : fonctions pures sur contrats, aucun réseau/SQLite/HTTP, aucun LLM.
// Règle sûre (point d'acceptation) : une Evaluation `note: null` (non notée)
// n'entre dans AUCUN calcul — ni moyenne, ni compteur. Jamais de 0 substitué.
// Moyenne sur /20 comme Papillon (ramenée depuis l'échelle de chaque note).
// Tri stable (matière puis libellé) pour des chips qui ne se réordonnent pas.

import type { CompetenceSummary, Evaluation, Skill } from "../../shared/contracts/models";
import { SKILL_LABEL_MAX_CHARS } from "../../shared/contracts/models";

function bySubjectThenLabel<T extends { subject: string; label: string }>(items: T[]): T[] {
  return items.sort((a, b) => a.subject.localeCompare(b.subject, "fr") || a.label.localeCompare(b.label, "fr"));
}

/** Compétences distinctes vues dans les évaluations (libellé + couleur si publiée). */
export function buildSkills(evaluations: Evaluation[]): Skill[] {
  const byId = new Map<string, Skill>();
  for (const e of evaluations) {
    if (byId.has(e.skillId)) continue;
    byId.set(e.skillId, { id: e.skillId, label: e.label.slice(0, SKILL_LABEL_MAX_CHARS), color: e.color });
  }
  return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

/** Agrégat par compétence : moyenne des notes définies, `value: null` si aucune. */
export function buildCompetenceSummary(evaluations: Evaluation[]): CompetenceSummary[] {
  const groups = new Map<string, Evaluation[]>();
  for (const e of evaluations) {
    const bucket = groups.get(e.skillId);
    if (bucket) bucket.push(e);
    else groups.set(e.skillId, [e]);
  }
  const out: CompetenceSummary[] = [];
  for (const [skillId, bucket] of groups) {
    let total = 0;
    let count = 0;
    for (const e of bucket) {
      // Note indéfinie/non notée = ignorée partout (pas de division, pas de 0).
      if (e.note === null || !Number.isFinite(e.note) || e.note < 0) continue;
      if (!Number.isFinite(e.scale) || e.scale <= 0) continue;
      total += (e.note / e.scale) * 20;
      count += 1;
    }
    out.push({
      skillId,
      label: bucket[0].label.slice(0, SKILL_LABEL_MAX_CHARS),
      subject: bucket[0].subject,
      value: count > 0 ? Number((total / count).toFixed(2)) : null,
      evaluationCount: count,
    });
  }
  return bySubjectThenLabel(out);
}
