// Lecture défensive des moyennes. Toute chaîne du payload est une DONNÉE,
// nettoyée et bornée avant de sortir d'ici.
import { asNumber, cleanText, parseDate } from "../../lib/format";
import { subjectKey } from "../../lib/subject";

export type Algorithm = "subject" | "weighted" | "median";

export const ALGORITHMS: readonly Algorithm[] = ["subject", "weighted", "median"];
export const ALGORITHM_DEFAULT: Algorithm = "subject";

export function isAlgorithm(value: unknown): value is Algorithm {
  return value === "subject" || value === "weighted" || value === "median";
}

export interface Grade {
  id: string;
  subject: string;
  value: number;
  scale: number;
  coefficient: number | null;
  date: string;
  millis: number | null;
  classAverage: number | null;
  classMin: number | null;
  classMax: number | null;
  periodId: string | null;
  bonus: boolean;
  optional: boolean;
  label: string | null;
  teacher: string | null;
}

export interface SubjectAverage {
  subject: string;
  value: number | null;
  provided: boolean;
  gradeCount: number;
}

export interface HistoryPoint {
  date: string;
  value: number | null;
}

export interface Influence {
  gradeId: string;
  subject: string;
  impact: number;
}

export interface AveragesReport {
  algorithm: Algorithm;
  /** Moyenne générale sur /20, `null` = aucune note exploitable. */
  generalValue: number | null;
  /** `true` = moyenne publiée par l'établissement. */
  provided: boolean;
  subjectCount: number;
  subjects: SubjectAverage[];
  history: HistoryPoint[];
  influences: Influence[];
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

export interface Period {
  id: string;
  name: string;
  start: string | null;
  end: string | null;
}

export interface GradesData {
  grades: Grade[];
  report: AveragesReport | null;
}

// Bornes de lecture, mêmes valeurs que le Kotlin.
const MAX_SUBJECT_CHARS = 100;
const MAX_LABEL_CHARS = 200;
const MAX_TEACHER_CHARS = 100;
const MAX_PERIOD_NAME_CHARS = 100;
const MAX_ID_CHARS = 64;
const MAX_AVERAGE_POINTS = 200;

const NO_DATA = -1;

type Json = Record<string, unknown>;

function record(value: unknown): Json | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : null;
}

function items(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function parseJson(payload: string | null): unknown {
  if (!payload) return null;
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return null;
  }
}

/** Texte borné : vide ou trop long = absent (jamais tronqué au milieu d'un mot). */
function bounded(value: unknown, max: number): string | null {
  const text = cleanText(value);
  return text.length === 0 || text.length > max ? null : text;
}

function numberOrNull(value: unknown): number | null {
  const n = asNumber(value, Number.NaN);
  return Number.isFinite(n) ? n : null;
}

/** Une moyenne négative est une donnée incohérente : traitée comme ABSENTE. */
function markOrNull(value: unknown): number | null {
  const n = numberOrNull(value);
  return n !== null && n >= 0 ? n : null;
}

function flag(value: unknown): boolean {
  return value === true;
}

function dateOf(value: unknown): { text: string; millis: number | null } | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  const date = parseDate(text);
  return date ? { text, millis: date.getTime() } : null;
}

function parseGrade(raw: unknown): Grade | null {
  const obj = record(raw);
  if (!obj) return null;
  const id = bounded(obj["id"], MAX_ID_CHARS);
  const subject = bounded(obj["subject"], MAX_SUBJECT_CHARS);
  const value = numberOrNull(obj["value"]);
  const scale = numberOrNull(obj["scale"]);
  const date = dateOf(obj["date"]);
  if (!id || !subject || value === null || scale === null || !date) return null;
  if (value < 0 || scale <= 0) return null;
  const coefficient = numberOrNull(obj["coefficient"]);
  const periodId = bounded(obj["periodId"], MAX_ID_CHARS);
  return {
    id,
    subject,
    value,
    scale,
    // Un coefficient 0 exclut la note du calcul (règle Papillon).
    coefficient,
    date: date.text,
    millis: date.millis,
    classAverage: numberOrNull(obj["classAverage"]),
    classMin: numberOrNull(obj["classMin"]),
    classMax: numberOrNull(obj["classMax"]),
    periodId,
    bonus: flag(obj["bonus"]),
    optional: flag(obj["optional"]),
    label: bounded(obj["label"], MAX_LABEL_CHARS),
    teacher: bounded(obj["teacher"], MAX_TEACHER_CHARS),
  };
}

