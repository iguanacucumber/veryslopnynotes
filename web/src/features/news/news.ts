// Actualités : payload -> modèle d'affichage. Le contenu est une DONNÉE, jamais
// du HTML : ces fonctions ne produisent que des chaînes rendues en nœuds texte.
import { cleanText, frDateLong } from "../../lib/format";

export const NEWS_MAX_ITEMS = 100;
export const NEWS_MAX_TITLE = 200;
export const NEWS_MAX_BODY = 2000;
export const NEWS_MAX_META = 100;
export const NEWS_BODY_PREVIEW = 280;

export interface NewsItem {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  category: string;
  author: string;
  read: boolean;
}

export interface NewsGroup {
  category: string;
  items: NewsItem[];
}

export const NEWS_CATEGORY_OTHER = "Autres actualités";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? cleanText(value).slice(0, max) : "";
}

function parseItems(payload: string | null): unknown[] {
  if (!payload) return [];
  try {
    const root: unknown = JSON.parse(payload);
    if (!isRecord(root)) return [];
    // `news` = contrat ; `items` = enveloppe du pont factice et des caches anciens.
    if (Array.isArray(root["news"])) return root["news"];
    if (Array.isArray(root["items"])) return root["items"];
    return [];
  } catch {
    return [];
  }
}

export function parseNewsPayload(payload: string | null): NewsItem[] {
  const items: NewsItem[] = [];
  const seen = new Set<string>();
  for (const raw of parseItems(payload)) {
    if (items.length >= NEWS_MAX_ITEMS) break;
    if (!isRecord(raw)) continue;
    const id = text(raw["id"], 120);
    const title = text(raw["title"], NEWS_MAX_TITLE);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    items.push({
      id,
      title,
      body: text(raw["body"], NEWS_MAX_BODY),
      publishedAt: text(raw["publishedAt"], 64),
      category: text(raw["category"], NEWS_MAX_META),
      author: text(raw["author"], NEWS_MAX_META),
      read: raw["read"] === true,
    });
  }
  return items;
}

export function newsCategoryLabel(category: string): string {
  return category.trim() || NEWS_CATEGORY_OTHER;
}

export function newsDateLabel(value: string): string {
  return frDateLong(value);
}

export function newsByline(item: NewsItem): string {
  const date = newsDateLabel(item.publishedAt);
  const author = item.author.trim();
  if (!author) return date;
  return date ? `Par ${author} · ${date}` : `Par ${author}`;
}

/** Groupes par catégorie, du plus récent au plus ancien ; à date égale,
 *  l'identifiant départage pour que deux rendus soient identiques. */
export function newsGroups(items: NewsItem[]): NewsGroup[] {
  const buckets = new Map<string, NewsItem[]>();
  for (const item of items) {
    const key = newsCategoryLabel(item.category);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  return [...buckets.entries()]
    .map(([category, group]) => ({
      category,
      items: [...group].sort((a, b) =>
        a.publishedAt === b.publishedAt
          ? a.id.localeCompare(b.id)
          : a.publishedAt < b.publishedAt
            ? 1
            : -1,
      ),
    }))
    .sort((a, b) => {
      const left = a.items[0]?.publishedAt ?? "";
      const right = b.items[0]?.publishedAt ?? "";
      return left === right ? 0 : left < right ? 1 : -1;
    });
}

export function newsPreview(body: string, max = NEWS_BODY_PREVIEW): string {
  const clean = cleanText(body).replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Corps chargé À LA DEMANDE, au dépliage (un POST par actualité déployée) ;
 *  l'état vit hors du composant. */
export type NewsBodyStatus = "absent" | "loading" | "loaded" | "error";

export interface NewsBodyState {
  status: NewsBodyStatus;
  body: string;
  error: string;
}

/** Message d'échec borné, jamais le message natif. */
export const NEWS_BODY_ERROR = "Contenu indisponible.";

export function newsBodyState(payloadBody: string): NewsBodyState {
  return payloadBody.trim().length > 0
    ? { status: "loaded", body: payloadBody, error: "" }
    : { status: "absent", body: "", error: "" };
}

/** Pendant la demande le statut est « loading » : on ne redemande pas. */
export function needsNewsBody(state: NewsBodyState): boolean {
  return state.status === "absent" || state.status === "error";
}

export function newsBodyLoading(state: NewsBodyState): NewsBodyState {
  return { status: "loading", body: state.body, error: "" };
}

export function newsBodyLoaded(_state: NewsBodyState, body: string): NewsBodyState {
  return { status: "loaded", body, error: "" };
}

export function newsBodyFailed(state: NewsBodyState, message = NEWS_BODY_ERROR): NewsBodyState {
  return { status: "error", body: state.body, error: message };
}

export function newsBodyText(state: NewsBodyState, expanded: boolean): string {
  if (!state.body) return "";
  return expanded || state.body.length <= NEWS_BODY_PREVIEW ? state.body : newsPreview(state.body);
}

export function newsBodyCollapsible(state: NewsBodyState): boolean {
  return state.body.length > NEWS_BODY_PREVIEW;
}
