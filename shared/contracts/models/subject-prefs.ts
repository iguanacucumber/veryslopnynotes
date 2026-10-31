// Add-only : une matière sans SubjectPrefs s'affiche avec son seul nom (fallback UI).
import { isIsoDate, isRecord } from "./guards";

export const SUBJECT_PREFS_MAX_SUBJECT_CHARS = 64;
export const SUBJECT_PREFS_MAX_EMOJI_CHARS = 8; // en points de code
export const SUBJECT_PREFS_MAX_LABEL_CHARS = 64;
export const SUBJECT_PREFS_MAX_COUNT = 64; // matières personnalisées maxi

/** Couleur matière = # + 6 hex exactement, pas de #RGB ni de nom CSS. */
const SUBJECT_HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Chaîne non vide, bornée en points de code (emoji surrogate pairs inclus). */
function isBoundedText(v: unknown, max: number): v is string {
  return typeof v === "string" && v.trim().length > 0 && [...v].length <= max;
}

export interface SubjectPrefs {
  readonly subject: string;
  /** Couleur d'affichage #RRGGBB (absente = couleur par défaut du thème). */
  readonly color?: string;
  readonly emoji?: string;
  /** Libellé personnalisé (absent = nom de matière d'origine). */
  readonly label?: string;
  readonly updatedAt: string; // ISO-8601
}

export function isSubjectPrefs(v: unknown): v is SubjectPrefs {
  if (!isRecord(v)) return false;
  if (!isBoundedText(v["subject"], SUBJECT_PREFS_MAX_SUBJECT_CHARS)) return false;
  if (
    v["color"] !== undefined &&
    (typeof v["color"] !== "string" || !SUBJECT_HEX_COLOR_RE.test(v["color"]))
  ) {
    return false;
  }
  if (v["emoji"] !== undefined && !isBoundedText(v["emoji"], SUBJECT_PREFS_MAX_EMOJI_CHARS)) {
    return false;
  }
  if (v["label"] !== undefined && !isBoundedText(v["label"], SUBJECT_PREFS_MAX_LABEL_CHARS)) {
    return false;
  }
  if (!isIsoDate(v["updatedAt"])) return false;
  // ponytail: clés inconnues tolérées (add-only, pas de rejet des versions
  // futures). La taille du corps PUT est bornée par le routeur
  // (SUBJECT_PREFS_MAX_BODY_CHARS) : pas d'entrée arbitrairement longue.
  return true;
}
