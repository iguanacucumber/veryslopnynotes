// Lecteurs des payloads de l'accueil et de l'EDT.
//
// Port de `HomeWidgets.kt` / `TimetableWeek.kt` / `Averages.kt` (partie dont
// l'accueil a besoin) vers TypeScript. Aucun accès réseau, aucun HTML construit
// ici : un payload est une DONNÉE, les textes sont nettoyés et bornés, et React
// échappe le rendu.
//
// Les ponts natifs publient les clés du contrat (`entries`, `assignments`,
// `grades`, `alerts`, `capabilities`) ; le pont factice de `dev:web` enveloppe
// la même liste dans `items`. Les deux formes sont acceptées, jamais devinées
// champ par champ.
import {
  asNumber,
  cleanText,
  formatNote,
  frDateShort,
  frDay,
  frRange,
  parseInstant,
} from "../../lib/format";
import { subjectKey } from "../../lib/subject";

/** Borne dure d'une liste lue dans un payload (anti-JSON géant). */
export const MAX_ITEMS = 400;

/** Longueur maximale d'un texte affiché (matière, salle, titre, …). */
const MAX_TEXT = 200;

type Obj = Record<string, unknown>;

function asObject(value: unknown): Obj | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Obj)
    : null;
}

/** Texte borné en points de code, caractères de contrôle retirés. */
export function boundedText(value: unknown, max = MAX_TEXT): string {
  const text = cleanText(value);
  if (!text) return "";
  const points = Array.from(text);
  return (points.length <= max ? points : points.slice(0, max)).join("");
}

/** Entier positif borné (les payloads peuvent publier des flottants). */
function boundedLimit(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(Math.trunc(value), MAX_ITEMS));
}

function payloadRoot(payload: string | null): Obj | null {
  if (!payload || payload.length > 2_000_000) return null;
  try {
    return asObject(JSON.parse(payload) as unknown);
  } catch {
    return null;
  }
}

/**
 * Tableau d'une clé de contrat, sinon l'enveloppe `items` du pont factice.
 * Une clé absente rend une liste vide : l'écran affiche son état vide, jamais
 * une ligne inventée.
 */
function rowsOf(root: Obj, key: string, max = MAX_ITEMS): unknown[] {
  const direct = root[key];
  const items = Array.isArray(root["items"]) ? root["items"] : null;
  const rows = Array.isArray(direct) ? direct : items;
  return rows ? rows.slice(0, max) : [];
}

/** ISO-8601 (ou date seule) -> millis ; illisible = null, jamais `NaN`. Une
 *  date seule est minuit local (analyseur partagé) : elle ne glisse pas d'un
 *  jour à l'ouest de Greenwich. */
export function millisOf(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > 64) return null;
  if (
    !/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(
      text,
    )
  ) {
    return null;
  }
  return parseInstant(text);
}

function numberOrNull(value: unknown): number | null {
  const n = asNumber(value, Number.NaN);
  return Number.isFinite(n) ? n : null;
}

// --- EDT ---------------------------------------------------------------------

export type LessonStatus = "normal" | "cancelled" | "moved" | null;

export interface Lesson {
  id: string;
  subject: string;
  room: string | null;
  teacher: string | null;
  status: LessonStatus;
  start: number;
  end: number;
  startRaw: string;
  endRaw: string;
  originalStart: number | null;
}

function lessonStatus(value: unknown): LessonStatus {
  return value === "normal" || value === "cancelled" || value === "moved" ? value : null;
}

function optionalText(value: unknown): string | null {
  const text = boundedText(value, 100);
  return text || null;
}

/** Cours lisibles, triés par début. Les cours annulés restent (l'EDT les montre).
 *  Un cours déjà vu (même identifiant) n'est affiché qu'UNE fois (#570). */
