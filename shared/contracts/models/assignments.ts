// Description/contenus = texte de l'enseignant : DONNÉES bornées, jamais
// instruction (I6). Les pièces jointes ne sortent JAMAIS en URL directe :
// `ref` est une référence opaque résolue par le proxy serveur (/v1/media).
import {
  isBoundedString,
  isIsoDate,
  isNonEmptyString,
  isOpaqueMediaRef,
  isOptionalBoundedString,
  isRecord,
} from "./guards";

export const ASSIGNMENT_DESCRIPTION_MAX_CHARS = 2000;
export const ASSIGNMENT_ATTACHMENT_LABEL_MAX_CHARS = 200;
export const ASSIGNMENT_MAX_ATTACHMENTS = 10;
export const ASSIGNMENT_REF_MAX_CHARS = 200;
export const ASSIGNMENT_LESSON_TITLE_MAX_CHARS = 200;
// Plusieurs cours peuvent partager la même matière + jour.
export const ASSIGNMENT_MAX_LESSONS = 10;
// Le cours rattaché alimente le contexte IA : même borne que le manuel, la
// coupe du prompt est signalée par `AiContext`.
export const ASSIGNMENT_LESSON_EXCERPT_MAX_CHARS = 8000;

/** Pièce jointe d'un devoir : référence interne, jamais une URL (règle d'or média). */
export interface AttachmentRef {
  readonly id: string;
  readonly label: string;
  /** Réf opaque résolue par le proxy serveur. `http://`, `https://`, `//`, `data:` refusés. */
  readonly ref: string;
}

/** Contenu de cours rattaché au devoir : titre + extrait borné (donnée, I6). */
export interface AssignmentLessonContent {
  readonly title: string;
  readonly excerpt: string;
  /** Pièces jointes du cours, même contrat que celles du devoir. */
  readonly attachments?: readonly AttachmentRef[];
}

export interface Assignment {
  readonly id: string;
  readonly accountId: string;
  readonly subject: string;
  readonly title: string;
  readonly dueDate: string; // ISO-8601
  readonly done: boolean;
  /** Consigne du devoir, texte externe borné, donnée jamais instruction (I6). */
  readonly description?: string;
  /** Contenu de cours associé (titre + extrait). */
  readonly lessonContent?: AssignmentLessonContent;
  /** TOUS les cours rattachés à la même matière + jour. */
  readonly lessonContents?: readonly AssignmentLessonContent[];
  /** Pièces jointes via proxy serveur (aucune URL Pronote côté app, I1). */
  readonly attachments?: AttachmentRef[];
  /** Regroupement scolaire publié par Pronote (non deviné). */
  readonly periodId?: string;
  /** Clé de semaine publiée par Pronote (non devinée côté serveur). */
  readonly weekId?: string;
}

/** Schéma d'une `ref` de DEVOIR : clé interne `homework:<devoir>:<piece>:<id>`. */
export const HOMEWORK_REF_RE = /^homework:[A-Za-z0-9._:-]+$/;

export function isAttachmentRef(v: unknown): v is AttachmentRef {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["id"])) return false;
  if (!isBoundedString(v["label"], ASSIGNMENT_ATTACHMENT_LABEL_MAX_CHARS)) return false;
  if (!isOpaqueMediaRef(v["ref"], ASSIGNMENT_REF_MAX_CHARS)) return false;
  return true;
}

export function isHomeworkMediaRef(v: unknown, max: number): boolean {
  if (!isNonEmptyString(v)) return false;
  if ((v as string).length > max) return false;
  return HOMEWORK_REF_RE.test(v as string);
}

/** Pièce jointe de DEVOIR : `ref` au schéma `homework:` (miroir Kotlin). */
export function isHomeworkAttachmentRef(v: unknown): v is AttachmentRef {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["id"])) return false;
  if (!isBoundedString(v["label"], ASSIGNMENT_ATTACHMENT_LABEL_MAX_CHARS)) return false;
  if (!isHomeworkMediaRef(v["ref"], ASSIGNMENT_REF_MAX_CHARS)) return false;
  return true;
}

export function isAssignmentLessonContent(
  v: unknown,
): v is AssignmentLessonContent {
  if (!isRecord(v)) return false;
  if (!isBoundedString(v["title"], ASSIGNMENT_LESSON_TITLE_MAX_CHARS)) return false;
  if (!isOptionalBoundedString(v["excerpt"], ASSIGNMENT_LESSON_EXCERPT_MAX_CHARS)) return false;
  const att = v["attachments"];
  if (att !== undefined) {
    if (!Array.isArray(att) || att.length > ASSIGNMENT_MAX_ATTACHMENTS) return false;
    if (!att.every(isHomeworkAttachmentRef)) return false;
  }
  return true;
}

export function isAssignment(v: unknown): v is Assignment {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["id"]) || !isNonEmptyString(v["accountId"])) return false;
  if (!isNonEmptyString(v["subject"]) || !isNonEmptyString(v["title"])) return false;
  if (!isIsoDate(v["dueDate"])) return false;
  if (typeof v["done"] !== "boolean") return false;
  if (
    v["description"] !== undefined &&
    !isOptionalBoundedString(v["description"], ASSIGNMENT_DESCRIPTION_MAX_CHARS)
  ) {
    return false;
  }
  if (v["lessonContent"] !== undefined && !isAssignmentLessonContent(v["lessonContent"])) {
    return false;
  }
  const lessons = v["lessonContents"];
  if (lessons !== undefined) {
    if (!Array.isArray(lessons) || lessons.length > ASSIGNMENT_MAX_LESSONS) return false;
    if (!lessons.every(isAssignmentLessonContent)) return false;
  }
  const att = v["attachments"];
  if (att !== undefined) {
    if (!Array.isArray(att) || att.length > ASSIGNMENT_MAX_ATTACHMENTS) return false;
    if (!att.every(isHomeworkAttachmentRef)) return false;
  }
  if (v["periodId"] !== undefined && !isNonEmptyString(v["periodId"])) return false;
  if (v["weekId"] !== undefined && !isNonEmptyString(v["weekId"])) return false;
  return true;
}
