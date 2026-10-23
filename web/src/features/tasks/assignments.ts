// Logique pure de l'écran Tâches, portée de `AssignmentsSections.kt` et
// `AssignmentsRepository.kt`. Aucun React, aucun réseau : les parsers et les
// regroupements sont testables avec un `now` injecté.
import { addDays, frDate, frTime, isoDay, parseDate, startOfWeek, weeksBetween } from "../../lib/format";

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

export type AssignmentSectionId = "overdue" | "today" | "week" | "later" | "undated" | "done";

export interface AssignmentSection {
  id: AssignmentSectionId;
  title: string;
  items: Assignment[];
}

export const ASSIGNMENTS_MAX_ITEMS = 500;
/** Entrées brutes lues au plus : un payload géant ne fait pas tourner le parseur. */
export const ASSIGNMENTS_MAX_SCAN = 500;
const MAX_DESCRIPTION = 2000;
const MAX_ATTACHMENTS = 10;
const MAX_LABEL = 200;
const MAX_REF = 200;
const MAX_LESSON_TITLE = 200;
const MAX_LESSON_EXCERPT = 500;

// Une `ref` est une clé interne, jamais une URL : même règle que
// `AssignmentAttachment.isValid` (I1). Seul le schéma `homework:` est accepté ;
// tout autre schéma, chemin absolu ou URL est rejeté.
const HOMEWORK_REF = /^homework:[A-Za-z0-9._:-]+$/;

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
 *  illisible (jamais une date fabriquée à partir des dix premiers caractères).
 *  Une date seule est minuit local (analyseur partagé). */
export function assignmentDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!DATE_ONLY.test(raw) && !ISO_INSTANT.test(raw)) return null;
  return parseDate(raw);
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

/** Écart en semaines avec la semaine courante : 0 = même semaine, -1 =
 *  précédente, +1 = suivante. Une date illisible ne prétend pas être ailleurs. */
export function weekGap(fromIso: string, currentIso: string): number {
  const from = assignmentDate(fromIso);
  const current = assignmentDate(currentIso);
  if (!from || !current) return 0;
  return weeksBetween(from, current);
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
  const id = text(o["id"], MAX_REF);
  const label = text(o["label"], MAX_LABEL);
  // La `ref` est validée BRUTE (avant tout nettoyage) : hors schéma, elle fait
  // PERDRE le devoir entier. Même verdict que le contrat TS et que le Kotlin
  // (`core/Assignment.kt`) : un caractère de contrôle ou une URL sont refusés.
  const ref = o["ref"];
  if (typeof ref !== "string" || ref.length > MAX_REF || !HOMEWORK_REF.test(ref)) return null;
  if (!id || !label) return null;
  return { id, label, ref };
}

