import { addDays, frDateShort, isoDay, parseDate, startOfWeek, weeksBetween } from "../../lib/format";
import type { Assignment } from "./assignment-parse";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

const PARIS_CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Paris",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Heure murale de l'établissement, jamais celle de l'appareil. */
export function parisClock(date: Date): string {
  const parts = PARIS_CLOCK.formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("hour")}:${part("minute")}:${part("second")}`;
}

/** DueDate du contrat : instant ISO complet ou date seule. Tout le reste est
 *  illisible (jamais une date fabriquée à partir des dix premiers caractères).
 *  Une date seule est minuit local (analyseur partagé). */
export function assignmentDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!DATE_ONLY.test(raw) && !ISO_INSTANT.test(raw)) return null;
  return parseDate(raw);
}

/** Échéance sans heure : date seule du contrat, ou minuit Paris que le natif
 *  émet pour un `PourLe` sans heure (`2026-11-01T00:00+01:00`). Une échéance de
 *  journée entière n'est jamais « plus tôt que maintenant ». */
export function isAllDayDue(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const raw = value.trim();
  if (!raw) return false;
  if (DATE_ONLY.test(raw)) return assignmentDate(raw) !== null;
  const date = assignmentDate(raw);
  return date !== null && parisClock(date) === "00:00:00";
}

/** Lundi de la semaine de `now`, en JOUR civil de Paris : la même horloge que
 *  la fenêtre du natif (`WeekWindow.kt`). */
export function weekStartOf(now: Date): string {
  const day = parisDayOf(now);
  const monday = day ? mondayOf(day) : null;
  return monday ?? isoDay(startOfWeek(now));
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

/** Suffixe du résumé de tâches : « cette semaine » seulement si la semaine
 *  affichée est la semaine courante ; sinon la date du lundi affiché. */
export function taskWeekSuffixFr(weekStart: string, currentWeek: string): string {
  if (weekStart === currentWeek) return "cette semaine";
  const day = frDateShort(weekStart);
  return day ? `pour la semaine du ${day}` : "pour la semaine affichée";
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

/** Jour civil `AAAA-MM-JJ` d'une échéance, à l'heure de Paris.
 *
 *  Le natif publie un INSTANT (`dueDate` avec offset) et borne ses semaines en
 *  `Europe/Paris` (`WeekWindow.kt`). Comparer cet instant à des bornes UTC
 *  rangeait un devoir dû lundi 00:00 Paris dans la semaine précédente (dimanche
 *  22:00 UTC). On ramène donc tout à un JOUR civil de l'établissement, jamais
 *  à une arithmétique de millisecondes : le fuseau explicite rend le calcul
 *  indépendant de la machine, et les semaines de 167/169 h passent sans code
 *  dédié. Une date seule est déjà un jour civil. */
const PARIS_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Jour civil de Paris d'un instant (jamais le jour local de l'appareil). */
export function parisDayOf(date: Date): string | null {
  const parts = PARIS_DAY.formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  const year = part("year");
  const month = part("month");
  const day = part("day");
  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function parisDayKey(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  if (DATE_ONLY.test(raw)) return raw;
  const date = assignmentDate(raw);
  return date ? parisDayOf(date) : null;
}

export function assignmentDayKey(value: unknown): string | null {
  return typeof value === "string" ? parisDayKey(value) : null;
}

/** Lundi du jour civil `AAAA-MM-JJ`, en UTC : ces clés ne sont que des
 *  étiquettes, jamais des instants. */
function mondayOf(dayKey: string): string | null {
  const [year, month, day] = dayKey.split("-").map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day) return null;
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dayKeyShift(dayKey, -((weekday + 6) % 7));
}

/** Décalage en jours d'un jour civil (`AAAA-MM-JJ`), en UTC pour ne pas
 *  dépendre du fuseau de la machine : ces clés ne sont que des étiquettes. */
export function dayKeyShift(dayKey: string, days: number): string | null {
  const [year, month, day] = dayKey.split("-").map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day + days));
  if (Number.isNaN(date.getTime())) return null;
  const out = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate(),
  ).padStart(2, "0")}`;
  return out;
}

/** Devoirs dont l'échéance tombe dans la semaine commençant à `weekStart`.
 *  La fenêtre est celle du producteur natif : lundi 00:00 Paris → dimanche
 *  23:59:59 Paris (`WeekWindow.kt`), comparée en JOURS civils de Paris. Sert à
 *  ignorer un payload en cache qui appartient à une autre semaine
 *  (`useResource` met en cache par ressource, pas par requête). */
export function assignmentsInWeek(items: Assignment[], weekStart: string): Assignment[] {
  const start = weekStart.trim();
  if (!DATE_ONLY.test(start)) return [];
  const end = dayKeyShift(start, 6);
  if (!end) return [];
  return items.filter((item) => {
    // Sans échéance lisible : la carte vit dans « Sans échéance », jamais
    // rattachée de force à une semaine.
    const day = parisDayKey(item.dueDate);
    if (!day) return true;
    // Clés ISO : l'ordre lexicographique est l'ordre chronologique.
    return day >= start && day <= end;
  });
}
