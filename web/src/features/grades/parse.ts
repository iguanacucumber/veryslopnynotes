// Lecture défensive des moyennes. Toute chaîne du payload est une DONNÉE,
// nettoyée et bornée avant de sortir d'ici.
import { asNumber, cleanText, parseDate } from "../../lib/format";
import { ALGORITHM_DEFAULT, computeAverages, isAlgorithm, type Algorithm } from "./averages";
import {
  MAX_GRADES,
  MAX_ID_CHARS,
  MAX_LABEL_CHARS,
  MAX_PERIOD_NAME_CHARS,
  MAX_PERIODS,
  MAX_SUBJECT_CHARS,
  MAX_TEACHER_CHARS,
} from "./bounds";

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

type Json = Record<string, unknown>;

function record(value: unknown): Json | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : null;
}

function items(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Première occurrence de chaque id, dans l'ordre du payload et borné. */
function uniqueById<T extends { id: string }>(items: readonly T[], max: number): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (out.length >= max) break;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
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
  const grades = uniqueById(
    items(root["grades"] ?? root["items"])
      .slice(0, MAX_GRADES)
      .map(parseGrade)
      .filter((g): g is Grade => g !== null),
    MAX_GRADES,
  );
  // Le rapport local est calculé dans l'ordre du payload (comme le natif) :
  // trier d'abord inverserait l'historique de deux notes de même date.
  const report = parseReport(root["averages"]) ?? (grades.length > 0 ? computeAverages(grades, algorithm, periodId) : null);
  grades.sort((a, b) => (b.millis ?? 0) - (a.millis ?? 0));
  return { grades, report };
}

/** Un JSON illisible n'est PAS une absence de note (I14 : « invalide » n'est
 *  jamais « vide »). `null` = aucun payload, traité à part par l'appelant. */
export function isGradesPayloadReadable(payload: string | null): boolean {
  if (payload === null) return false;
  return record(parseJson(payload)) !== null;
}

/** Un JSON illisible n'est PAS « aucune période » (I14). `{}` reste lisible
 *  comme pour les notes : l'absence de liste est un état vide, pas une erreur. */
export function isPeriodsPayloadReadable(payload: string | null): boolean {
  if (payload === null) return false;
  const root = record(parseJson(payload));
  if (!root) return false;
  const list = root["periods"] ?? root["items"];
  return list === undefined || Array.isArray(list);
}

/** Payload `/v1/periods` -> tranches, dans l'ordre du contrat. */
export function parsePeriods(payload: string | null): Period[] {
  const root = record(parseJson(payload));
  if (!root) return [];
  const out: Period[] = [];
  for (const raw of items(root["periods"] ?? root["items"]).slice(0, MAX_PERIODS)) {
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
  return uniqueById(out, MAX_PERIODS);
}
