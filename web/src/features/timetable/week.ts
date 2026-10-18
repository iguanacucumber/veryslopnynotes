// Semaine de l'EDT : arithmétique par DATE locale, jamais par 7 × 24 h.
//
// Port de la partie « semaine » de `TimetableWeek.kt`. Les 168 h fixes sont le
// bug connu de l'onglet : une semaine qui traverse un changement d'heure dure
// 167 h ou 169 h. `addDays` / `startOfWeek` travaillent sur la date, donc le
// lundi 00:00 reste le lundi 00:00.
import { addDays, frDayShort, isoDay, startOfWeek } from "../../lib/format";
import type { Lesson } from "../home/parse";

export interface DayGroup {
  date: Date;
  key: string;
  lessons: Lesson[];
}

/** Lundi 00:00 local de la semaine contenant `date`. */
export function mondayOf(date: Date): Date {
  return startOfWeek(date);
}

/** Lundi de la semaine décalée de `offset` semaines (0 = semaine courante). */
export function weekStartFrom(offset: number, base: Date = new Date()): Date {
  return addDays(startOfWeek(base), offset * 7);
}

/** Les sept jours de la semaine, lundi d'abord. */
export function weekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

/** Cours dont le jour local tombe dans la semaine affichée. */
export function lessonsInWeek(lessons: Lesson[], weekStart: Date): Lesson[] {
  const keys = new Set(weekDays(weekStart).map((date) => isoDay(date)));
  return lessons.filter((lesson) => keys.has(isoDay(new Date(lesson.start))));
}

/** Sept groupes (jours vides compris) : la bande de semaine a toujours 7 cases. */
export function groupDays(lessons: Lesson[], weekStart: Date): DayGroup[] {
  return weekDays(weekStart).map((date) => {
    const key = isoDay(date);
    return {
      date,
      key,
      lessons: lessons
        .filter((lesson) => isoDay(new Date(lesson.start)) === key)
        .sort((a, b) => a.start - b.start),
    };
  });
}

/** Cours qui a commencé et n'est pas fini. Un cours annulé n'a pas lieu. */
export function currentLesson(lessons: Lesson[], now: number): Lesson | null {
  let best: Lesson | null = null;
  for (const lesson of lessons) {
    if (lesson.status === "cancelled") continue;
    if (lesson.start <= now && now < lesson.end) {
      if (!best || lesson.start < best.start) best = lesson;
    }
  }
  return best;
}

/** Premier cours qui n'a pas encore commencé, annulés exclus. */
export function nextLesson(lessons: Lesson[], now: number): Lesson | null {
  let best: Lesson | null = null;
  for (const lesson of lessons) {
    if (lesson.status === "cancelled") continue;
    if (lesson.start <= now) continue;
    if (!best || lesson.start < best.start) best = lesson;
  }
  return best;
}

export type Highlight = "current" | "next" | null;

/** Mise en avant : en cours > prochain > rien. Comparaison par heure de début. */
export function highlightOf(
  lesson: Lesson,
  current: Lesson | null,
  next: Lesson | null,
): Highlight {
  if (current && lesson.start === current.start) return "current";
  if (next && lesson.start === next.start) return "next";
  return null;
}

/** Query de fenêtre du contrat : `weekStart=AAAA-MM-JJ`. */
export function weekQuery(weekStart: Date): string {
  return `weekStart=${isoDay(weekStart)}`;
}

/**
 * « Semaine du 19 au 25 octobre 2026 » (mois écrit côté fin ; deux mois si la
 * semaine chevauche).
 */
export function weekLabel(weekStart: Date): string {
  const end = addDays(weekStart, 6);
  const sameMonth = weekStart.getMonth() === end.getMonth();
  const month = end.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  if (sameMonth) {
    return `Semaine du ${weekStart.getDate()} au ${end.getDate()} ${month}`;
  }
  const startLabel = weekStart.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
  return `Semaine du ${startLabel} au ${end.getDate()} ${month}`;
}

/** Étiquette courte d'une case de la bande de semaine : « lun. ». */
export function shortDay(date: Date): string {
  return frDayShort(date);
}
