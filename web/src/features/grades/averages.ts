import { subjectKey } from "../../lib/subject";
import { MAX_AVERAGE_POINTS, MAX_ID_CHARS } from "./bounds";
import { gradeLabel } from "./labels";
import type { AveragesReport, Grade, HistoryPoint, Influence, SubjectAverage } from "./parse";

export type Algorithm = "subject" | "weighted" | "median";

export const ALGORITHMS: readonly Algorithm[] = ["subject", "weighted", "median"];
export const ALGORITHM_DEFAULT: Algorithm = "subject";

export function isAlgorithm(value: unknown): value is Algorithm {
  return value === "subject" || value === "weighted" || value === "median";
}

export interface GradeGroup {
  subject: string;
  average: number | null;
  provided: boolean;
  /** Notes RETENUES par la moyenne (coefficient 0 exclu) : le rapport natif
   *  fait foi, sinon le même compte local (notes exploitables). */
  gradeCount: number;
  grades: Grade[];
}

const NO_DATA = -1;

function weightOf(grade: Grade): number {
  const c = grade.coefficient;
  return c === null || !Number.isFinite(c) ? 1 : c;
}

function isExcluded(grade: Grade): boolean {
  return grade.coefficient === 0;
}

function isUsable(grade: Grade): boolean {
  if (isExcluded(grade)) return false;
  const c = grade.coefficient;
  if (c !== null && (!Number.isFinite(c) || c < 0)) return false;
  return (
    Number.isFinite(grade.value) &&
    grade.value >= 0 &&
    Number.isFinite(grade.scale) &&
    grade.scale > 0
  );
}

interface Sum {
  value: number;
  outOf: number;
}

function addWeighted(sum: Sum, grade: Grade, value: number): void {
  const coef = weightOf(grade);
  const outOf = grade.scale;
  if (value > 20 || (coef < 1 && outOf - 20 >= -5) || outOf > 20) {
    sum.value += (value / outOf) * 20 * coef;
    sum.outOf += 20 * coef;
  } else {
    sum.value += value * coef;
    sum.outOf += outOf * coef;
  }
}

function ratioTo20(sum: Sum): number {
  if (sum.outOf <= 0) return NO_DATA;
  const result = Math.min((sum.value / sum.outOf) * 20, 20);
  return Number.isNaN(result) ? NO_DATA : result;
}

function subjectAverageInner(grades: readonly Grade[], loop: boolean): number {
  const sum: Sum = { value: 0, outOf: 0 };
  for (let i = 0; i < grades.length; i++) {
    const grade = grades[i];
    if (!grade || !isUsable(grade)) continue;
    if (grade.optional && !loop) {
      const without = subjectAverageInner(grades.filter((_, index) => index !== i), true);
      const withAll = subjectAverageInner(grades, true);
      if (without > withAll) continue;
    }
    if (grade.bonus) {
      const corrected = grade.value - grade.scale / 2;
      if (corrected >= 0) {
        sum.value += corrected;
        sum.outOf += 1;
      }
      continue;
    }
    addWeighted(sum, grade, grade.value);
  }
  return ratioTo20(sum);
}

function groupBySubject(grades: readonly Grade[]): Array<[string, Grade[]]> {
  const groups = new Map<string, Grade[]>();
  for (const grade of grades) {
    const key = subjectKey(grade.subject);
    const bucket = groups.get(key);
    if (bucket) bucket.push(grade);
    else groups.set(key, [grade]);
  }
  return [...groups.entries()];
}

export function subjectAlgorithmAverage(grades: readonly Grade[]): number | null {
  if (grades.length === 0) return null;
  let total = 0;
  let counted = 0;
  for (const [, bucket] of groupBySubject(grades)) {
    const average = subjectAverageInner(bucket, false);
    if (average !== NO_DATA) {
      counted += 1;
      total += average;
    }
  }
  return counted > 0 ? total / counted : null;
}

