// Logique pure de l'écran Tâches, portée de `AssignmentsSections.kt` et
// `AssignmentsRepository.kt`. Aucun React, aucun réseau : les parsers et les
// regroupements sont testables avec un `now` injecté.
import { addDays, frDate, frTime, isoDay, parseDate, startOfWeek } from "../../lib/format";

export interface AssignmentAttachment {
  id: string;
  label: string;
  ref: string;
}

export interface AssignmentLessonContent {
  title: string;
  excerpt: string;
}

export interface Assignment {
  id: string;
  subject: string;
  title: string;
  dueDate: string;
  done: boolean;
  description: string;
  lessonContent: AssignmentLessonContent | null;
  attachments: AssignmentAttachment[];
  periodId: string | null;
  weekId: string | null;
}

export interface AssignmentsPayload {
  items: Assignment[];
  /** Lundi de la semaine publiée par le payload, si le serveur l'a bornée. */
  weekStart: string | null;
  /** Dimanche de la semaine publiée (dérivé de `weekStart` s'il manque). */
  weekEnd: string | null;
}

export type AssignmentSectionId = "overdue" | "today" | "week" | "later" | "done";

export interface AssignmentSection {
  id: AssignmentSectionId;
  title: string;
  items: Assignment[];
}

const MAX_DESCRIPTION = 2000;
const MAX_ATTACHMENTS = 10;
const MAX_LABEL = 200;
const MAX_REF = 200;
const MAX_LESSON_TITLE = 200;
const MAX_LESSON_EXCERPT = 500;

// Une `ref` est une clé interne, jamais une URL : même règle que
// `AssignmentAttachment.isValid` (I1).
const ABSOLUTE_REF = /:\/\/|^\/\/|data:|\\/;

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function text(value: unknown, max = MAX_DESCRIPTION): string {
  if (typeof value !== "string") return "";
  return value.replace(CONTROL_CHARS, "").trim().slice(0, max);
}

