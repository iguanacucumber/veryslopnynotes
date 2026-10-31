// Absences et retards : deux tables Pronote de forme identique, d'où UN seul modèle `kind`.
// Motifs/sanctions = DONNÉES externes bornées, jamais instruction (I6).
import {
  isBoundedString,
  isFiniteNumber,
  isIsoDate,
  isNonEmptyString,
  isOptionalBoundedString,
  isRecord,
} from "./guards";

export const ABSENCE_KINDS = ["absence", "late"] as const;

export type AbsenceKind = (typeof ABSENCE_KINDS)[number];

export const ABSENCE_MOTIF_MAX_CHARS = 500;
export const ABSENCE_SUBJECT_MAX_CHARS = 64;
export const PUNISHMENT_MOTIF_MAX_CHARS = 500;
export const PUNISHMENT_TYPE_MAX_CHARS = 100;
export const ATTENDANCE_NAME_MAX_CHARS = 100;

export interface AbsenceRecord {
  readonly id: string;
  readonly accountId: string;
  readonly kind: AbsenceKind;
  readonly date: string; // ISO-8601 (début)
  /** Fin d'absence (absence sur plusieurs jours), absente = journée simple. */
  readonly dateEnd?: string;
  readonly subject?: string;
  /** Motif déclaré : donnée bornée, jamais instruction (I6). */
  readonly motif?: string;
  /** Période d'appartenance (compteurs dérivés par période côté API). */
  readonly periodId?: string;
  /** Durée en minutes si l'établissement la publie (absente = occurrence comptée seule). */
  readonly durationMinutes?: number;
  /** Justifiée côté établissement, absent = inconnu (jamais « non justifiée » déduit). */
  readonly justified?: boolean;
}

export interface Punishment {
  readonly id: string;
  readonly accountId: string;
  readonly date: string; // ISO-8601
  /** Fin de sanction si l'établissement publie une plage, absente = sanction ponctuelle. */
  readonly dateEnd?: string;
  /** Motif de la sanction : donnée bornée, jamais instruction (I6). */
  readonly motif: string;
  readonly type: string;
  /** Gravité publiée par l'établissement (échelle libre), absente sinon. */
  readonly gravity?: number;
  readonly periodId?: string;
}

/** Compteurs dérivés par période (add-only, jamais de valeur devinée). */
export interface AttendancePeriod {
  readonly periodId: string;
  /** Libellé de la période si l'établissement la publie (sinon l'app affiche l'id). */
  readonly name?: string;
  readonly absences: number;
  readonly late: number;
  /** Minutes manquées cumulées (0 si l'établissement ne publie aucune durée). */
  readonly missingMinutes: number;
}

export function isAbsenceRecord(v: unknown): v is AbsenceRecord {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["id"]) || !isNonEmptyString(v["accountId"])) return false;
  if (!(ABSENCE_KINDS as readonly string[]).includes(v["kind"] as string)) return false;
  if (!isIsoDate(v["date"])) return false;
  if (v["dateEnd"] !== undefined && !isIsoDate(v["dateEnd"])) return false;
  // Fin avant début = bruit, pas une absence.
  if (
    v["dateEnd"] !== undefined &&
    Date.parse(v["dateEnd"] as string) < Date.parse(v["date"] as string)
  ) {
    return false;
  }
  if (v["subject"] !== undefined && !isOptionalBoundedString(v["subject"], ABSENCE_SUBJECT_MAX_CHARS)) {
    return false;
  }
  if (v["motif"] !== undefined && !isOptionalBoundedString(v["motif"], ABSENCE_MOTIF_MAX_CHARS)) {
    return false;
  }
  const minutes = v["durationMinutes"];
  if (minutes !== undefined && (!isFiniteNumber(minutes) || (minutes as number) < 0)) {
    return false;
  }
  if (v["periodId"] !== undefined && !isNonEmptyString(v["periodId"])) return false;
  if (v["justified"] !== undefined && typeof v["justified"] !== "boolean") return false;
  return true;
}

export function isPunishment(v: unknown): v is Punishment {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["id"]) || !isNonEmptyString(v["accountId"])) return false;
  if (!isBoundedString(v["motif"], PUNISHMENT_MOTIF_MAX_CHARS)) return false;
  if (!isBoundedString(v["type"], PUNISHMENT_TYPE_MAX_CHARS)) return false;
  if (!isIsoDate(v["date"])) return false;
  if (v["dateEnd"] !== undefined && !isIsoDate(v["dateEnd"])) return false;
  if (
    v["dateEnd"] !== undefined &&
    Date.parse(v["dateEnd"] as string) < Date.parse(v["date"] as string)
  ) {
    return false;
  }
  const gravity = v["gravity"];
  if (gravity !== undefined && (!isFiniteNumber(gravity) || (gravity as number) < 0)) {
    return false;
  }
  if (v["periodId"] !== undefined && !isNonEmptyString(v["periodId"])) return false;
  return true;
}

export function isAttendancePeriod(v: unknown): v is AttendancePeriod {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["periodId"])) return false;
  if (v["name"] !== undefined && !isOptionalBoundedString(v["name"], ATTENDANCE_NAME_MAX_CHARS)) {
    return false;
  }
  for (const k of ["absences", "late", "missingMinutes"]) {
    const n = v[k];
    if (!isFiniteNumber(n) || !Number.isInteger(n) || (n as number) < 0) return false;
  }
  return true;
}