function parseSubjectAverage(raw: unknown): SubjectAverage | null {
  const obj = record(raw);
  if (!obj) return null;
  const subject = bounded(obj["subject"], MAX_SUBJECT_CHARS);
  const origin = obj["origin"];
  if (!subject || (origin !== "provided" && origin !== "estimated")) return null;
  return {
    subject,
    value: markOrNull(obj["value"]),
    provided: origin === "provided",
    gradeCount: Math.max(0, Math.trunc(asNumber(obj["gradeCount"], 0))),
  };
}

function parseHistoryPoint(raw: unknown): HistoryPoint | null {
  const obj = record(raw);
  if (!obj) return null;
  const date = dateOf(obj["date"]);
  if (!date) return null;
  return { date: date.text, value: markOrNull(obj["value"]) };
}

function parseInfluence(raw: unknown): Influence | null {
  const obj = record(raw);
  if (!obj) return null;
  const gradeId = bounded(obj["gradeId"], MAX_ID_CHARS);
  const subject = bounded(obj["subject"], MAX_SUBJECT_CHARS);
  const impact = numberOrNull(obj["impact"]);
  if (!gradeId || !subject || impact === null) return null;
  return { gradeId, subject, impact };
}

function parseReport(raw: unknown): AveragesReport | null {
  const obj = record(raw);
  if (!obj) return null;
  const general = record(obj["general"]);
  if (!general) return null;
  const origin = general["origin"];
  if (origin !== "provided" && origin !== "estimated") return null;
  return {
    algorithm: isAlgorithm(obj["algorithm"]) ? obj["algorithm"] : ALGORITHM_DEFAULT,
    generalValue: markOrNull(general["value"]),
    provided: origin === "provided",
    subjectCount: Math.max(0, Math.trunc(asNumber(general["subjectCount"], 0))),
    subjects: items(obj["subjects"]).map(parseSubjectAverage).filter((s): s is SubjectAverage => s !== null),
    history: items(obj["history"]).map(parseHistoryPoint).filter((p): p is HistoryPoint => p !== null),
    influences: items(obj["influences"]).map(parseInfluence).filter((i): i is Influence => i !== null),
  };
}

/** Payload `/v1/grades` : `{items}` (pont factice) ou `{grades, averages}`.
 *  Sans rapport valide, il est recalculé localement, jamais inventé. */
export function parseGradesPayload(
  payload: string | null,
  algorithm: Algorithm = ALGORITHM_DEFAULT,
  periodId: string | null = null,
): GradesData {
  const root = record(parseJson(payload));
  if (!root) return { grades: [], report: null };
  const grades = items(root["grades"] ?? root["items"])
    .map(parseGrade)
    .filter((g): g is Grade => g !== null)
    .sort((a, b) => (b.millis ?? 0) - (a.millis ?? 0));
  const report = parseReport(root["averages"]) ?? (grades.length > 0 ? computeAverages(grades, algorithm, periodId) : null);
  return { grades, report };
}

/** Un JSON illisible n'est PAS une absence de note (I14 : « invalide » n'est
 *  jamais « vide »). `null` = aucun payload, traité à part par l'appelant. */
export function isGradesPayloadReadable(payload: string | null): boolean {
  if (payload === null) return false;
  return record(parseJson(payload)) !== null;
}

/** Payload `/v1/periods` -> tranches, dans l'ordre du contrat. */
export function parsePeriods(payload: string | null): Period[] {
  const root = record(parseJson(payload));
  if (!root) return [];
  const out: Period[] = [];
  for (const raw of items(root["periods"] ?? root["items"])) {
    const obj = record(raw);
    if (!obj) continue;
    const id = bounded(obj["id"], MAX_ID_CHARS);
    const name = bounded(obj["name"], MAX_PERIOD_NAME_CHARS);
    if (!id || !name) continue;
    const start = dateOf(obj["start"]);
    const end = dateOf(obj["end"]);
    if (start?.millis != null && end?.millis != null && end.millis < start.millis) continue;
    out.push({ id, name, start: start?.text ?? null, end: end?.text ?? null });
  }
  return out;
}

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

