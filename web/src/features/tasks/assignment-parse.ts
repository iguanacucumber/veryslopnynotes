import { addDays, isoDay } from "../../lib/format";
import { assignmentDate, assignmentDayKey } from "./assignment-time";

export interface AssignmentAttachment {
  id: string;
  label: string;
  ref: string;
}

export interface AssignmentLessonContent {
  title: string;
  excerpt: string;
  /**
   * #631 : pièces jointes du cours. Elles n'ouvrent pas encore de viewer côté
   * web, mais elles alimentent le contexte IA natif.
   */
  attachments?: AssignmentAttachment[];
}

export interface Assignment {
  id: string;
  subject: string;
  title: string;
  dueDate: string;
  done: boolean;
  description: string;
  lessonContent: AssignmentLessonContent | null;
  /** #631 : TOUS les cours de la même matière + jour (le premier est aussi
   *  `lessonContent`, pour les lecteurs antérieurs). */
  lessonContents: AssignmentLessonContent[];
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

export const ASSIGNMENTS_MAX_ITEMS = 500;
/** Entrées brutes lues au plus : un payload géant ne fait pas tourner le parseur. */
export const ASSIGNMENTS_MAX_SCAN = 500;
const MAX_DESCRIPTION = 2000;
const MAX_ATTACHMENTS = 10;
const MAX_LESSONS = 10;
const MAX_LABEL = 200;
const MAX_REF = 200;
const MAX_LESSON_TITLE = 200;
// #628 : le cours rattaché alimente le contexte IA, pas seulement la carte :
// même borne de payload que le manuel (8 000), alignée sur le contrat.
const MAX_LESSON_EXCERPT = 8000;

// Une `ref` est une clé interne, jamais une URL : même règle que
// `AssignmentAttachment.isValid` (I1). Seul le schéma `homework:` est accepté ;
// tout autre schéma, chemin absolu ou URL est rejeté.
const HOMEWORK_REF = /^homework:[A-Za-z0-9._:-]+$/;

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

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

/** Première occurrence de chaque id, dans l'ordre du payload et bornée. */
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
  const attachments: AssignmentAttachment[] = [];
  const rawAttachments = Array.isArray(o["attachments"]) ? o["attachments"] : [];
  for (const rawAttachment of rawAttachments.slice(0, MAX_ATTACHMENTS)) {
    const attachment = parseAttachment(rawAttachment);
    if (!attachment) return null;
    attachments.push(attachment);
  }
  const lesson: AssignmentLessonContent = {
    title: text(o["title"], MAX_LESSON_TITLE),
    excerpt: text(o["excerpt"], MAX_LESSON_EXCERPT),
    attachments: uniqueById(attachments, MAX_ATTACHMENTS),
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
  let lessonContents: AssignmentLessonContent[] = [];
  const rawLessons = Array.isArray(o["lessonContents"]) ? o["lessonContents"] : [];
  if (rawLessons.length > 0) {
    for (const rawLesson of rawLessons.slice(0, MAX_LESSONS)) {
      const lesson = parseLesson(rawLesson);
      if (!lesson) return null;
      lessonContents.push(lesson);
    }
  } else if (o["lessonContent"] != null) {
    const lesson = parseLesson(o["lessonContent"]);
    if (!lesson) return null;
    lessonContents = [lesson];
  }
  lessonContent = lessonContents[0] ?? null;

  const dueDate = text(o["dueDate"], 64);
  return {
    id,
    subject,
    title,
    dueDate,
    done: o["done"] === true,
    description,
    lessonContent,
    lessonContents,
    attachments: uniqueById(attachments, MAX_ATTACHMENTS),
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

export const ASSIGNMENTS_UNAVAILABLE = "Devoirs indisponibles : aucune donnée n’a été lue.";
export const ASSIGNMENTS_UNREADABLE = "Devoirs illisibles : la donnée n’a pas pu être lue.";

/** Un JSON illisible ou sans liste de devoirs n'est PAS « aucun devoir »
 *  (I14). `null` = aucun payload, traité à part par l'appelant. */
export function isAssignmentsPayloadReadable(payload: string | null | undefined): boolean {
  if (!payload) return false;
  try {
    const parsed: unknown = JSON.parse(payload);
    if (Array.isArray(parsed)) return true;
    const root = record(parsed);
    return root !== null && (Array.isArray(root["assignments"]) || Array.isArray(root["items"]));
  } catch {
    return false;
  }
}

/** Payload `{assignments: []}` (Kotlin) ou `{items: []}` (pont factice), avec
 *  d'éventuelles bornes de semaine. Un JSON illisible rend un payload vide,
 *  distingué de « aucun devoir » par [isAssignmentsPayloadReadable]. */
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

/**
 * Pièces jointes du devoir ET de ses cours, sans doublon d'id ni de `ref` :
 * l'id identifie les rendus React, la `ref` écarte les doublons natifs. Bornée
 * comme le payload : une pièce jointe de cours ouvre le même CTA qu'une pièce
 * jointe de devoir.
 */
export function allAssignmentAttachments(assignment: Assignment): AssignmentAttachment[] {
  const lessons =
    assignment.lessonContents.length > 0
      ? assignment.lessonContents
      : assignment.lessonContent
        ? [assignment.lessonContent]
        : [];
  const out: AssignmentAttachment[] = [];
  const seenIds = new Set<string>();
  const seenRefs = new Set<string>();
  const add = (list: readonly AssignmentAttachment[] | undefined) => {
    for (const attachment of list ?? []) {
      if (out.length >= MAX_ATTACHMENTS) break;
      if (seenIds.has(attachment.id) || seenRefs.has(attachment.ref)) continue;
      seenIds.add(attachment.id);
      seenRefs.add(attachment.ref);
      out.push(attachment);
    }
  };
  add(assignment.attachments);
  for (const lesson of lessons) add(lesson.attachments);
  return out;
}
