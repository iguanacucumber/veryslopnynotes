// Messagerie pure : aucun état, aucun réseau, aucun React. Les payloads du pont
// natif (`discussions`, `messages`, `recipients`) ou l'enveloppe `items` du pont
// factice sont acceptés. Tout texte reste une DONNÉE (React l'échappe).
import { cleanText } from "../../lib/format";

export const MAX_ID = 64;
export const MAX_NAME = 100;
export const MAX_SUBJECT = 200;
export const MAX_BODY = 4000;
export const MAX_PARTICIPANTS = 20;
export const MAX_UNREAD = 999;
export const MAX_ATTACHMENT_LABEL = 200;
export const MAX_ATTACHMENT_REF = 200;
export const UNKNOWN_UNREAD = -1;
export const RECIPIENT_KINDS = ["student", "teacher", "administration"] as const;
/** Fils visibles enrichis par lot : borne le nombre de requêtes du pont. */
export const MAX_VISIBLE_ENRICH = 12;

export interface MessageAttachment {
  id: string;
  label: string;
  ref: string;
}

export interface Discussion {
  id: string;
  subject: string;
  participants: string[];
  unreadCount: number;
  /** Date du dernier message : null = inconnue, jamais devinée. */
  lastMessageAt: string | null;
  /** null = fraîcheur INCONNUE : le natif omet le champ ; une date « maintenant »
   *  ferait remonter les fils les plus anciens en tête. */
  updatedAt: string | null;
}

export interface DiscussionMessage {
  id: string;
  discussionId: string;
  authorName: string;
  body: string;
  sentAt: string;
  attachments: MessageAttachment[];
}

