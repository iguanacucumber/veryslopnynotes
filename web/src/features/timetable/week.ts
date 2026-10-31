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

export function weekStartFrom(offset: number, base: Date = new Date()): Date {
  return addDays(startOfWeek(base), offset * 7);
}

/** Semaine ± `weeks` par DATE locale, jamais par 7 × 24 h (heure d'été). */
export function shiftWeeks(weekStart: Date, weeks: number): Date {
  return addDays(weekStart, weeks * 7);
}

/** La semaine affichée est-elle celle de `now` ? (minuit ne la déplace pas) */
export function isCurrentWeek(weekStart: Date, now: Date = new Date()): boolean {
  return isoDay(weekStart) === isoDay(startOfWeek(now));
}

export function weekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

export function lessonsInWeek(lessons: Lesson[], weekStart: Date): Lesson[] {
  const keys = new Set(weekDays(weekStart).map((date) => isoDay(date)));
  return lessons.filter((lesson) => keys.has(isoDay(new Date(lesson.start))));
}

/** Sept groupes, jours vides compris : la bande a toujours 7 cases. */
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

/** Mise en avant : en cours > prochain > rien. Comparaison par IDENTITÉ, pas par
 *  heure de début : deux cours à 08:00 ne sont pas le même cours. */
export function highlightOf(
  lesson: Lesson,
  current: Lesson | null,
  next: Lesson | null,
): Highlight {
  if (current && lesson.id === current.id) return "current";
  if (next && lesson.id === next.id) return "next";
  return null;
}

export function weekQuery(weekStart: Date): string {
  return `weekStart=${isoDay(weekStart)}`;
}

export function weekLabel(weekStart: Date): string {
  const end = addDays(weekStart, 6);
  const sameMonth = weekStart.getMonth() === end.getMonth();
  const month = end.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  if (sameMonth) {
    return `Semaine du ${dayOfMonth(weekStart)} au ${dayOfMonth(end)} ${month}`;
  }
  const startMonth = weekStart.toLocaleDateString("fr-FR", { month: "long" });
  return `Semaine du ${dayOfMonth(weekStart)} ${startMonth} au ${dayOfMonth(end)} ${month}`;
}

function dayOfMonth(date: Date): string {
  return date.getDate() === 1 ? "1er" : String(date.getDate());
}

export function shortDay(date: Date): string {
  return frDayShort(date);
}
