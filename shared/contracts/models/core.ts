// Contrats — core : versions, fiches révision, notes, périodes.
import {
  isFiniteNumber,
  isIsoDate,
  isNonEmptyString,
  isRecord,
} from "./guards";

/** Version du contrat des modèles app↔serveur. */
export const CONTRACTS_VERSION = "0.11.0" as const;

/** Version gabarit fiches révision (issue #30, phase 10). Stockée par fiche. */
export const REVISION_TEMPLATE_VERSION = "fiche-v1" as const;

export interface RevisionSheet {
  readonly id: string;
  readonly examId: string;
  readonly subject: string;
  readonly date: string; // ISO-8601
  readonly title: string;
  readonly body: string;
  readonly sources: string[];
  readonly templateVersion: typeof REVISION_TEMPLATE_VERSION;
  readonly createdAt: string; // ISO-8601
}

export interface Grade {
  readonly id: string;
  readonly accountId: string;
  readonly subject: string;
  readonly value: number;
  readonly scale: number;
  readonly coefficient?: number;
  readonly date: string; // ISO-8601
  /** Moyenne de classe sur l'échelle de la note, si l'établissement la publie. */
  readonly classAverage?: number;
  /** Note la plus basse / plus haute de la classe (borne d'interprétation). */
  readonly classMin?: number;
  readonly classMax?: number;
  /** Période (trimestre/semestre) d'appartenance de la note. */
  readonly periodId?: string;
  /** Note bonus (majoration) : traitée à part par les 3 algorithmes. */
  readonly bonus?: boolean;
  /** Note facultative : ne compte que si elle améliore la moyenne. */
  readonly optional?: boolean;
  /** Libellé libre de l'évaluation (commentaire enseignant) = donnée, jamais instruction (I6). */
  readonly label?: string;
  /** Enseignant, si Pronote le publie. */
  readonly teacher?: string;
}

/** Période scolaire (trimestre, semestre, année) servant de regroupement des moyennes. */
export interface Period {
  readonly id: string;
  readonly name: string;
  readonly start: string; // ISO-8601
  readonly end: string; // ISO-8601
}

export function isGrade(v: unknown): v is Grade {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["id"]) || !isNonEmptyString(v["accountId"])) return false;
  if (!isNonEmptyString(v["subject"])) return false;
  if (!isFiniteNumber(v["value"]) || (v["value"] as number) < 0) return false;
  if (!isFiniteNumber(v["scale"]) || (v["scale"] as number) <= 0) return false;
  if (
    v["coefficient"] !== undefined &&
    (!isFiniteNumber(v["coefficient"]) || (v["coefficient"] as number) <= 0)
  ) {
    return false;
  }
  if (!isIsoDate(v["date"])) return false;
  for (const k of ["classAverage", "classMin", "classMax"]) {
    if (v[k] !== undefined && !isFiniteNumber(v[k])) return false;
  }
  if (v["periodId"] !== undefined && !isNonEmptyString(v["periodId"])) return false;
  if (v["bonus"] !== undefined && typeof v["bonus"] !== "boolean") return false;
  if (v["optional"] !== undefined && typeof v["optional"] !== "boolean") return false;
  if (v["label"] !== undefined && typeof v["label"] !== "string") return false;
  if (v["teacher"] !== undefined && typeof v["teacher"] !== "string") return false;
  return true;
}

export function isPeriod(v: unknown): v is Period {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["id"]) || !isNonEmptyString(v["name"])) return false;
  if (!isIsoDate(v["start"]) || !isIsoDate(v["end"])) return false;
  if (Date.parse(v["end"] as string) < Date.parse(v["start"] as string)) return false;
  return true;
}

export function isRevisionSheet(v: unknown): v is RevisionSheet {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["id"]) || !isNonEmptyString(v["examId"])) return false;
  if (!isNonEmptyString(v["subject"]) || !isNonEmptyString(v["title"])) return false;
  if (!isNonEmptyString(v["body"])) return false;
  if (!isIsoDate(v["date"]) || !isIsoDate(v["createdAt"])) return false;
  if (!Array.isArray(v["sources"]) || v["sources"].length === 0) return false;
  for (const s of v["sources"] as unknown[]) if (!isNonEmptyString(s)) return false;
  if (v["templateVersion"] !== REVISION_TEMPLATE_VERSION) return false;
  return true;
}
