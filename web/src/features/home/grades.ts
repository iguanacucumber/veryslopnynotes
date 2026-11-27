// Notes et moyennes : miroir d'`Averages.kt`, même règle des deux côtés.
import { formatNote } from "../../lib/format";
import { subjectKey } from "../../lib/subject";
import {
  asObject,
  boundedLimit,
  boundedText,
  millisOf,
  numberOrNull,
  payloadRoot,
  rowsOf,
  type Obj,
} from "./payload";

export interface Grade {
  id: string;
  subject: string;
  value: number;
  scale: number;
  coefficient: number | null;
  date: number;
  dateIso: string;
  bonus: boolean;
  optional: boolean;
}

function parseGradeRow(row: Obj | null, index: number): Grade | null {
  if (!row) return null;
  const subject = boundedText(row["subject"], 100);
  const value = numberOrNull(row["value"]);
  const scale = numberOrNull(row["scale"]);
  const date = millisOf(row["date"]);
  if (!subject || value === null || value < 0 || scale === null || scale <= 0 || date === null) {
    return null;
  }
  const coefficient = numberOrNull(row["coefficient"]);
  return {
    id: boundedText(row["id"], 64) || `grade-${index}`,
    subject,
    value,
    scale,
    coefficient,
    date,
    dateIso: boundedText(row["date"], 64),
    bonus: row["bonus"] === true,
    optional: row["optional"] === true,
  };
}

export function parseGrades(payload: string | null): Grade[] {
  const root = payloadRoot(payload);
  if (!root) return [];
  const out: Grade[] = [];
  const rows = rowsOf(root, "grades");
  for (let index = 0; index < rows.length; index++) {
    const grade = parseGradeRow(asObject(rows[index]), index);
    if (grade) out.push(grade);
  }
  return out.sort((a, b) => b.date - a.date);
}

/** Moyenne de l'établissement SEULEMENT : `origin` absent ou `estimated` ne
 *  fait pas d'une estimation une valeur fournie. */
export function providedGeneralAverage(payload: string | null): number | null {
  const root = payloadRoot(payload);
  if (!root) return null;
  const averages = asObject(root["averages"]);
  const general = averages ? asObject(averages["general"]) : null;
  if (!general || general["origin"] !== "provided") return null;
  const value = numberOrNull(general["value"]);
  return value !== null && value >= 0 ? value : null;
}

interface Sum {
  value: number;
  outOf: number;
}

function gradeUsable(grade: Grade): boolean {
  if (grade.coefficient === 0) return false;
  if (grade.coefficient !== null && grade.coefficient < 0) return false;
  return (
    Number.isFinite(grade.value) &&
    grade.value >= 0 &&
    Number.isFinite(grade.scale) &&
    grade.scale > 0
  );
}

/** Miroir d'`Averages.kt` : ramène sur /20 hors barème usuel. */
function addWeighted(sum: Sum, grade: Grade): void {
  const coefficient = grade.coefficient ?? 1;
  const outOf = grade.scale;
  if (grade.value > 20 || (coefficient < 1 && outOf - 20 >= -5) || outOf > 20) {
    sum.value += (grade.value / outOf) * 20 * coefficient;
    sum.outOf += 20 * coefficient;
  } else {
    sum.value += grade.value * coefficient;
    sum.outOf += outOf * coefficient;
  }
}

function contributionOf(grade: Grade): Sum | null {
  if (!gradeUsable(grade)) return null;
  if (grade.bonus) {
    const corrected = grade.value - grade.scale / 2;
    return corrected >= 0 ? { value: corrected, outOf: 1 } : { value: 0, outOf: 0 };
  }
  const sum: Sum = { value: 0, outOf: 0 };
  addWeighted(sum, grade);
  return sum;
}

function ratioTo20(sum: Sum | null): number | null {
  if (!sum || sum.outOf <= 0) return null;
  const result = Math.min((sum.value / sum.outOf) * 20, 20);
  return Number.isFinite(result) ? result : null;
}

