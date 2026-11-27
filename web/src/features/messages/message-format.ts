import { parseInstant } from "../../lib/format";
import { subjectKey } from "../../lib/subject";
import { MAX_BODY, type Discussion, type DiscussionMessage } from "./message-parse";

/** Millis du fil pour le tri : `lastMessageAt`, sinon `updatedAt` ; null quand
 *  la fraîcheur est INCONNUE (jamais une date devinée). */
export function discussionMillis(d: Discussion): number | null {
  return parseInstant(d.lastMessageAt) ?? parseInstant(d.updatedAt);
}

/** Tri du plus récent au plus ancien. Un fil daté passe avant un fil de fraîcheur
 *  inconnue ; deux fils inconnus gardent l'ordre d'arrivée (tri stable), deux fils
 *  datés au même instant sont départagés par `id`. */
export function sortDiscussions(list: Discussion[]): Discussion[] {
  return [...list].sort((a, b) => {
    const am = discussionMillis(a);
    const bm = discussionMillis(b);
    if (am === null && bm === null) return 0; // ordre d'arrivée conservé
    if (am === null) return 1; // un fil daté est plus frais qu'un fil inconnu
    if (bm === null) return -1;
    if (am !== bm) return bm - am;
    return a.id.localeCompare(b.id);
  });
}

export function foldForSearch(value: string): string {
  return subjectKey(value);
}

export function discussionMatches(d: Discussion, query: string): boolean {
  const needle = foldForSearch(query);
  if (!needle) return true;
  return [d.subject, ...d.participants].some((v) => foldForSearch(v).includes(needle));
}

export function searchDiscussions(list: Discussion[], query: string): Discussion[] {
  return sortDiscussions(list.filter((d) => discussionMatches(d, query)));
}

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
  if (count <= 0) return "0 non lu";
  return count > 1 ? `${count} non lus` : "1 non lu";
}

export function conversationCountLabel(count: number): string {
  return count > 1 ? `${count} discussions` : `${count} discussion`;
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

const LONG_DATE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const DATE_TIME = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatLongDate(value: string | number | null | undefined): string {
  const ms = typeof value === "number" ? value : parseInstant(value);
  if (ms === null || !Number.isFinite(ms)) return "";
  try {
    return LONG_DATE.format(new Date(ms));
  } catch {
    return "";
  }
}

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
