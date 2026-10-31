// Add-only : champs ajoutés toujours optionnels, un payload antérieur reste valide.
import {
  isIsoDate,
  isNonEmptyString,
  isOptionalBoundedString,
  isRecord,
} from "./guards";

/** Statuts traduits du français, comme les menus. */
export const TIMETABLE_STATUSES = ["normal", "cancelled", "moved"] as const;

export type TimetableStatus = (typeof TIMETABLE_STATUSES)[number];

/** Bornes des libellés d'EDT (données externes bornées, jamais interprétées, I6). */
export const TIMETABLE_ROOM_MAX_CHARS = 100;
export const TIMETABLE_TEACHER_MAX_CHARS = 100;
/** Fenêtre de semaine : 7 jours demandés, 14 jours max (borne d'entrée du routeur). */
export const TIMETABLE_WEEK_MAX_SPAN_DAYS = 14;

export interface TimetableEntry {
  readonly id: string;
  readonly accountId: string;
  readonly subject: string;
  readonly room?: string;
  readonly start: string; // ISO-8601
  readonly end: string; // ISO-8601
  /** Enseignant ; absent = non publié, jamais deviné. */
  readonly teacher?: string;
  /** Statut tel que publié : absent = statut non publié (jamais "normal" par défaut). */
  readonly status?: TimetableStatus;
  /** Horaires d'origine d'un cours déplacé, si publiés (statut `moved`). */
  readonly originalStart?: string; // ISO-8601
  readonly originalEnd?: string; // ISO-8601
}

export function isTimetableStatus(v: unknown): v is TimetableStatus {
  return typeof v === "string" && (TIMETABLE_STATUSES as readonly string[]).includes(v);
}

export function isTimetableEntry(v: unknown): v is TimetableEntry {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["id"]) || !isNonEmptyString(v["accountId"])) return false;
  if (!isNonEmptyString(v["subject"])) return false;
  if (v["room"] !== undefined && !isOptionalBoundedString(v["room"], TIMETABLE_ROOM_MAX_CHARS)) {
    return false;
  }
  if (!isIsoDate(v["start"]) || !isIsoDate(v["end"])) return false;
  if (Date.parse(v["end"] as string) < Date.parse(v["start"] as string)) return false;
  if (v["status"] !== undefined && !isTimetableStatus(v["status"])) return false;
  if (v["teacher"] !== undefined && !isOptionalBoundedString(v["teacher"], TIMETABLE_TEACHER_MAX_CHARS)) {
    return false;
  }
  for (const k of ["originalStart", "originalEnd"] as const) {
    if (v[k] !== undefined && !isIsoDate(v[k])) return false;
  }
  if (v["originalStart"] !== undefined && v["originalEnd"] !== undefined) {
    if (Date.parse(v["originalEnd"] as string) < Date.parse(v["originalStart"] as string)) return false;
  }
  return true;
}