/** Moyenne d'une matière : facultatives retenues seulement si elles améliorent
 *  la moyenne calculée SANS elles, comme `subjectAverageInner` d'`Averages.kt`.
 *  Chaque contribution est calculée une fois : le payload peut porter 400 notes. */
export function subjectAverage(grades: Grade[]): number | null {
  const contributions = grades.map(contributionOf);
  const full: Sum = { value: 0, outOf: 0 };
  for (const contribution of contributions) {
    if (!contribution) continue;
    full.value += contribution.value;
    full.outOf += contribution.outOf;
  }
  const withAll = ratioTo20(full);
  if (withAll === null) return null;
  const excluded = new Set<number>();
  for (let index = 0; index < grades.length; index++) {
    const grade = grades[index];
    const contribution = contributions[index];
    if (!grade || !contribution || !grade.optional) continue;
    const without = ratioTo20({
      value: full.value - contribution.value,
      outOf: full.outOf - contribution.outOf,
    });
    if ((without ?? -1) > withAll) excluded.add(index);
  }
  if (excluded.size === 0) return withAll;
  const retained: Sum = { value: full.value, outOf: full.outOf };
  for (const index of excluded) {
    const contribution = contributions[index];
    if (!contribution) continue;
    retained.value -= contribution.value;
    retained.outOf -= contribution.outOf;
  }
  return ratioTo20(retained);
}

export interface GeneralAverage {
  value: number | null;
  provided: boolean;
  subjectCount: number;
}

/** Moyennes de matière (une par matière), la règle d'`Averages.kt`. */
function subjectValuesOf(grades: Grade[]): number[] {
  const groups = new Map<string, Grade[]>();
  for (const grade of grades) {
    const key = subjectKey(grade.subject);
    const bucket = groups.get(key);
    if (bucket) bucket.push(grade);
    else groups.set(key, [grade]);
  }
  const values: number[] = [];
  for (const bucket of groups.values()) {
    const value = subjectAverage(bucket);
    if (value !== null) values.push(value);
  }
  return values;
}

function averageOf(values: number[]): number | null {
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

export function generalAverage(
  payload: string | null,
  grades: Grade[] = parseGrades(payload),
): GeneralAverage {
  const provided = providedGeneralAverage(payload);
  const subjectValues = subjectValuesOf(grades);
  return {
    value: provided ?? averageOf(subjectValues),
    provided: provided !== null,
    subjectCount: subjectValues.length,
  };
}

const MAX_HISTORY_POINTS = 40;

/** Moyenne estimée à chaque note, avec la MÊME règle que [generalAverage] :
 *  la courbe ne peut pas contredire le chiffre affiché. */
export function estimatedAverageSeries(grades: Grade[]): Array<number | null> {
  const sorted = [...grades].sort((a, b) => a.date - b.date);
  // Les préfixes courent sur TOUTES les notes : le dernier point est la
  // moyenne complète, jamais celle des 40 dernières.
  const series = sorted.map((_, index) => averageOf(subjectValuesOf(sorted.slice(0, index + 1))));
  return series.slice(-MAX_HISTORY_POINTS);
}

export function formatAverage(value: number): string {
  if (!Number.isFinite(value)) return "";
  let fixed = value.toFixed(2);
  if (fixed.endsWith("00")) fixed = fixed.slice(0, -3);
  else if (fixed.endsWith("0")) fixed = fixed.slice(0, -1);
  return fixed.replace(".", ",");
}

export function formatGrade(value: number, scale = 20): string {
  const note = formatNote(value, scale);
  return note ? `${note.replace(".", ",")}/20` : "";
}

export interface GradeSummary {
  id: string;
  subject: string;
  label: string;
  date: number;
  dateIso: string;
}

export function latestGrades(grades: Grade[], limit = 1): GradeSummary[] {
  const max = boundedLimit(limit, 1);
  return [...grades]
    .sort((a, b) => b.date - a.date)
    .slice(0, max)
    .map((grade) => ({
      id: grade.id,
      subject: grade.subject,
      label: formatGrade(grade.value, grade.scale),
      date: grade.date,
      dateIso: grade.dateIso,
    }));
}
