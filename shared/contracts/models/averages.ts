// Contrats — moyennes (algorithmes parité Papillon).
import {
  isFiniteNumber,
  isIsoDate,
  isNonEmptyString,
  isNullableNumberOrNull,
  isRecord,
} from "./guards";

// subject  = moyenne des moyennes de matière (défaut Papillon)
// weighted = toutes notes poolées, pondérées par coefficient
// median   = médiane des notes ramenées sur /20
export const AVERAGE_ALGORITHMS = ["subject", "weighted", "median"] as const;

export type AverageAlgorithm = (typeof AVERAGE_ALGORITHMS)[number];

export const DEFAULT_AVERAGE_ALGORITHM: AverageAlgorithm = "subject";

/** Provenance de la moyenne : fournie par l'établissement, ou estimée par nos algorithmes. */
export type AverageOrigin = "provided" | "estimated";

export interface SubjectAverage {
  readonly subject: string;
  /** Valeur sur /20, ou null si la période ne contient aucune note exploitable. */
  readonly value: number | null;
  readonly origin: AverageOrigin;
  /** Notes exploitables comptées dans la matière (hors coefficient 0). */
  readonly gradeCount: number;
}

export interface GeneralAverage {
  readonly value: number | null;
  readonly origin: AverageOrigin;
  readonly subjectCount: number;
}

/** Influence d'une note sur la moyenne générale (écart avec/sans la note, /20). */
export interface GradeInfluence {
  readonly gradeId: string;
  readonly subject: string;
  /** Écart de moyenne générale avec/sans la note. Négatif = la note fait baisser la moyenne. */
  readonly impact: number;
}

/** Point d'historique : moyenne générale recalculée à chaque nouvelle note (courbe). */
export interface AverageHistoryPoint {
  readonly date: string; // ISO-8601
  readonly value: number | null;
}

export interface AveragesReport {
  readonly algorithm: AverageAlgorithm;
  readonly periodId: string | null;
  readonly general: GeneralAverage;
  readonly subjects: SubjectAverage[];
  readonly history: AverageHistoryPoint[];
  readonly influences: GradeInfluence[];
}

export function isAverageAlgorithm(v: unknown): v is AverageAlgorithm {
  return typeof v === "string" && (AVERAGE_ALGORITHMS as readonly string[]).includes(v);
}

export function isSubjectAverage(v: unknown): v is SubjectAverage {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["subject"])) return false;
  if (!isNullableNumberOrNull(v["value"])) return false;
  if (v["origin"] !== "provided" && v["origin"] !== "estimated") return false;
  if (!Number.isInteger(v["gradeCount"]) || (v["gradeCount"] as number) < 0) return false;
  return true;
}

export function isGeneralAverage(v: unknown): v is GeneralAverage {
  if (!isRecord(v)) return false;
  if (!isNullableNumberOrNull(v["value"])) return false;
  if (v["origin"] !== "provided" && v["origin"] !== "estimated") return false;
  if (!Number.isInteger(v["subjectCount"]) || (v["subjectCount"] as number) < 0) return false;
  return true;
}

export function isGradeInfluence(v: unknown): v is GradeInfluence {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["gradeId"]) || !isNonEmptyString(v["subject"])) return false;
  if (!isFiniteNumber(v["impact"])) return false;
  return true;
}

export function isAverageHistoryPoint(v: unknown): v is AverageHistoryPoint {
  if (!isRecord(v)) return false;
  if (!isIsoDate(v["date"])) return false;
  if (!isNullableNumberOrNull(v["value"])) return false;
  return true;
}

export function isAveragesReport(v: unknown): v is AveragesReport {
  if (!isRecord(v)) return false;
  if (!isAverageAlgorithm(v["algorithm"])) return false;
  if (v["periodId"] !== null && !isNonEmptyString(v["periodId"])) return false;
  if (!isGeneralAverage(v["general"])) return false;
  const s = v["subjects"];
  if (!Array.isArray(s) || !s.every(isSubjectAverage)) return false;
  const h = v["history"];
  if (!Array.isArray(h) || !h.every(isAverageHistoryPoint)) return false;
  const i = v["influences"];
  if (!Array.isArray(i) || !i.every(isGradeInfluence)) return false;
  return true;
}
