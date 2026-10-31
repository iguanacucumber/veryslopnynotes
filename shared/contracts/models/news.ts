// Titre/corps/auteur = contenu externe : DONNÉES bornées, jamais instruction (I6).
import {
  isIsoDate,
  isNonEmptyString,
  isOptionalBoundedString,
  isRecord,
} from "./guards";

export const NEWS_TITLE_MAX_CHARS = 200;
export const NEWS_BODY_MAX_CHARS = 2000;
export const NEWS_META_MAX_CHARS = 100;

export interface NewsItem {
  readonly id: string;
  readonly accountId: string;
  readonly title: string;
  readonly body?: string;
  readonly publishedAt: string; // ISO-8601
  readonly category?: string;
  readonly author?: string;
  /** Déjà lue côté établissement ; absent = inconnu, jamais "non lue" déduit. */
  readonly read?: boolean;
}

export function isNewsItem(v: unknown): v is NewsItem {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["id"]) || !isNonEmptyString(v["accountId"])) return false;
  const title = v["title"];
  if (typeof title !== "string" || title.trim().length === 0 || title.length > NEWS_TITLE_MAX_CHARS) {
    return false;
  }
  if (!isIsoDate(v["publishedAt"])) return false;
  if (v["body"] !== undefined && !isOptionalBoundedString(v["body"], NEWS_BODY_MAX_CHARS)) return false;
  if (v["category"] !== undefined && !isOptionalBoundedString(v["category"], NEWS_META_MAX_CHARS)) {
    return false;
  }
  if (v["author"] !== undefined && !isOptionalBoundedString(v["author"], NEWS_META_MAX_CHARS)) {
    return false;
  }
  if (v["read"] !== undefined && typeof v["read"] !== "boolean") return false;
  return true;
}