export interface DiscussionRecipient {
  id: string;
  displayName: string;
  kind: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function bound(value: unknown, max: number): string {
  const raw = cleanText(value);
  if (!raw) return "";
  const points = Array.from(raw);
  return points.length <= max ? raw : points.slice(0, max).join("");
}

function text(value: unknown, max: number): string {
  return bound(value, max);
}

function arrayOf(root: Record<string, unknown>, canonicalKey: string): unknown[] {
  const canonical = root[canonicalKey];
  if (Array.isArray(canonical)) return canonical;
  // Repli du pont factice de développement, pas du contrat.
  const items = root["items"];
  return Array.isArray(items) ? items : [];
}

export function payloadRoot(payload: string | null): Record<string, unknown> | null {
  if (!payload) return null;
  try {
    return record(JSON.parse(payload) as unknown);
  } catch {
    return null;
  }
}

export function parseDiscussions(payload: string | null): Discussion[] {
  const root = payloadRoot(payload);
  if (!root) return [];
  const out: Discussion[] = [];
  for (const raw of arrayOf(root, "discussions")) {
    const obj = record(raw);
    if (!obj) continue;
    const id = text(obj["id"], MAX_ID);
    if (!id) continue;
    const participants: string[] = [];
    if (Array.isArray(obj["participants"])) {
      for (const part of obj["participants"]) {
        const name = text(part, MAX_NAME);
        if (name) participants.push(name);
      }
    }
    const unreadRaw = obj["unreadCount"];
    const unread =
      typeof unreadRaw === "number" && Number.isInteger(unreadRaw) && unreadRaw >= 0 && unreadRaw <= MAX_UNREAD
        ? unreadRaw
        : UNKNOWN_UNREAD;
    const lastMessageAt = text(obj["lastMessageAt"], 40) || null;
    const updatedAt = text(obj["updatedAt"], 40);
    out.push({
      id,
      // Le producteur natif remplit déjà « Discussion » quand le sujet est vide.
      subject: text(obj["subject"], MAX_SUBJECT) || participants.slice(0, 2).join(", ") || "Discussion",
      participants: participants.slice(0, MAX_PARTICIPANTS),
      unreadCount: unread,
      lastMessageAt,
      // Fraîcheur inconnue = null, jamais « maintenant » ; repli sur le dernier
      // message quand il est connu.
      updatedAt: updatedAt || lastMessageAt,
    });
  }
  return out;
}

/** Métadonnées de fils enrichis à la demande (dates seulement). */
export interface EnrichedDiscussion {
  id: string;
  lastMessageAt: string | null;
  updatedAt: string | null;
}

export function parseEnrichedDiscussions(payload: string | null): EnrichedDiscussion[] {
  const root = payloadRoot(payload);
  if (!root) return [];
  const out: EnrichedDiscussion[] = [];
  for (const raw of arrayOf(root, "discussions")) {
    const obj = record(raw);
    if (!obj) continue;
    const id = text(obj["id"], MAX_ID);
    if (!id) continue;
    const lastMessageAt = text(obj["lastMessageAt"], 40) || null;
    out.push({
      id,
      lastMessageAt,
      updatedAt: text(obj["updatedAt"], 40) || lastMessageAt,
    });
  }
  return out;
}

/** Fusionne les dates enrichies sans toucher au compteur non lu ni à l'ordre
 *  d'arrivée ; l'appelant retrie ensuite. */
export function mergeEnrichedDiscussions(
  list: readonly Discussion[],
  enriched: readonly EnrichedDiscussion[],
): Discussion[] {
  if (enriched.length === 0) return [...list];
  const byId = new Map(enriched.map((d) => [d.id, d]));
  return list.map((d) => {
    const extra = byId.get(d.id);
    if (!extra || (!extra.lastMessageAt && !extra.updatedAt)) return d;
    return {
      ...d,
      lastMessageAt: extra.lastMessageAt,
      updatedAt: extra.updatedAt,
    };
  });
}

/** Identifiants visibles pas encore enrichis, bornés par lot (requêtes bornées). */
export function nextEnrichBatch(
  visible: readonly string[],
  already: ReadonlySet<string>,
  max = MAX_VISIBLE_ENRICH,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const bound = Math.max(0, Math.floor(max));
  if (bound === 0) return out;
  for (const raw of visible) {
    const id = raw.trim();
    if (!id || seen.has(id) || already.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= bound) break;
  }
  return out;
}

function attachmentValid(a: MessageAttachment): boolean {
  if (!a.id || !a.label || !a.ref) return false;
  if (a.ref.includes("://") || a.ref.startsWith("//") || a.ref.includes("data:") || a.ref.includes("\\\\")) {
    return false;
  }
  return true;
}

/** Un JSON illisible n'est PAS un fil vide (I14 : « invalide » ≠ « vide »).
 *  `null` = aucun payload, traité à part par l'appelant. */
export function isMessagesPayloadReadable(payload: string | null): boolean {
  if (payload === null) return false;
  return payloadRoot(payload) !== null;
}

export function parseMessages(payload: string | null): DiscussionMessage[] {
  const root = payloadRoot(payload);
  if (!root) return [];
  const out: DiscussionMessage[] = [];
  for (const raw of arrayOf(root, "messages")) {
    const obj = record(raw);
    if (!obj) continue;
    const id = text(obj["id"], MAX_ID);
    const discussionId = text(obj["discussionId"], MAX_ID);
    const body = text(obj["body"], MAX_BODY);
    if (!id || !discussionId || !body) continue;
    const attachments: MessageAttachment[] = [];
    if (Array.isArray(obj["attachments"])) {
      for (const item of obj["attachments"]) {
        const att = record(item);
        if (!att) continue;
        attachments.push({
          id: text(att["id"], MAX_ID),
          label: text(att["label"], MAX_ATTACHMENT_LABEL),
          ref: text(att["ref"], MAX_ATTACHMENT_REF),
        });
      }
    }
    // Une pièce jointe hors contrat invalide le lot, comme le parseur natif.
    out.push({
      id,
      discussionId,
      authorName: text(obj["authorName"], MAX_NAME),
      body,
      sentAt: text(obj["sentAt"], 40),
      attachments: attachments.every(attachmentValid) ? attachments : [],
    });
  }
  return out;
}

/** Participants d'un fil OUVERT : la liste ne les porte plus, une recherche par
 *  nom ne porte donc que sur la liste. */
export function parseParticipants(payload: string | null): string[] {
  const root = payloadRoot(payload);
  if (!root) return [];
  const raw = root["participants"];
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const part of raw) {
    const name = text(part, MAX_NAME);
    if (name) out.push(name);
  }
  return out.slice(0, MAX_PARTICIPANTS);
}

export function parseRecipients(payload: string | null): DiscussionRecipient[] {
  const root = payloadRoot(payload);
  if (!root) return [];
  const out: DiscussionRecipient[] = [];
  for (const raw of arrayOf(root, "recipients")) {
    const obj = record(raw);
    if (!obj) continue;
    const id = text(obj["id"], MAX_ID);
    // `name` est la forme du pont factice ; `displayName` celle du contrat.
    const displayName = text(obj["displayName"], MAX_NAME) || text(obj["name"], MAX_NAME);
    if (!id || !displayName) continue;
    const kind = text(obj["kind"], 32);
    out.push({
      id,
      displayName,
      kind: (RECIPIENT_KINDS as readonly string[]).includes(kind) ? kind : "",
    });
  }
  return out;
}

/** Un payload sans liste de destinataires n'est PAS « personne publié » (I14).
 *  `null` = aucun payload, traité à part par l'appelant. */
export function isRecipientsPayloadReadable(payload: string | null): boolean {
  const root = payloadRoot(payload);
  return root !== null && (Array.isArray(root["recipients"]) || Array.isArray(root["items"]));
}