export function influenceOf(influences: readonly Influence[], gradeId: string): Influence | null {
  return influences.find((influence) => influence.gradeId === gradeId) ?? null;
}

export function formatMark(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "—";
  const digits = Math.min(4, Math.max(0, Math.trunc(decimals)));
  return value.toFixed(digits).replace(".", ",");
}

export function gradeValueLabel(value: number): string {
  const two = formatMark(value);
  if (two.endsWith(",00")) return two.slice(0, -3);
  if (two.endsWith("0")) return two.slice(0, -1);
  return two;
}

/** « /20 », ou le barème réel quand l'évaluation sort de l'échelle. */
export function scaleSuffix(scale: number): string {
  return Number.isFinite(scale) && scale > 0 ? `/${gradeValueLabel(scale)}` : "";
}

export function algorithmLabel(algorithm: Algorithm): string {
  if (algorithm === "weighted") return "Moyenne pondérée";
  if (algorithm === "median") return "Médiane des notes";
  return "Moyenne des matières";
}

/** Une moyenne fournie ne dépend pas de l'algorithme choisi. */
export function reportTitle(report: AveragesReport): string {
  return report.provided ? "Moyenne générale" : algorithmLabel(report.algorithm);
}

export function algorithmChipLabel(algorithm: Algorithm): string {
  if (algorithm === "weighted") return "Pondérée";
  if (algorithm === "median") return "Médiane";
  return "Matières";
}

/** Quand la moyenne est publiée, les puces ne portent que sur la courbe et les
 *  influences, estimées : le dire évite de croire que « Médiane » a produit le 12,50. */
export function algorithmHint(algorithm: Algorithm, provided = false): string {
  if (provided) {
    return "Moyenne publiée par l'établissement ; la courbe et les influences sont estimées.";
  }
  if (algorithm === "weighted") return "Chaque note pèse selon son coefficient.";
  if (algorithm === "median") return "La médiane de toutes les notes, peu sensible aux extrêmes.";
  return "Moyenne simple des moyennes de matières.";
}

export function coverageLabel(report: AveragesReport): string {
  const grades = report.subjects.reduce((total, subject) => total + subject.gradeCount, 0);
  const parts: string[] = [];
  if (report.subjectCount > 0) {
    parts.push(`${report.subjectCount} matière${report.subjectCount > 1 ? "s" : ""}`);
  }
  if (grades > 0) parts.push(`${grades} note${grades > 1 ? "s" : ""}`);
  return parts.join(" · ");
}

export function originLabel(provided: boolean, estimatedAt: string | null): string {
  if (provided) return "publiée par l'établissement";
  const date = parseDate(estimatedAt);
  if (!date) return "estimée";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `estimée au ${day}/${month}/${date.getFullYear()}`;
}

export function averageLabel(value: number | null, provided: boolean, algorithm: Algorithm): string {
  if (value === null) return "Moyenne indisponible sur cette période.";
  const origin = provided ? "fournie" : `estimée, algorithme ${algorithmChipLabel(algorithm).toLowerCase()}`;
  return `${formatMark(value)}/20 (moyenne ${origin})`;
}

export function influenceLabel(impact: number, estimated = false): string {
  if (!Number.isFinite(impact)) return "";
  const rounded = formatMark(Math.abs(impact));
  const target = estimated ? "sur la moyenne estimée" : "sur la moyenne";
  if (rounded === "0,00") return estimated ? "Sans effet sur la moyenne estimée" : "Sans effet sur la moyenne";
  return `${impact > 0 ? "+" : "−"}${rounded} ${target}`;
}

