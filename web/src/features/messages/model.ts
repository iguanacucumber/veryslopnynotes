// Logique affichable de la messagerie (miroir web de MessagesLogic.kt et de
// DiscussionsRepository.kt). Pure : aucun état, aucun réseau, aucun React —
// donc testable sans téléphone depuis tests/web/social.test.ts.
//
// Les payloads sont ceux du pont natif : `{"discussions":[]}`, `{"messages":[]}`,
// `{"recipients":[]}`. Le pont factice de `web/src/bridge/mock.ts` publie la
// même donnée sous `{"items":[]}` : on accepte les deux formes, jamais un
// troisième schéma inventé. Tout texte reste une DONNÉE (React l'échappe) —
// aucun HTML n'est construit ni interprété.
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
  lastMessageAt: string;
  updatedAt: string;
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

export interface RecipientGroup {
  kind: string;
  label: string;
  recipients: DiscussionRecipient[];
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

function payloadRoot(payload: string | null): Record<string, unknown> | null {
  if (!payload) return null;
  try {
    return record(JSON.parse(payload) as unknown);
  } catch {
    return null;
  }
}

/** Instant d'un ISO du contrat, ou null s'il est illisible.
 *  Les deux formes sont admises : instant complet et date seule. */
export function parseInstant(value: string | null | undefined): number | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;
  // Une DATE SEULE est minuit LOCAL (comme le parseur natif), sinon elle
  // glisserait d'un jour dans les fuseaux à l'ouest de Greenwich.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]) - 1;
    const day = Number(dateOnly[3]);
    const local = new Date(year, month, day);
    if (local.getFullYear() !== year || local.getMonth() !== month || local.getDate() !== day) return null;
    return local.getTime();
  }
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
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
    const lastMessageAt = text(obj["lastMessageAt"], 40);
    out.push({
      id,
      // Le producteur natif remplit déjà « Discussion » quand le sujet est vide.
      subject: text(obj["subject"], MAX_SUBJECT) || participants.slice(0, 2).join(", ") || "Discussion",
      participants: participants.slice(0, MAX_PARTICIPANTS),
      unreadCount: unread,
      lastMessageAt,
      updatedAt: text(obj["updatedAt"], 40) || lastMessageAt,
    });
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

/** Millis du fil pour le tri : `lastMessageAt`, sinon `updatedAt`. */
export function discussionMillis(d: Discussion): number | null {
  return parseInstant(d.lastMessageAt) ?? parseInstant(d.updatedAt);
}

/** Tri du plus récent au plus ancien, égalité tranchée par `id`. */
export function sortDiscussions(list: Discussion[]): Discussion[] {
  return [...list].sort((a, b) => {
    const am = discussionMillis(a) ?? Number.MIN_SAFE_INTEGER;
    const bm = discussionMillis(b) ?? Number.MIN_SAFE_INTEGER;
    if (am !== bm) return bm - am;
    return a.id.localeCompare(b.id);
  });
}

export function foldForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function discussionMatches(d: Discussion, query: string): boolean {
  const needle = foldForSearch(query);
  if (!needle) return true;
  return [d.subject, ...d.participants].some((v) => foldForSearch(v).includes(needle));
}

export function searchDiscussions(list: Discussion[], query: string): Discussion[] {
  return sortDiscussions(list.filter((d) => discussionMatches(d, query)));
}

/** Compteur affichable : jamais négatif, inconnu = aucun badge. */
export function unreadBadgeCount(d: Discussion): number {
  return d.unreadCount > 0 ? d.unreadCount : 0;
}

/** Nombre de FILS non lus, pas la somme des messages. */
export function unreadTotal(list: Discussion[]): number {
  return list.filter((d) => unreadBadgeCount(d) > 0).length;
}

export function isRead(d: Discussion): boolean {
  return d.unreadCount === 0;
}

export function unreadTotalLabel(count: number): string {
  return count > 1 ? `${count} non lus` : "1 non lu";
}

export function conversationCountLabel(count: number): string {
  return count > 1 ? `${count} discussions` : `${count} discussion`;
}

export function pickedCountLabel(count: number): string {
  return count > 1 ? `${count} destinataires` : `${count} destinataire`;
}

export function messagePreview(body: string, maxChars = 120): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const boundTo = Math.min(Math.max(maxChars, 1), MAX_BODY);
  const points = Array.from(flat);
  return points.length <= boundTo ? flat : `${points.slice(0, boundTo).join("").trimEnd()}…`;
}

/** Le contrat omet l'auteur d'un message du compte appairé : chaîne vide. */
export function isOwnMessage(m: DiscussionMessage): boolean {
  return m.authorName.trim() === "";
}

const RECIPIENT_KIND_ORDER = ["teacher", "student", "administration"];
const RECIPIENT_LABELS: Record<string, string> = {
  teacher: "Professeurs",
  student: "Élèves",
  administration: "Administration",
};
const RECIPIENT_FALLBACK = "Destinataire";

export function recipientKindLabel(kind: string): string {
  return RECIPIENT_LABELS[kind] ?? RECIPIENT_FALLBACK;
}

export function groupRecipients(recipients: DiscussionRecipient[]): RecipientGroup[] {
  if (recipients.length === 0) return [];
  const known = RECIPIENT_KIND_ORDER.filter((kind) => recipients.some((r) => r.kind === kind));
  const extras = [...new Set(recipients.map((r) => r.kind))].filter((k) => !RECIPIENT_KIND_ORDER.includes(k));
  return [...known, ...extras].map((kind) => ({
    kind,
    label: recipientKindLabel(kind),
    recipients: recipients.filter((r) => r.kind === kind),
  }));
}

export function recipientMatches(r: DiscussionRecipient, query: string): boolean {
  const needle = foldForSearch(query);
  if (!needle) return true;
  return foldForSearch(r.displayName).includes(needle);
}

export function searchRecipients(recipients: DiscussionRecipient[], query: string): RecipientGroup[] {
  return groupRecipients(recipients.filter((r) => recipientMatches(r, query)));
}

const LONG_DATE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const DATE_TIME = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Date longue française, chaîne vide si la date est illisible. */
export function formatLongDate(value: string | number | null | undefined): string {
  const ms = typeof value === "number" ? value : parseInstant(value);
  if (ms === null || !Number.isFinite(ms)) return "";
  try {
    return LONG_DATE.format(new Date(ms));
  } catch {
    return "";
  }
}

/** Date et heure longues : l'horodatage d'un message. */
export function formatDateTime(value: string | number | null | undefined): string {
  const ms = typeof value === "number" ? value : parseInstant(value);
  if (ms === null || !Number.isFinite(ms)) return "";
  try {
    return DATE_TIME.format(new Date(ms));
  } catch {
    return "";
  }
}

export function conversationDateLabel(d: Discussion): string {
  const ms = discussionMillis(d);
  return ms === null ? "" : formatLongDate(ms);
}

export function messageTimeLabel(m: DiscussionMessage): string {
  return m.sentAt ? formatDateTime(m.sentAt) : "";
}