export function parseTimetable(payload: string | null): Lesson[] {
  const root = payloadRoot(payload);
  if (!root) return [];
  const out: Lesson[] = [];
  const seen = new Set<string>();
  const rows = rowsOf(root, "entries");
  for (let index = 0; index < rows.length; index++) {
    const row = asObject(rows[index]);
    if (!row) continue;
    const subject = boundedText(row["subject"], 100);
    const start = millisOf(row["start"]);
    const end = millisOf(row["end"]);
    if (!subject || start === null || end === null || end < start) continue;
    const id = boundedText(row["id"], 64) || `lesson-${index}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      subject,
      room: optionalText(row["room"]),
      teacher: optionalText(row["teacher"]),
      status: lessonStatus(row["status"]),
      start,
      end,
      startRaw: boundedText(row["start"], 64),
      endRaw: boundedText(row["end"], 64),
      originalStart: millisOf(row["originalStart"]),
    });
  }
  return out.sort((a, b) => a.start - b.start || a.subject.localeCompare(b.subject, "fr"));
}

export function isCancelled(lesson: Lesson): boolean {
  return lesson.status === "cancelled";
}

export function isMoved(lesson: Lesson): boolean {
  return lesson.status === "moved";
}

/** Cours en cours ou à venir, annulés exclus, bornés (étage horloge). */
export function upcomingLessons(lessons: Lesson[], now: number, limit = 3): Lesson[] {
  const max = boundedLimit(limit, 3);
  if (max === 0) return [];
  return lessons.filter((lesson) => !isCancelled(lesson) && lesson.end > now).slice(0, max);
}

// --- Devoirs -----------------------------------------------------------------

export interface Assignment {
  id: string;
  subject: string;
  title: string;
  due: number;
  dueRaw: string;
  done: boolean;
}

/** Devoirs lisibles, triés par échéance. `done` est conservé pour filtrer.
 *  Un devoir déjà vu (même identifiant) n'est affiché qu'UNE fois (#570). */
export function parseAssignments(payload: string | null): Assignment[] {
  const root = payloadRoot(payload);
  if (!root) return [];
  const out: Assignment[] = [];
  const seen = new Set<string>();
  const rows = rowsOf(root, "assignments");
  for (let index = 0; index < rows.length; index++) {
    const row = asObject(rows[index]);
    if (!row) continue;
    const subject = boundedText(row["subject"], 100);
    const title = boundedText(row["title"], 200);
    const due = millisOf(row["dueDate"]);
    if (!subject || !title || due === null) continue;
    const id = boundedText(row["id"], 64) || `assignment-${index}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      subject,
      title,
      due,
      dueRaw: boundedText(row["dueDate"], 64),
      done: row["done"] === true,
    });
  }
  return out.sort((a, b) => a.due - b.due);
}

/** Devoirs non faits dont l'échéance n'est pas passée, bornés. */
export function pendingAssignments(
  assignments: Assignment[],
  now: number,
  limit = 3,
): Assignment[] {
  const max = boundedLimit(limit, 3);
  if (max === 0) return [];
  return assignments.filter((task) => !task.done && task.due > now).slice(0, max);
}

// --- Notes et moyennes -------------------------------------------------------

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