export function weightedAlgorithmAverage(grades: readonly Grade[]): number | null {
  if (grades.length === 0) return null;
  const sum: Sum = { value: 0, outOf: 0 };
  for (const grade of grades) {
    if (!isUsable(grade)) continue;
    if (grade.bonus) {
      const corrected = grade.value - grade.scale / 2;
      if (corrected >= 0) {
        sum.value += corrected;
        sum.outOf += 1;
      }
      continue;
    }
    addWeighted(sum, grade, grade.value);
  }
  const result = ratioTo20(sum);
  return result === NO_DATA ? null : result;
}

export function medianAlgorithmAverage(grades: readonly Grade[]): number | null {
  const values: number[] = [];
  for (const grade of grades) {
    if (!isUsable(grade) || grade.bonus) continue;
    values.push((grade.value / grade.scale) * 20);
  }
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  const low = values[middle - 1];
  const high = values[middle];
  if (values.length % 2 === 0) {
    if (low === undefined || high === undefined) return null;
    return (low + high) / 2;
  }
  return high ?? null;
}

export function averageWith(algorithm: Algorithm | null, grades: readonly Grade[]): number | null {
  if (algorithm === "weighted") return weightedAlgorithmAverage(grades);
  if (algorithm === "median") return medianAlgorithmAverage(grades);
  return subjectAlgorithmAverage(grades);
}

export function gradesForPeriod(grades: readonly Grade[], periodId: string | null): Grade[] {
  const id = (periodId ?? "").trim();
  if (!id) return [...grades];
  const inPeriod = grades.filter((grade) => grade.periodId === id);
  if (inPeriod.length > 0) return inPeriod;
  // Établissement qui ne publie pas l'appartenance : filtrer viderait l'écran.
  return grades.every((grade) => !grade.periodId) ? [...grades] : [];
}

/** `Number(value.toFixed(2))` reproduit le `HALF_UP` natif ; l'arrondi binaire
 *  (`Math.round(v * 100) / 100`) dérive (`2.675 * 100` = `267.49999999999997`). */
