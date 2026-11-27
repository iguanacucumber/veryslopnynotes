import { payloadRoot, type DiscussionMessage } from "./message-parse";

/** Taille de page du fil (miroir du pager natif) : « charger plus ancien » par 50. */
export const MESSAGE_WINDOW = 50;

/** Nombre entier borné à `[0, max]` ; une valeur non finie ne rend rien. */
function boundedCount(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.floor(value), 0), Math.max(max, 0));
}

/** Derniers `shown` messages, ordre conservé. Le fil n'est jamais rendu en
 *  entier : le pont peut en livrer des milliers. */
export function visibleMessages<T>(messages: readonly T[], shown: number): T[] {
  const count = boundedCount(shown, messages.length);
  return messages.slice(messages.length - count);
}

/** Total du fil annoncé par le pont ; absent (vieux pont) = longueur reçue. */
export function threadPageTotal(payload: string | null, received: number): number {
  const root = payloadRoot(payload);
  const raw = root?.["total"];
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0
    ? Math.floor(raw)
    : received;
}

/** Début de la page reçue ; absent = 0 (le pont n'a pas paginé). */
export function threadPageStart(payload: string | null): number {
  const root = payloadRoot(payload);
  const raw = root?.["start"];
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;
}

/** Page plus ancienne préfixée, dédupliquée par id, ordre conservé. */
export function mergeOlderMessages(
  older: readonly DiscussionMessage[],
  current: readonly DiscussionMessage[],
): DiscussionMessage[] {
  const seen = new Set(current.map((m) => m.id));
  const prefix = older.filter((m) => !seen.has(m.id));
  return [...prefix, ...current];
}

/** Nombre restant à charger : jamais négatif. */
export function remainingMessages(total: number, loaded: number): number {
  return Math.max(0, boundedCount(total, Number.MAX_SAFE_INTEGER) - boundedCount(loaded, Number.MAX_SAFE_INTEGER));
}

/** Fenêtre suivante : un pas de plus, sans dépasser le fil. */
export function nextMessageWindow(shown: number, total: number): number {
  const boundedTotal = boundedCount(total, Number.MAX_SAFE_INTEGER);
  const current = boundedCount(shown, boundedTotal);
  return Math.min(boundedTotal, current + MESSAGE_WINDOW);
}
