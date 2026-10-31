// TOUT texte de messagerie est une DONNÉE non fiable : bornée, jamais
// exécutée ni interprétée, et JAMAIS remise à un LLM (I6).
import {
  ASSIGNMENT_MAX_ATTACHMENTS,
  AttachmentRef,
  isAttachmentRef,
} from "./assignments";
import { isBoundedString, isIsoDate, isRecord } from "./guards";

/** Destinataire Pronote : enseignant ou administration. */
export const RECIPIENT_KINDS = ["student", "teacher", "administration"] as const;

export type RecipientKind = (typeof RECIPIENT_KINDS)[number];

/** Identifiants Pronote bornés (fil, message, destinataire). */
export const DISCUSSION_ID_MAX_CHARS = 64;
export const RECIPIENT_NAME_MAX_CHARS = 100;
export const MESSAGE_AUTHOR_MAX_CHARS = 100;
export const DISCUSSION_SUBJECT_MAX_CHARS = 200;
export const DISCUSSION_PARTICIPANT_MAX_CHARS = 100;
export const DISCUSSION_MAX_PARTICIPANTS = 20;
export const DISCUSSION_MAX_RECIPIENTS = 20;
/** Corps de message : texte libre le plus long du contrat (donnée, I6). */
export const MESSAGE_BODY_MAX_CHARS = 4000;
/** Non-lus publiés par l'établissement : au-delà, compteur ignoré. */
export const DISCUSSION_MAX_UNREAD = 999;

export interface Recipient {
  readonly id: string;
  readonly displayName: string;
  readonly kind: RecipientKind;
}

export interface Message {
  readonly id: string;
  readonly discussionId: string;
  /** Auteur publié par l'établissement, borné. ABSENT = message écrit par le compte appairé. */
  readonly authorId?: string;
  readonly authorName?: string;
  /** Corps = texte d'un élève ou d'un enseignant : DONNÉE bornée (I6). */
  readonly body: string;
  readonly sentAt: string; // ISO-8601
  /** Pièces jointes via proxy serveur (réf opaque, jamais une URL : I1). */
  readonly attachments?: AttachmentRef[];
}

export interface Discussion {
  readonly id: string;
  readonly subject: string;
  /** Participants publiés, bornés et sans doublon ; vide = non publiés. */
  readonly participants: string[];
  /** Messages non lus ; absent = non publié par l'établissement (jamais 0 deviné). */
  readonly unreadCount?: number;
  readonly lastMessageAt?: string; // ISO-8601
  /** Fraîcheur du fil. ABSENTE = fraîcheur INCONNUE, jamais une date devinée. */
  readonly updatedAt?: string; // ISO-8601
}

export function isRecipient(v: unknown): v is Recipient {
  if (!isRecord(v)) return false;
  if (!isBoundedString(v["id"], DISCUSSION_ID_MAX_CHARS)) return false;
  if (!isBoundedString(v["displayName"], RECIPIENT_NAME_MAX_CHARS)) return false;
  if (!(RECIPIENT_KINDS as readonly string[]).includes(v["kind"] as string)) return false;
  return true;
}

export function isMessage(v: unknown): v is Message {
  if (!isRecord(v)) return false;
  if (!isBoundedString(v["id"], DISCUSSION_ID_MAX_CHARS)) return false;
  if (!isBoundedString(v["discussionId"], DISCUSSION_ID_MAX_CHARS)) return false;
  if (v["authorId"] !== undefined && !isBoundedString(v["authorId"], DISCUSSION_ID_MAX_CHARS)) {
    return false;
  }
  if (
    v["authorName"] !== undefined &&
    !isBoundedString(v["authorName"], MESSAGE_AUTHOR_MAX_CHARS)
  ) {
    return false;
  }
  if (!isBoundedString(v["body"], MESSAGE_BODY_MAX_CHARS)) return false;
  if (!isIsoDate(v["sentAt"])) return false;
  const att = v["attachments"];
  if (att !== undefined) {
    if (!Array.isArray(att) || att.length > ASSIGNMENT_MAX_ATTACHMENTS) return false;
    if (!att.every(isAttachmentRef)) return false;
  }
  return true;
}

export function isDiscussion(v: unknown): v is Discussion {
  if (!isRecord(v)) return false;
  if (!isBoundedString(v["id"], DISCUSSION_ID_MAX_CHARS)) return false;
  if (!isBoundedString(v["subject"], DISCUSSION_SUBJECT_MAX_CHARS)) return false;
  const participants = v["participants"];
  if (!Array.isArray(participants) || participants.length > DISCUSSION_MAX_PARTICIPANTS) {
    return false;
  }
  const seen = new Set<string>();
  for (const p of participants) {
    if (!isBoundedString(p, DISCUSSION_PARTICIPANT_MAX_CHARS)) return false;
    if (seen.has(p)) return false;
    seen.add(p);
  }
  const unread = v["unreadCount"];
  if (
    unread !== undefined &&
    (!Number.isInteger(unread) || (unread as number) < 0 || (unread as number) > DISCUSSION_MAX_UNREAD)
  ) {
    return false;
  }
  if (v["lastMessageAt"] !== undefined && !isIsoDate(v["lastMessageAt"])) return false;
  if (v["updatedAt"] !== undefined && !isIsoDate(v["updatedAt"])) return false;
  return true;
}
