// Lecteurs des payloads de l'accueil et de l'EDT : aucun réseau, aucun HTML
// construit ici ; un payload est une DONNÉE. Les clés du contrat (`entries`,
// `assignments`, `grades`, `alerts`, `capabilities`) ou l'enveloppe `items` du
// pont factice sont acceptées, jamais devinées champ par champ.
import { asNumber, cleanText, parseInstant } from "../../lib/format";

/** Borne dure d'une liste lue dans un payload (anti-JSON géant). */
export const MAX_ITEMS = 400;

export const MAX_TEXT = 200;

export type Obj = Record<string, unknown>;

export function asObject(value: unknown): Obj | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Obj)
    : null;
}

/** Texte borné en points de code, caractères de contrôle retirés. */
export function boundedText(value: unknown, max = MAX_TEXT): string {
  const text = cleanText(value);
  if (!text) return "";
  const points = Array.from(text);
  return (points.length <= max ? points : points.slice(0, max)).join("");
}

/** Entier positif borné (les payloads peuvent publier des flottants). */
export function boundedLimit(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(Math.trunc(value), MAX_ITEMS));
}

export function payloadRoot(payload: string | null): Obj | null {
  if (!payload || payload.length > 2_000_000) return null;
  try {
    return asObject(JSON.parse(payload) as unknown);
  } catch {
    return null;
  }
}

/** Clé de contrat, sinon l'enveloppe `items` du pont factice ; absente = liste
 *  vide, jamais une ligne inventée. */
export function rowsOf(root: Obj, key: string, max = MAX_ITEMS): unknown[] {
  const direct = root[key];
  const items = Array.isArray(root["items"]) ? root["items"] : null;
  const rows = Array.isArray(direct) ? direct : items;
  return rows ? rows.slice(0, max) : [];
}

/** ISO-8601 (ou date seule) -> millis ; illisible = null, jamais `NaN`. Une
 *  date seule est minuit local (analyseur partagé) : elle ne glisse pas d'un
 *  jour à l'ouest de Greenwich. */
export function millisOf(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > 64) return null;
  if (
    !/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(
      text,
    )
  ) {
    return null;
  }
  return parseInstant(text);
}

export function numberOrNull(value: unknown): number | null {
  const n = asNumber(value, Number.NaN);
  return Number.isFinite(n) ? n : null;
}

export function optionalText(value: unknown): string | null {
  const text = boundedText(value, 100);
  return text || null;
}