/** Moyenne générale publiée par l'établissement (`averages.general.value`). */
export function providedGeneralAverage(payload: string | null): number | null {
  const root = payloadRoot(payload);
  if (!root) return null;
  const averages = asObject(root["averages"]);
  const general = averages ? asObject(averages["general"]) : null;
  const value = general ? numberOrNull(general["value"]) : null;
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

/** Ajout pondéré de `Averages.kt` (ramène sur /20 hors barème usuel). */
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

function sumOf(grades: Grade[]): Sum | null {
  const sum: Sum = { value: 0, outOf: 0 };
  for (const grade of grades) {
    if (!gradeUsable(grade)) continue;
    if (grade.bonus) {
      const corrected = grade.value - grade.scale / 2;
      if (corrected >= 0) {
        sum.value += corrected;
        sum.outOf += 1;
      }
      continue;
    }
    addWeighted(sum, grade);
  }
  return sum.outOf > 0 ? sum : null;
}

function ratioTo20(sum: Sum | null): number | null {
  if (!sum || sum.outOf <= 0) return null;
  const result = Math.min((sum.value / sum.outOf) * 20, 20);
  return Number.isFinite(result) ? result : null;
}

/** Moyenne d'une matière : facultatives retenues seulement si elles améliorent. */
export function subjectAverage(grades: Grade[]): number | null {
  const required = grades.filter((grade) => !grade.optional);
  let chosen = required;
  let best = ratioTo20(sumOf(required));
  for (const optional of grades.filter((grade) => grade.optional)) {
    const candidate = ratioTo20(sumOf([...chosen, optional]));
    if (candidate !== null && (best === null || candidate > best)) {
      chosen = [...chosen, optional];
      best = candidate;
    }
  }
  return best;
}

export interface GeneralAverage {
  value: number | null;
  provided: boolean;
  subjectCount: number;
}

/** Moyenne générale : fournie par l'établissement d'abord, sinon moyenne des matières. */
export function generalAverage(
  payload: string | null,
  grades: Grade[] = parseGrades(payload),
): GeneralAverage {
  const provided = providedGeneralAverage(payload);
  const groups = new Map<string, Grade[]>();
  for (const grade of grades) {
    const key = subjectKey(grade.subject);
    const bucket = groups.get(key);
    if (bucket) bucket.push(grade);
    else groups.set(key, [grade]);
  }
  const subjectValues: number[] = [];
  for (const bucket of groups.values()) {
    const value = subjectAverage(bucket);
    if (value !== null) subjectValues.push(value);
  }
  const estimated =
    subjectValues.length > 0
      ? subjectValues.reduce((total, value) => total + value, 0) / subjectValues.length
      : null;
  return {
    value: provided ?? estimated,
    provided: provided !== null,
    subjectCount: subjectValues.length,
  };
}

/** "13,75" : la moyenne en grand, sans zéros inutiles. */
export function formatAverage(value: number): string {
  if (!Number.isFinite(value)) return "";
  let fixed = value.toFixed(2);
  if (fixed.endsWith("00")) fixed = fixed.slice(0, -3);
  else if (fixed.endsWith("0")) fixed = fixed.slice(0, -1);
  return fixed.replace(".", ",");
}

/** "15,5/20" : note ramenée sur /20, comme la carte d'accueil. */
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

// --- Alertes et capacités ----------------------------------------------------

export interface Alert {
  id: string;
  kind: string;
  excerpt: string;
  source: string;
}

/** Alertes locales (scan des contenus en cache), bornées. */
export function parseAlerts(payload: string | null): Alert[] {
  const root = payloadRoot(payload);
  if (!root) return [];
  const out: Alert[] = [];
  for (const row of rowsOf(root, "alerts", 50)) {
    const item = asObject(row);
    if (!item) continue;
    out.push({
      id: boundedText(item["id"], 64),
      kind: boundedText(item["kind"], 40),
      excerpt: boundedText(item["excerpt"], 200),
      source: boundedText(item["source"], 100),
    });
  }
  return out;
}

export function countAlerts(payload: string | null): number {
  return parseAlerts(payload).length;
}

export function alertCountLabel(count: number): string {
  if (count <= 0) return "Aucune alerte";
  return count === 1 ? "1 alerte" : `${count} alertes`;
}

/**
 * Onglets servis par l'établissement, `null` si le payload est absent ou
 * illisible. `null` = inconnu, donc on montre tout (jamais une navigation
 * amputée sur une supposition).
 */
export function parseCapabilities(payload: string | null): string[] | null {
  const root = payloadRoot(payload);
  if (!root) return null;
  const holder = asObject(root["capabilities"]) ?? asObject(root["items"]);
  if (!holder) return null;
  const tabs = holder["tabs"];
  if (!Array.isArray(tabs)) return null;
  const out: string[] = [];
  for (const raw of tabs.slice(0, 40)) {
    const tab = boundedText(raw, 40);
    if (tab && !out.includes(tab)) out.push(tab);
  }
  return out;
}

/** Un lien vers un onglet est visible si la capacité est inconnue ou présente. */
export function tabVisible(capabilities: string[] | null, tab: string): boolean {
  return capabilities === null || capabilities.includes(tab);
}

// --- Dates et libellés -------------------------------------------------------

/** Écart en JOURS locaux (pas en heures : le changement d'heure ne compte pas). */
export function dayOffset(target: number, now: number): number {
  const a = new Date(target);
  const b = new Date(now);
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcA - utcB) / 86_400_000);
}

