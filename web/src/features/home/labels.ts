// Étiquettes d'affichage : toujours l'heure et le jour de l'établissement.
import {
  allDayKeyOf,
  civilDayOffset,
  frDateShortOfKey,
  frDayOfKey,
  parisClockOf,
  parisDayKeyOf,
} from "./calendar";
import { isMoved, type Lesson } from "./timetable";

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
