// Lecteurs des payloads de l'accueil et de l'EDT : aucun réseau, aucun HTML
// construit ici ; un payload est une DONNÉE. Les clés du contrat (`entries`,
// `assignments`, `grades`, `alerts`, `capabilities`) ou l'enveloppe `items` du
// pont factice sont acceptées, jamais devinées champ par champ.
import {
  asNumber,
  cleanText,
  formatNote,
  frDateShort,
  frDay,
  parseInstant,
} from "../../lib/format";
import { subjectKey } from "../../lib/subject";

/** Borne dure d'une liste lue dans un payload (anti-JSON géant). */
export const MAX_ITEMS = 400;

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

/** Clé de contrat, sinon l'enveloppe `items` du pont factice ; absente = liste
 *  vide, jamais une ligne inventée. */
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

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const PARIS_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const PARIS_CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Paris",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function intlPart(
  format: Intl.DateTimeFormat,
  date: Date,
  type: "year" | "month" | "day" | "hour" | "minute" | "second",
): string {
  return format.formatToParts(date).find((part) => part.type === type)?.value ?? "";
}

/** Jour civil de l'établissement (Europe/Paris) d'un instant. */
export function parisDayKeyOf(millis: number): string | null {
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return null;
  const year = intlPart(PARIS_DAY, date, "year");
  const month = intlPart(PARIS_DAY, date, "month");
  const day = intlPart(PARIS_DAY, date, "day");
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function parisClockOf(millis: number): string {
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return "";
  const hour = intlPart(PARIS_CLOCK, date, "hour");
  const minute = intlPart(PARIS_CLOCK, date, "minute");
  const second = intlPart(PARIS_CLOCK, date, "second");
  return hour && minute && second ? `${hour}:${minute}:${second}` : "";
}

/** Écart en jours civils entre deux clés `AAAA-MM-JJ` (étiquettes, pas instants). */
export function civilDayOffset(target: string, now: string): number {
  const a = Date.parse(`${target}T00:00:00Z`);
  const b = Date.parse(`${now}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((a - b) / 86_400_000) : Number.NaN;
}

/** Date locale à MIDI du jour civil : le libellé ne glisse pas d'un jour. */
function localNoonOfDayKey(key: string): Date | null {
  const match = DATE_ONLY.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day, 12);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
  return date;
}

function frDayOfKey(key: string): string {
  const date = localNoonOfDayKey(key);
  return date ? frDay(date) : "";
}

/** Minuit de l'établissement pour un jour civil : une date seule du contrat est
 *  un jour de Paris, pas minuit dans le fuseau de l'appareil. */
function parisMidnightOfDayKey(key: string): number | null {
  const date = localNoonOfDayKey(key);
  if (!date) return null;
  const midnightUtc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 0);
  const offset = parisOffsetMinutesAt(midnightUtc);
  if (!Number.isFinite(offset)) return null;
  let candidate = midnightUtc - offset * 60_000;
  // Une bascule DST peut changer l'offset entre minuit UTC et minuit local.
  const corrected = parisOffsetMinutesAt(candidate);
  if (Number.isFinite(corrected) && corrected !== offset) {
    candidate = midnightUtc - corrected * 60_000;
  }
  return candidate;
}

function parisOffsetMinutesAt(millis: number): number {
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return Number.NaN;
  const year = Number(intlPart(PARIS_DAY, date, "year"));
  const month = Number(intlPart(PARIS_DAY, date, "month"));
  const day = Number(intlPart(PARIS_DAY, date, "day"));
  const hour = Number(intlPart(PARIS_CLOCK, date, "hour"));
  const minute = Number(intlPart(PARIS_CLOCK, date, "minute"));
  const second = Number(intlPart(PARIS_CLOCK, date, "second"));
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  return (wall - date.getTime()) / 60_000;
}

function frDateShortOfKey(key: string): string {
  const date = localNoonOfDayKey(key);
  return date ? frDateShort(date.toISOString()) : "";
}

/** Date seule, ou minuit Paris (`PourLe` sans heure) : journée entière. */
function allDayDayKey(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  if (DATE_ONLY.test(text)) return millisOf(text) === null ? null : text;
  const millis = millisOf(text);
  if (millis === null || parisClockOf(millis) !== "00:00:00") return null;
  return parisDayKeyOf(millis);
}

/** La forme brute fait foi ; sinon un minuit Paris reste une journée entière,
 *  même quand l'appelant n'a que l'instant (même règle que `isAllDayDue`). */
function allDayKeyOf(due: number, raw: string): string | null {
  return allDayDayKey(raw) ?? (parisClockOf(due) === "00:00:00" ? parisDayKeyOf(due) : null);
}

function numberOrNull(value: unknown): number | null {
  const n = asNumber(value, Number.NaN);
  return Number.isFinite(n) ? n : null;
}

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

export const TIMETABLE_UNAVAILABLE = "Emploi du temps indisponible : aucune donnée n’a été lue.";
export const TIMETABLE_UNREADABLE = "Emploi du temps illisible : la donnée n’a pas pu être lue.";

/** Un JSON illisible ou sans liste de cours n'est PAS « aucun cours » (I14).
 *  `null` = aucun payload, traité à part par l'appelant. */
export function isTimetablePayloadReadable(payload: string | null): boolean {
  const root = payloadRoot(payload);
  return root !== null && (Array.isArray(root["entries"]) || Array.isArray(root["items"]));
}

/** Cours lisibles, triés par début. Les annulés restent ; un identifiant déjà
 *  vu n'est affiché qu'une fois. */
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

export function isUpcomingLesson(lesson: Lesson, now: number): boolean {
  return !isCancelled(lesson) && lesson.end > now;
}

export function upcomingLessons(lessons: Lesson[], now: number, limit = 3): Lesson[] {
  const max = boundedLimit(limit, 3);
  if (max === 0) return [];
  return lessons.filter((lesson) => isUpcomingLesson(lesson, now)).slice(0, max);
}

/** Compteur SANS plafond : la liste est un extrait, un compteur plafonné ment. */
export function upcomingCount(lessons: Lesson[], now: number): number {
  return lessons.filter((lesson) => isUpcomingLesson(lesson, now)).length;
}

export interface Assignment {
  id: string;
  subject: string;
  title: string;
  /** Une date seule est minuit de l'établissement (Paris), pas celui de l'appareil. */
  due: number;
  dueRaw: string;
  done: boolean;
}

/** Devoirs lisibles, triés par échéance ; identifiant déjà vu = une seule fois. */
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
    const dueRaw = boundedText(row["dueDate"], 64);
    const due = DATE_ONLY.test(dueRaw)
      ? parisMidnightOfDayKey(dueRaw)
      : millisOf(row["dueDate"]);
    if (!subject || !title || due === null) continue;
    const id = boundedText(row["id"], 64) || `assignment-${index}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      subject,
      title,
      due,
      dueRaw,
      done: row["done"] === true,
    });
  }
  return out.sort((a, b) => a.due - b.due);
}

