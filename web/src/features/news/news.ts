// Actualités de l'établissement : payload -> modèle d'affichage.
// Le contenu est une DONNÉE, jamais du HTML : ces fonctions ne produisent que
// des chaînes, et la route les rend dans des nœuds texte React.
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
    // `news` est la forme du contrat / de PronotePayloads.kt ; `items` est
    // l'enveloppe générique du pont factice et des caches anciens.
    if (Array.isArray(root["news"])) return root["news"];
    if (Array.isArray(root["items"])) return root["items"];
    return [];
  } catch {
    return [];
  }
}

/** Lit au plus [NEWS_MAX_ITEMS] entrées, borne chaque champ et ignore une
 *  entrée sans identifiant, sans titre ou en double. */
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

/** Date longue en français (« 16 octobre 2026 »), vide si illisible. */
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

/** Aperçu coupé au mot le plus proche, avec une ellipse explicite. */
export function newsPreview(body: string, max = NEWS_BODY_PREVIEW): string {
  const clean = cleanText(body).replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Corps d'une actualité : absent (à demander), en cours, chargé, en erreur.
 *
 * #475 : la liste ne porte plus le corps — il se charge À LA DEMANDE, au
 * dépliage (un POST par actualité déployee, pas vingt par écran). L'état vit
 * ici, hors du composant : la route n'affiche que des textes.
 */
export type NewsBodyStatus = "absent" | "loading" | "loaded" | "error";

export interface NewsBodyState {
  status: NewsBodyStatus;
  body: string;
  error: string;
}

/** Message d'échec de la demande du corps (borné : jamais le message natif). */
export const NEWS_BODY_ERROR = "Contenu indisponible.";

/** État initial : le corps du payload s'il y en a un, sinon à demander. */
export function newsBodyState(payloadBody: string): NewsBodyState {
  return payloadBody.trim().length > 0
    ? { status: "loaded", body: payloadBody, error: "" }
    : { status: "absent", body: "", error: "" };
}

/**
 * Le corps est-il à demander au natif ? (absent, ou échec à réessayer)
 *
 * Pendant la demande, le statut est « loading » : on ne redemande pas.
 */
export function needsNewsBody(state: NewsBodyState): boolean {
  return state.status === "absent" || state.status === "error";
}

/** Demande en cours. */
export function newsBodyLoading(state: NewsBodyState): NewsBodyState {
  return { status: "loading", body: state.body, error: "" };
}

/** Corps reçu (vide = l'établissement n'a rien publié). */
export function newsBodyLoaded(state: NewsBodyState, body: string): NewsBodyState {
  return { status: "loaded", body, error: "" };
}

/** Échec de la demande : le corps reste absent, l'erreur est dite. */
export function newsBodyFailed(state: NewsBodyState, message = NEWS_BODY_ERROR): NewsBodyState {
  return { status: "error", body: state.body, error: message };
}

/** Le texte affiché : le corps, en entier s'il est déplié, en aperçu sinon. */
export function newsBodyText(state: NewsBodyState, expanded: boolean): string {
  if (!state.body) return "";
  return expanded || state.body.length <= NEWS_BODY_PREVIEW ? state.body : newsPreview(state.body);
}

/** Le corps est-il long (donc repliable) ? */
export function newsBodyCollapsible(state: NewsBodyState): boolean {
  return state.body.length > NEWS_BODY_PREVIEW;
}