function parseLesson(raw: unknown): AssignmentLessonContent | null {
  const o = record(raw);
  if (!o) return null;
  // Les textes sont tronqués, jamais rejetés : une fiche de cours bavarde ne
  // doit pas faire disparaître le devoir entier.
  const lesson: AssignmentLessonContent = {
    title: text(o["title"], MAX_LESSON_TITLE),
    excerpt: text(o["excerpt"], MAX_LESSON_EXCERPT),
  };
  if (!lesson.title) return null;
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
  const attachments: AssignmentAttachment[] = [];
  for (const rawAttachment of attachmentsRaw.slice(0, MAX_ATTACHMENTS)) {
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
  const seen = new Set<string>();
  const scan = Math.min(rawItems.length, ASSIGNMENTS_MAX_SCAN);
  for (let index = 0; index < scan && items.length < ASSIGNMENTS_MAX_ITEMS; index++) {
    const assignment = parseAssignment(rawItems[index]);
    if (!assignment || seen.has(assignment.id)) continue;
    seen.add(assignment.id);
    items.push(assignment);
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

/** Ordre d'affichage : stable, que la semaine affichée soit la semaine
 *  courante ou une autre. */
const SECTION_ORDER: AssignmentSectionId[] = [
  "overdue",
  "today",
  "week",
  "later",
  "undated",
  "done",
];

/** Titres fixes ; celui de la semaine est calculé (il nomme la semaine
 *  AFFICHÉE). */
const SECTION_TITLES: Record<Exclude<AssignmentSectionId, "week">, string> = {
  overdue: "En retard",
  today: "Aujourd'hui",
  later: "Plus tard",
  undated: "Sans échéance",
  done: "Terminés",
};

/** Lundi 00:00 de la semaine affichée. Une semaine illisible retombe sur la
 *  semaine courante : la partition reste exhaustive (aucun devoir ne
 *  disparaît, aucun ne se retrouve deux fois). */
function resolveWeekStart(weekStart: string, now: Date): Date {
  return assignmentDate(weekStart) ?? assignmentDate(weekStartOf(now)) ?? new Date(now);
}

/** Fenêtre de la semaine affichée : lundi → dimanche (jours locaux). */
function weekWindow(weekStart: string, now: Date): { start: string; end: string } {
  const date = resolveWeekStart(weekStart, now);
  return { start: isoDay(date), end: isoDay(addDays(date, 6)) };
}

/** Titre de la section de semaine : il nomme la semaine AFFICHÉE, pas
 *  « maintenant » — « Cette semaine » pour la semaine courante, « Semaine 43 »
 *  pour une autre. */
function weekSectionTitle(weekStart: string, now: Date): string {
  const { start } = weekWindow(weekStart, now);
  return start === weekStartOf(now) ? "Cette semaine" : weekLabelFr(start);
}

/** Une échéance datée du jour et DÉJÀ PASSÉE est « en retard ». Une date
 *  SEULE (sans heure) est un rendez-vous de la journée entière : elle n'est
 *  jamais « plus tôt que maintenant », sinon la moitié des devoirs du jour
 *  signaleraient à tort un retard. */
function isEarlierToday(assignment: Assignment, date: Date, now: Date): boolean {
  if (DATE_ONLY.test(assignment.dueDate.trim())) return false;
  return date.getTime() < now.getTime();
}

/**
 * Section d'un devoir, RELATIVE À LA SEMAINE AFFICHÉE (`weekStart`, un lundi).
 *
 * Semaine courante (celle d'aujourd'hui) :
 * - « En retard » : échéance d'AVANT aujourd'hui — un devoir dû hier est en
 *   retard, il ne repasse pas dans « Cette semaine » ; et, pour une
 *   échéance du jour dont l'heure est déjà passée, retard également ;
 * - « Aujourd'hui » : échéance du jour qu'il reste à faire (une date SANS
 *   heure est un rendez-vous de la journée entière : jamais en retard) ;
 * - section de semaine : échéances des jours qui viennent, jusqu'au
 *   dimanche (titre : « Cette semaine ») ;
 * - « Plus tard » : échéances après la fin de la semaine (hors de l'écran :
 *   la liste affichée ne contient que la semaine choisie).
 *
 * Autre semaine (passée ou à venir) :
 * - « En retard » : échéance avant le début de la semaine affichée ;
 * - section de semaine : échéances du lundi au dimanche de la semaine
 *   affichée (titre : « Semaine 43 ») ;
 * - « Plus tard » : échéances après la fin de la semaine affichée ;
 * - pas de section « Aujourd'hui » : elle n'aurait aucun sens hors de la
 *   semaine en cours.
 *
 * Le FAIT prime sur la date (« Terminés ») ; une dueDate illisible n'est
 * jamais « en retard » : elle a sa propre section (« Sans échéance »), un
 * devoir sans échéance reste visible.
 */
export function assignmentSectionOf(
  assignment: Assignment,
  weekStart: string,
  now: Date,
): AssignmentSectionId {
  if (assignment.done) return "done";
  const date = assignmentDate(assignment.dueDate);
  if (!date) return "undated";
  const { start, end } = weekWindow(weekStart, now);
  const day = isoDay(date);
  if (start === weekStartOf(now)) {
    // Semaine en cours : « En retard » = ce qui aurait déjà dû être rendu.
    const today = isoDay(now);
    if (day < today) return "overdue";
    if (day === today) return isEarlierToday(assignment, date, now) ? "overdue" : "today";
    if (day > end) return "later";
    return "week";
  }
  // Autre semaine : les sections décrivent la fenêtre affichée.
  if (day < start) return "overdue";
  if (day > end) return "later";
  return "week";
}

function byDate(a: Assignment, b: Assignment): number {
  const left = assignmentDate(a.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const right = assignmentDate(b.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  return left - right;
}

/** Sections non vides, dans l'ordre d'affichage, triées par échéance. Les
 *  devoirs sans date lisible restent visibles dans « Sans échéance ». Les
 *  sections suivent la semaine AFFICHÉE (`weekStart`), pas « aujourd'hui ». */
export function assignmentSections(
  items: Assignment[],
  weekStart: string,
  now: Date,
): AssignmentSection[] {
  const sections: AssignmentSection[] = [];
  for (const id of SECTION_ORDER) {
    const sectionItems = items
      .filter((item) => assignmentSectionOf(item, weekStart, now) === id)
      .sort(byDate);
    if (sectionItems.length === 0) continue;
    const title = id === "week" ? weekSectionTitle(weekStart, now) : SECTION_TITLES[id];
    sections.push({ id, title, items: sectionItems });
  }
  return sections;
}

/** Devoirs dont l'échéance tombe dans la semaine commençant à `weekStart`.
 *  La fenêtre est celle du producteur natif : lundi 00:00 Paris → dimanche
 *  23:59:59 Paris (`weekWindow`). Une date seule est lue en UTC, comme le
 *  contrat qui ne publie que des instants complets. Sert à ignorer un payload
 *  en cache qui appartient à une autre semaine (`useResource` met en cache par
 *  ressource, pas par requête). */
export function assignmentsInWeek(items: Assignment[], weekStart: string): Assignment[] {
  if (!DATE_ONLY.test(weekStart)) return [];
  const [year, month, day] = weekStart.split("-").map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day) return [];
  const start = Date.UTC(year, month - 1, day);
  const end = start + 7 * 86_400_000;
  return items.filter((item) => {
    const value = item.dueDate.trim();
    // Sans échéance lisible : la carte vit dans « Sans échéance », jamais
    // rattachée de force à une semaine.
    if (!value) return true;
    let millis: number;
    if (DATE_ONLY.test(value)) {
      const [y, m, d] = value.split("-").map((part) => Number.parseInt(part, 10));
      if (!y || !m || !d) return true;
      millis = Date.UTC(y, m - 1, d);
    } else {
      const date = assignmentDate(value);
      if (!date) return true;
      millis = date.getTime();
    }
    return millis >= start && millis < end;
  });
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

/**
 * Phrase de refus affichée quand l'assistant refuse de répondre (#416).
 *
 * Le pont natif envoie une phrase française bornée (jamais le motif libre du
 * modèle) : c'est ELLE qui fait foi. Le repli est générique : « pas assez de
 * matière » serait un FAUX diagnostic quand le modèle a refusé pour une autre
 * raison, et enverrait l'élève chercher d'autres documents pour rien.
 */
export function homeworkRefusalText(message: string | undefined): string {
  const texte = (message ?? "").trim();
  return texte !== "" ? texte : "L'assistant a refusé de répondre à cette question.";
}