/** Un devoir en retard reste à faire : il est compté. */
export function isPendingTask(task: Assignment): boolean {
  return !task.done && Number.isFinite(task.due);
}

export function isUpcomingTask(task: Assignment, now: number): boolean {
  if (!isPendingTask(task)) return false;
  const allDay = allDayKeyOf(task.due, task.dueRaw);
  if (allDay) {
    const today = parisDayKeyOf(now);
    return today !== null && civilDayOffset(allDay, today) >= 0;
  }
  return task.due > now;
}

export function pendingAssignments(
  assignments: Assignment[],
  now: number,
  limit = 3,
): Assignment[] {
  const max = boundedLimit(limit, 3);
  if (max === 0) return [];
  return assignments.filter((task) => isUpcomingTask(task, now)).slice(0, max);
}

/** Compteur SANS plafond ; un devoir en retard reste un devoir à faire. */
export function pendingCount(assignments: Assignment[]): number {
  return assignments.filter((task) => isPendingTask(task)).length;
}

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

export interface Alert {
  id: string;
  kind: string;
  excerpt: string;
  source: string;
}

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

export function alertCountLabel(count: number): string {
  if (count <= 0) return "Aucune alerte";
  return count === 1 ? "1 alerte" : `${count} alertes`;
}

/** `null` = inconnu, donc on montre tout : jamais une navigation amputée sur
 *  une supposition. */
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

export function tabVisible(capabilities: string[] | null, tab: string): boolean {
  return capabilities === null || capabilities.includes(tab);
}

/** Fenêtre de fraîcheur d'une entrée : un widget monté plus tard apparaît SANS
 *  entrée (une entrée tardive est une faute d'affichage, pas un effet). */
export const ENTRANCE_WINDOW_MS = 400;

/** Décision pure, figée au montage : la rejouer couperait l'animation en cours. */
export function shouldAnimateOnMount(openedAt: number, mountedAt: number): boolean {
  if (!Number.isFinite(openedAt) || !Number.isFinite(mountedAt)) return false;
  return mountedAt - openedAt <= ENTRANCE_WINDOW_MS;
}