export function twoDecimals(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Number(value.toFixed(2));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function buildHistory(algorithm: Algorithm, grades: readonly Grade[]): HistoryPoint[] {
  const sorted = [...grades].sort((a, b) => (a.millis ?? Number.MAX_SAFE_INTEGER) - (b.millis ?? Number.MAX_SAFE_INTEGER));
  const out: HistoryPoint[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const grade = sorted[i];
    if (!grade) continue;
    out.push({ date: grade.date, value: averageWith(algorithm, sorted.slice(0, i + 1)) });
  }
  return out.slice(-MAX_AVERAGE_POINTS);
}

function recentByDate(grades: readonly Grade[]): Grade[] {
  const sorted = [...grades].sort((a, b) => (a.millis ?? Number.MAX_SAFE_INTEGER) - (b.millis ?? Number.MAX_SAFE_INTEGER));
  return sorted.slice(-MAX_AVERAGE_POINTS);
}

function buildInfluences(algorithm: Algorithm, grades: readonly Grade[]): Influence[] {
  const general = averageWith(algorithm, grades);
  if (general === null) return [];
  const out: Influence[] = [];
  for (const grade of recentByDate(grades)) {
    const rest = grades.filter((g) => g.id !== grade.id);
    const without = averageWith(algorithm, rest) ?? 0;
    out.push({ gradeId: grade.id, subject: grade.subject, impact: twoDecimals(general - without) });
  }
  return out;
}

function buildSubjectAverages(grades: readonly Grade[]): SubjectAverage[] {
  const out = groupBySubject(grades).map(([, bucket]) => {
    const first = bucket[0];
    const estimated = subjectAverageInner(bucket, false);
    return {
      subject: first?.subject ?? "",
      value: estimated === NO_DATA ? null : estimated,
      provided: false,
      gradeCount: bucket.filter(isUsable).length,
    };
  });
  return out.sort((a, b) => a.subject.localeCompare(b.subject, "fr"));
}

/** `provided` toujours `false` : ce calcul ne sert que sans rapport du payload. */
export function computeAverages(
  grades: readonly Grade[],
  algorithm: Algorithm = ALGORITHM_DEFAULT,
  periodId: string | null = null,
): AveragesReport {
  const scoped = gradesForPeriod(grades, periodId);
  const subjects = buildSubjectAverages(scoped);
  return {
    algorithm,
    generalValue: averageWith(algorithm, scoped),
    provided: false,
    subjectCount: subjects.filter((s) => s.value !== null).length,
    subjects,
    history: buildHistory(algorithm, scoped),
    influences: buildInfluences(algorithm, scoped),
  };
}

/** Query du contrat `algorithm=…&periodId=…` ; periodId borné comme le routeur. */
export function gradesQuery(algorithm: Algorithm, periodId: string | null): string {
  const chosen = isAlgorithm(algorithm) ? algorithm : ALGORITHM_DEFAULT;
  const parts = [`algorithm=${encodeURIComponent(chosen)}`];
  const id = (periodId ?? "").trim().slice(0, MAX_ID_CHARS);
  if (id) parts.push(`periodId=${encodeURIComponent(id)}`);
  return parts.join("&");
}

/** Une carte par matière, regroupée par clé NORMALISÉE (`subjectKey`) comme le
 *  rapport natif. Repli local seulement sans entrée du rapport ; une entrée à
 *  `null` fait foi. */
export function gradeGroups(grades: readonly Grade[], subjects: readonly SubjectAverage[]): GradeGroup[] {
  const byKey = new Map<string, { subject: string; grades: Grade[] }>();
  for (const grade of grades) {
    const key = subjectKey(grade.subject);
    const bucket = byKey.get(key);
    if (bucket) bucket.grades.push(grade);
    else byKey.set(key, { subject: grade.subject, grades: [grade] });
  }
  // Le rapport est indexé par la même clé normalisée.
  const averages = new Map<string, SubjectAverage>();
  for (const subject of subjects) {
    const key = subjectKey(subject.subject);
    if (!averages.has(key)) averages.set(key, subject);
  }
  const keys: string[] = [];
  for (const key of byKey.keys()) keys.push(key);
  for (const key of averages.keys()) if (!byKey.has(key)) keys.push(key);
  return keys
    .map((key) => {
      const bucket = byKey.get(key);
      const average = averages.get(key);
      const grades = [...(bucket?.grades ?? [])].sort((a, b) => (b.millis ?? 0) - (a.millis ?? 0));
      const local = average === undefined ? subjectAverageInner(grades, false) : NO_DATA;
      return {
        subject: average?.subject ?? bucket?.subject ?? key,
        average: average ? average.value : local === NO_DATA ? null : local,
        provided: average?.provided ?? false,
        // Compter les notes RETENUES (coefficient 0 exclu), comme le natif.
        gradeCount: average?.gradeCount ?? grades.filter(isUsable).length,
        grades,
      };
    })
    .sort((a, b) => {
      // La différence de deux -Infinity est NaN : comparer avant de soustraire.
      const left = a.average ?? Number.NEGATIVE_INFINITY;
      const right = b.average ?? Number.NEGATIVE_INFINITY;
      if (left !== right) return right - left;
      return a.subject.localeCompare(b.subject, "fr");
    });
}

/** Recherche Papillon : la matière garde toutes ses notes si son nom correspond ;
 *  sinon seules les notes dont le libellé correspond restent visibles. */
export function filterGradeGroups(groups: readonly GradeGroup[], query: string): GradeGroup[] {
  const needle = fold(query);
  if (!needle) return [...groups];
  return groups.reduce<GradeGroup[]>((out, group) => {
    if (fold(group.subject).includes(needle)) {
      out.push(group);
      return out;
    }
    const grades = group.grades.filter((grade) => fold(gradeLabel(grade)).includes(needle));
    if (grades.length > 0) out.push({ ...group, grades });
    return out;
  }, []);
}

function fold(value: string): string {
  return value
    .toLocaleLowerCase("fr-FR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function influenceOf(influences: readonly Influence[], gradeId: string): Influence | null {
  return influences.find((influence) => influence.gradeId === gradeId) ?? null;
}
