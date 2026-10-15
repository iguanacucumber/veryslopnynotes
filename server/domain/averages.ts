// Minimal helpers/types for local Pronote corpus capture.
// Average calculations live in android/core/Averages.kt.
export interface ProvidedAverages {
  readonly periodId?: string | null;
  readonly general?: number | null;
  /** Clé = nom de matière normalisé. */
  readonly subjects?: Readonly<Record<string, number>>;
}

/** Clé de matière canonique utilisée par la capture des moyennes publiées. */
export function subjectKey(subject: string): string {
  return subject
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