/** Écart en JOURS civils de l'établissement (pas en heures : le changement
 *  d'heure ne compte pas, et le jour est celui de Paris). */
export function dayOffset(target: number, now: number): number {
  const targetKey = parisDayKeyOf(target);
  const nowKey = parisDayKeyOf(now);
  if (!targetKey || !nowKey) return Number.NaN;
  return civilDayOffset(targetKey, nowKey);
}

/** Heure de l'établissement, jamais l'heure brute du serveur. */
export function clockLabel(millis: number): string {
  return parisClockOf(millis).slice(0, 5);
}

export function timeRange(lesson: Lesson): string {
  const start = clockLabel(lesson.start);
  const end = clockLabel(lesson.end);
  return start && end && end !== start ? `${start}–${end}` : start;
}

export function dayLabel(target: number, now: number): string {
  const targetKey = parisDayKeyOf(target);
  const nowKey = parisDayKeyOf(now);
  if (!targetKey || !nowKey) return "";
  const offset = civilDayOffset(targetKey, nowKey);
  if (offset === 0) return "Aujourd’hui";
  if (offset === 1) return "Demain";
  if (offset === -1) return "Hier";
  const dd = targetKey.slice(8, 10);
  const mm = targetKey.slice(5, 7);
  return `${frDayOfKey(targetKey)} ${dd}/${mm}`;
}

export function courseWidgetTitle(first: Lesson | undefined, now: number): string {
  if (!first) return "";
  // Un cours commencé hier et encore en cours appartient à AUJOURD'HUI.
  const reference = first.start <= now && now < first.end ? now : first.start;
  const offset = dayOffset(reference, now);
  if (offset === 0) return "Aujourd’hui";
  if (offset === 1) return "Demain";
  return dayLabel(reference, now);
}

export function countdownFr(target: number, now: number): string {
  if (!Number.isFinite(target) || target <= now) return "";
  const minutes = Math.round((target - now) / 60_000);
  if (minutes <= 1) return "maintenant";
  if (minutes < 60) return `dans ${minutes} min`;
  const targetKey = parisDayKeyOf(target);
  const nowKey = parisDayKeyOf(now);
  const offset = targetKey && nowKey ? civilDayOffset(targetKey, nowKey) : Number.NaN;
  if (offset === 0) return `dans ${Math.round(minutes / 60)} h`;
  if (offset === 1) return `demain ${clockLabel(target)}`;
  if (offset > 1 && offset < 7 && targetKey) return `${frDayOfKey(targetKey)} ${clockLabel(target)}`;
  return targetKey ? frDateShortOfKey(targetKey) : "";
}

export function courseCountdown(lesson: Lesson, now: number): string {
  if (lesson.start <= now && now < lesson.end) return "en cours";
  return countdownFr(lesson.start, now);
}

/** Échéance d'une journée entière (date seule ou minuit Paris) : jamais
 *  « en retard » avant la fin du jour, et jamais « · 00:00 ». */
export function dueLabel(due: number, now: number, dueRaw = ""): string {
  const allDay = allDayKeyOf(due, dueRaw);
  if (allDay) {
    const nowKey = parisDayKeyOf(now);
    const offset = nowKey ? civilDayOffset(allDay, nowKey) : Number.NaN;
    if (offset < 0) return "en retard";
    if (offset === 0) return "aujourd’hui";
    if (offset === 1) return "demain";
    if (offset < 7) return frDayOfKey(allDay);
    return frDateShortOfKey(allDay);
  }
  const targetKey = parisDayKeyOf(due);
  const nowKey = parisDayKeyOf(now);
  const offset = targetKey && nowKey ? civilDayOffset(targetKey, nowKey) : Number.NaN;
  if (offset < 0) return "en retard";
  if (offset === 0) return `aujourd’hui ${clockLabel(due)}`;
  if (offset === 1) return `demain ${clockLabel(due)}`;
  if (offset < 7) return targetKey ? `${frDayOfKey(targetKey)} ${clockLabel(due)}` : "";
  return targetKey ? frDateShortOfKey(targetKey) : "";
}

export function durationLabel(millis: number): string {
  const minutes = Math.max(0, Math.floor(millis / 60_000));
  if (minutes < 1) return "";
  if (minutes < 60) return minutes === 1 ? "1 min" : `${minutes} mins`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest} mins`;
}

export function movedHint(lesson: Lesson): string {
  if (!isMoved(lesson) || lesson.originalStart === null) return "";
  const label = clockLabel(lesson.originalStart);
  return label ? `départ ${label}` : "";
}
