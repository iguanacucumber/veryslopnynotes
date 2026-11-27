// Jours civils de l'établissement (Europe/Paris) : une date seule du contrat
// est un jour de Paris, jamais minuit dans le fuseau de l'appareil.
import { frDateShort, frDay } from "../../lib/format";
import { millisOf } from "./payload";

export const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

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

export function parisClockOf(millis: number): string {
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
export function localNoonOfDayKey(key: string): Date | null {
  const match = DATE_ONLY.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day, 12);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
  return date;
}

export function frDayOfKey(key: string): string {
  const date = localNoonOfDayKey(key);
  return date ? frDay(date) : "";
}

/** Minuit de l'établissement pour un jour civil : une date seule du contrat est
 *  un jour de Paris, pas minuit dans le fuseau de l'appareil. */
export function parisMidnightOfDayKey(key: string): number | null {
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

export function frDateShortOfKey(key: string): string {
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
export function allDayKeyOf(due: number, raw: string): string | null {
  return allDayDayKey(raw) ?? (parisClockOf(due) === "00:00:00" ? parisDayKeyOf(due) : null);
}