/** "08:00" dans la zone du téléphone, jamais l'heure brute du serveur. */
export function clockLabel(millis: number): string {
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** "08:00–09:00", heure de début seule si la fin est illisible ou égale. */
export function timeRange(lesson: Lesson): string {
  const range = frRange(lesson.startRaw, lesson.endRaw).replace(/\s*[–-]\s*/g, "–");
  if (range) return range;
  const start = clockLabel(lesson.start);
  const end = clockLabel(lesson.end);
  return start && end && end !== start ? `${start}–${end}` : start;
}

/** "Aujourd’hui", "Demain", "Hier", sinon "lundi 05/10". */
export function dayLabel(target: number, now: number): string {
  const offset = dayOffset(target, now);
  if (offset === 0) return "Aujourd’hui";
  if (offset === 1) return "Demain";
  if (offset === -1) return "Hier";
  const date = new Date(target);
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${frDay(date)} ${dd}/${mm}`;
}

/** Titre du widget cours : « Aujourd’hui », « Demain », sinon la date. */
export function courseWidgetTitle(first: Lesson | undefined, now: number): string {
  if (!first) return "";
  const offset = dayOffset(first.start, now);
  if (offset === 0) return "Aujourd’hui";
  if (offset === 1) return "Demain";
  return dayLabel(first.start, now);
}

/** « dans 12 min », « en cours », « demain 08:00 ». Vide = pas de compteur. */
export function countdownFr(target: number, now: number): string {
  if (!Number.isFinite(target) || target <= now) return "";
  const minutes = Math.round((target - now) / 60_000);
  if (minutes <= 1) return "maintenant";
  if (minutes < 60) return `dans ${minutes} min`;
  const offset = dayOffset(target, now);
  if (offset === 0) return `dans ${Math.round(minutes / 60)} h`;
  if (offset === 1) return `demain ${clockLabel(target)}`;
  if (offset > 1 && offset < 7) return `${frDay(new Date(target))} ${clockLabel(target)}`;
  return frDateShort(new Date(target).toISOString());
}

export function courseCountdown(lesson: Lesson, now: number): string {
  if (lesson.start <= now && now < lesson.end) return "en cours";
  return countdownFr(lesson.start, now);
}

/** Échéance d'un devoir : « aujourd’hui 20:00 », « demain 20:00 », « 25 oct. ». */
export function dueLabel(due: number, now: number): string {
  const offset = dayOffset(due, now);
  if (offset < 0) return "en retard";
  if (offset === 0) return `aujourd’hui ${clockLabel(due)}`;
  if (offset === 1) return `demain ${clockLabel(due)}`;
  if (offset < 7) return `${frDay(new Date(due))} ${clockLabel(due)}`;
  return frDateShort(new Date(due).toISOString());
}

/** « 55 mins », « 1h 50 mins », « 2h ». Vide sous la minute. */
export function durationLabel(millis: number): string {
  const minutes = Math.max(0, Math.floor(millis / 60_000));
  if (minutes < 1) return "";
  if (minutes < 60) return minutes === 1 ? "1 min" : `${minutes} mins`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest} mins`;
}

/** "départ 08:00" d'un cours déplacé dont l'horaire d'origine est publié. */
export function movedHint(lesson: Lesson): string {
  if (!isMoved(lesson) || lesson.originalStart === null) return "";
  const label = clockLabel(lesson.originalStart);
  return label ? `départ ${label}` : "";
}
