// Compteurs de présence par période (#77). Fonction pure : aucun Pronote,
// aucun HTTP, aucun sqlite (I3). Les compteurs sont DÉRIVÉS des absences
// publiées (kind + durationMinutes) — aucune valeur devinée, aucun effet
// métier ici : la détection de nouvelle absence se fait sur ces données
// structurées, jamais sur une sortie libre LLM (I7).

import { isAbsenceRecord } from "../../shared/contracts/models";
import type { AbsenceRecord, AttendancePeriod, Period } from "../../shared/contracts/models";

export function attendancePeriods(records: AbsenceRecord[], periods: Period[] = []): AttendancePeriod[] {
  const names = new Map<string, string>();
  for (const p of periods) if (typeof p?.id === "string" && p.id) names.set(p.id, p.name);

  const acc = new Map<string, AttendancePeriod>();
  for (const r of records) {
    // Enregistrement non conforme ou sans période : ignoré des compteurs (il
    // reste dans la liste renvoyée par l'API, on n'invente pas de période).
    if (!isAbsenceRecord(r) || r.periodId === undefined) continue;
    const cur = acc.get(r.periodId) ?? {
      periodId: r.periodId,
      ...(names.has(r.periodId) ? { name: names.get(r.periodId) as string } : {}),
      absences: 0,
      late: 0,
      missingMinutes: 0,
    };
    const minutes = cur.missingMinutes + (r.durationMinutes ?? 0);
    acc.set(r.periodId, r.kind === "late" ? { ...cur, late: cur.late + 1, missingMinutes: minutes } : { ...cur, absences: cur.absences + 1, missingMinutes: minutes });
  }
  return [...acc.values()].sort((a, b) => (a.periodId < b.periodId ? -1 : a.periodId > b.periodId ? 1 : 0));
}