function optionalText(value: unknown, max = 64): string | null {
  const out = text(value, max);
  return out.length > 0 ? out : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// --- Dates -----------------------------------------------------------------

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

/** DueDate du contrat : instant ISO complet ou date seule. Tout le reste est
 *  illisible (jamais une date fabriquée à partir des dix premiers caractères). */
export function assignmentDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!DATE_ONLY.test(raw) && !ISO_INSTANT.test(raw)) return null;
  if (DATE_ONLY.test(raw)) {
    const [year, month, day] = raw.split("-").map((part) => Number.parseInt(part, 10));
    if (!year || !month || !day) return null;
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function assignmentDayKey(value: unknown): string | null {
  const date = assignmentDate(value);
  return date ? isoDay(date) : null;
}

/** « dimanche 25 octobre · 20:00 » ; une date seule n'affiche pas d'heure. */
export function dueLabel(value: unknown): string {
  const date = assignmentDate(value);
  if (!date || typeof value !== "string") return "";
  const label = frDate(value);
  if (!DATE_ONLY.test(value.trim())) {
    const time = frTime(value);
    return time ? `${label} · ${time}` : label;
  }
  return label;
}

export function weekStartOf(now: Date): string {
  return isoDay(startOfWeek(now));
}

/** Dimanche de la semaine commençant à `startIso`. */
export function weekEndOf(startIso: string): string | null {
  const date = assignmentDate(startIso);
  return date ? isoDay(addDays(date, 6)) : null;
}

export function shiftWeek(startIso: string, weeks: number): string {
  const date = assignmentDate(startIso);
  if (!date) return startIso;
  return isoDay(addDays(date, weeks * 7));
}

/** Numéro de semaine ISO 8601 (la semaine du jeudi). */
export function isoWeekNumber(startIso: string): number {
  const date = assignmentDate(startIso);
  if (!date) return 0;
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

export function weekLabelFr(startIso: string): string {
  const week = isoWeekNumber(startIso);
  return week > 0 ? `Semaine ${week}` : "Semaine";
}

/** « 05/10 – 11/10 », avec l'année seulement quand elle change. */
export function weekRangeFr(startIso: string, endIso?: string | null): string {
  const start = assignmentDate(startIso);
  if (!start) return "";
  const end = (endIso ? assignmentDate(endIso) : null) ?? addDays(start, 6);
  const short = (date: Date) =>
    `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
  const tail =
    end.getFullYear() !== start.getFullYear()
      ? `${short(end)}/${end.getFullYear()}`
      : short(end);
  return `${short(start)} – ${tail}`;
}

// --- Parsers ----------------------------------------------------------------

function parseAttachment(raw: unknown): AssignmentAttachment | null {
  const o = record(raw);
  if (!o) return null;
  const attachment: AssignmentAttachment = {
    id: text(o["id"], MAX_REF),
    label: text(o["label"], MAX_LABEL),
    ref: text(o["ref"], MAX_REF),
  };
  if (!attachment.id || !attachment.label || !attachment.ref) return null;
  if (ABSOLUTE_REF.test(attachment.ref)) return null;
  return attachment;
}

function parseLesson(raw: unknown): AssignmentLessonContent | null {
  const o = record(raw);
  if (!o) return null;
  const lesson: AssignmentLessonContent = {
    title: text(o["title"], MAX_LESSON_TITLE),
    excerpt: text(o["excerpt"], MAX_LESSON_EXCERPT),
  };
  if (!lesson.title || lesson.title.length > MAX_LESSON_TITLE) return null;
  if (lesson.excerpt.length > MAX_LESSON_EXCERPT) return null;
  return lesson;
}

/** Un devoir hors contrat est ignoré entièrement (jamais affiché à moitié). */
export function parseAssignment(raw: unknown): Assignment | null {
  const o = record(raw);
  if (!o) return null;
  const id = text(o["id"], 200);
  const subject = text(o["subject"], 200);
  const title = text(o["title"], 400);
  if (!id || !subject || !title) return null;
  const description = text(o["description"], MAX_DESCRIPTION + 1);
  if (description.length > MAX_DESCRIPTION) return null;

  const attachmentsRaw = Array.isArray(o["attachments"]) ? o["attachments"] : [];
  if (attachmentsRaw.length > MAX_ATTACHMENTS) return null;
  const attachments: AssignmentAttachment[] = [];
  for (const rawAttachment of attachmentsRaw) {
    const attachment = parseAttachment(rawAttachment);
    if (!attachment) return null;
    attachments.push(attachment);
  }

  let lessonContent: AssignmentLessonContent | null = null;
  if (o["lessonContent"] != null) {
    lessonContent = parseLesson(o["lessonContent"]);
    if (!lessonContent) return null;
  }

  const dueDate = text(o["dueDate"], 64);
  return {
    id,
    subject,
    title,
    dueDate,
    done: o["done"] === true,
    description,
    lessonContent,
    attachments,
    periodId: optionalText(o["periodId"]),
    weekId: optionalText(o["weekId"]),
  };
}

function listOf(root: Record<string, unknown> | null): unknown[] {
  if (!root) return [];
  for (const key of ["assignments", "items"]) {
    if (Array.isArray(root[key])) return root[key] as unknown[];
  }
  return [];
}

function bound(root: Record<string, unknown> | null, keys: string[]): string | null {
  if (!root) return null;
  for (const key of keys) {
    const day = assignmentDayKey(root[key]);
    if (day) return day;
  }
  return null;
}

/** Payload `{assignments: []}` (Kotlin) ou `{items: []}` (pont factice), avec
 *  d'éventuelles bornes de semaine. Un JSON illisible rend un payload vide. */
export function parseAssignmentsPayload(payload: string | null | undefined): AssignmentsPayload {
  if (!payload) return { items: [], weekStart: null, weekEnd: null };
  let root: Record<string, unknown> | null = null;
  let rawItems: unknown[] = [];
  try {
    const parsed: unknown = JSON.parse(payload);
    if (Array.isArray(parsed)) {
      rawItems = parsed;
    } else {
      root = record(parsed);
      rawItems = listOf(root);
    }
  } catch {
    return { items: [], weekStart: null, weekEnd: null };
  }

  const items: Assignment[] = [];
  for (const raw of rawItems) {
    const assignment = parseAssignment(raw);
    if (assignment) items.push(assignment);
  }

  const weekStart = bound(root, ["weekStart", "weekFrom", "from", "start"]);
  let weekEnd = bound(root, ["weekEnd", "weekTo", "to", "end"]);
  if (weekStart && !weekEnd) {
    const date = assignmentDate(weekStart);
    weekEnd = date ? isoDay(addDays(date, 6)) : null;
  }
  return { items, weekStart, weekEnd };
}

// --- Regroupement -----------------------------------------------------------

const SECTION_TITLES: Array<[AssignmentSectionId, string]> = [
  ["overdue", "En retard"],
  ["today", "Aujourd'hui"],
  ["week", "Cette semaine"],
  ["later", "Plus tard"],
  ["done", "Terminés"],
];

/** Le FAIT prime sur la date ; une dueDate illisible n'est jamais « en retard ». */
export function assignmentSectionOf(assignment: Assignment, now: Date): AssignmentSectionId {
  if (assignment.done) return "done";
  const date = assignmentDate(assignment.dueDate);
  if (!date) return "later";
  const today = isoDay(now);
  const day = isoDay(date);
  if (day < today) return "overdue";
  if (day === today) return "today";
  const weekEnd = isoDay(addDays(now, 7));
  return day < weekEnd ? "week" : "later";
}

function byDate(a: Assignment, b: Assignment): number {
  const left = assignmentDate(a.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const right = assignmentDate(b.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  return left - right;
}

/** Sections non vides, dans l'ordre d'affichage, triées par échéance. Les
 *  devoirs sans date lisible sont écartés du regroupement (comme le Kotlin). */
export function assignmentSections(items: Assignment[], now: Date): AssignmentSection[] {
  const dated = items.filter((item) => assignmentDate(item.dueDate) !== null);
  const sections: AssignmentSection[] = [];
  for (const [id, title] of SECTION_TITLES) {
    const sectionItems = dated.filter((item) => assignmentSectionOf(item, now) === id).sort(byDate);
    if (sectionItems.length > 0) sections.push({ id, title, items: sectionItems });
  }
  return sections;
}

// --- Texte ------------------------------------------------------------------

/** Minuscules sans accent, pour la recherche et la comparaison de titres. */
export function foldFr(value: string): string {
  return value
    .toLocaleLowerCase("fr-FR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/**
 * Pronote n'expose qu'un champ descriptif : le `title` du payload est souvent
 * ses 200 premiers caractères. La carte n'affiche le titre séparément que
 * s'il apporte autre chose, et montre toujours la consigne entière.
 */
export function assignmentCardText(assignment: Assignment): { title: string; body: string } {
  const title = assignment.title.trim();
  const body = assignment.description.trim();
  if (!body) return { title, body: "" };
  const foldedTitle = foldFr(title);
  if (foldedTitle && foldFr(body).startsWith(foldedTitle)) return { title: "", body };
  return { title, body };
}

/** « ALLEMAND LV2 » → « Allemand LV2 » ; une casse déjà mixte est conservée. */
export function subjectDisplayFr(name: string): string {
  const trimmed = name.trim();
  const letters = trimmed.replace(/[^\p{L}]/gu, "");
  if (!letters || letters !== letters.toLocaleUpperCase("fr-FR")) return trimmed;
  const [head = "", ...tail] = trimmed.split(" ");
  const capitalised = head.toLocaleLowerCase("fr-FR").replace(/^./u, (c) => c.toLocaleUpperCase("fr-FR"));
  return tail.length > 0 ? `${capitalised} ${tail.join(" ")}` : capitalised;
}

export function subjectInitial(subject: string): string {
  const first = subject.trim().match(/[\p{L}\p{N}]/u)?.[0];
  return first ? first.toLocaleUpperCase("fr-FR") : "?";
}

/** Repli de compatibilité pour un payload de test qui n'a pas de bornes. */
export function hasWeekBounds(payload: AssignmentsPayload): boolean {
  return Boolean(payload.weekStart || payload.weekEnd);
}

/** Date lisible d'une fiche ou d'une échéance, vide si l'ISO est illisible. */
export function safeFrDate(value: string): string {
  return parseDate(value) ? frDate(value) : "";
}
