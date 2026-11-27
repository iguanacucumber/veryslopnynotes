// Cours de l'emploi du temps : un JSON illisible n'est jamais « aucun cours ».
import {
  asObject,
  boundedLimit,
  boundedText,
  millisOf,
  optionalText,
  payloadRoot,
  rowsOf,
} from "./payload";

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