export function gradeContextLabel(grade: Grade): string {
  const parts: string[] = [];
  if (grade.coefficient !== null && grade.coefficient !== 1) {
    parts.push(`Coeff. ${gradeValueLabel(grade.coefficient)}`);
  }
  if (grade.bonus) parts.push("Bonus");
  if (grade.optional) parts.push("Facultatif");
  if (grade.teacher) parts.push(grade.teacher);
  if (grade.classAverage !== null) parts.push(`Moyenne de classe ${gradeValueLabel(grade.classAverage)}`);
  if (grade.classMin !== null && grade.classMax !== null) {
    parts.push(`De ${gradeValueLabel(grade.classMin)} à ${gradeValueLabel(grade.classMax)}`);
  }
  return parts.join(" · ");
}

/** Repli sur la matière : jamais une chaîne vide. */
export function gradeLabel(grade: Grade): string {
  return grade.label?.trim() || grade.subject;
}

export function periodLabel(period: Period): string {
  const start = period.start ? formatDay(period.start) : "";
  const end = period.end ? formatDay(period.end) : "";
  const range =
    start && end ? `${start} – ${end}` : start ? `depuis le ${start}` : end ? `jusqu'au ${end}` : "";
  return range ? `${period.name} · ${range}` : period.name;
}

function formatDay(value: string): string {
  const date = parseDate(value);
  if (!date) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getFullYear()}`;
}

export interface SparkPoint {
  x: number;
  y: number;
}

function knownValues(values: readonly (number | null)[]): number[] {
  return values.filter((value): value is number => value !== null && Number.isFinite(value));
}

/** Points de la courbe : valeurs nulles ignorées, moins de deux valeurs = aucun
 *  tracé, y inversé (la meilleure moyenne en haut). */
export function sparklinePoints(
  values: readonly (number | null)[],
  width: number,
  height: number,
): SparkPoint[] {
  if (!(width > 0) || !(height > 0)) return [];
  const known = knownValues(values);
  if (known.length === 0) return [];
  if (known.length === 1) return [{ x: width, y: height / 2 }];
  const min = Math.min(...known);
  const max = Math.max(...known);
  const span = max - min;
  const step = width / (known.length - 1);
  return known.map((value, index) => ({
    x: index * step,
    y: height * (1 - (span <= 0 ? 0.5 : (value - min) / span)),
  }));
}

/** Ordonnée de la moyenne, dans l'échelle de `sparklinePoints` ; `null` quand
 *  la ligne n'apprendrait rien (moins de deux points, série plate). */
export function sparklineAverageY(values: readonly (number | null)[], height: number): number | null {
  const known = knownValues(values);
  if (known.length < 2 || !(height > 0)) return null;
  const min = Math.min(...known);
  const max = Math.max(...known);
  const span = max - min;
  if (span <= 0) return null;
  const average = known.reduce((sum, value) => sum + value, 0) / known.length;
  return height * (1 - (average - min) / span);
}

/** Quand la moyenne est fournie, la courbe reste une estimation : le dire évite
 *  de faire passer le dernier point pour la moyenne de l'établissement. */
export function historyNote(values: readonly (number | null)[], provided = false): string {
  const size = knownValues(values).length;
  if (size === 0) {
    return provided
      ? "Pas d'historique de moyenne estimée sur cette période."
      : "Pas d'historique de moyenne sur cette période.";
  }
  if (size === 1) {
    return provided
      ? "Une seule moyenne estimée connue : la courbe se dessine à la note suivante."
      : "Une seule moyenne connue : la courbe se dessine à la note suivante.";
  }
  if (provided) return "Courbe estimée à partir des notes ; la moyenne affichée est celle de l'établissement.";
  return "";
}

export function sparklineDescription(values: readonly (number | null)[], provided = false): string {
  const known = knownValues(values);
  if (known.length === 0) return "Pas d'historique de moyenne.";
  const first = known[0];
  const last = known[known.length - 1];
  if (first === undefined || last === undefined) return "Pas d'historique de moyenne.";
  const kind = provided ? "estimée " : "";
  if (known.length === 1) return `Une seule moyenne ${kind}connue : ${gradeValueLabel(first)} sur 20.`;
  return `Évolution ${kind}de la moyenne : de ${gradeValueLabel(first)} à ${gradeValueLabel(last)}.`;
}
