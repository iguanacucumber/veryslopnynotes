// Logique pure de l'écran Fiches de révision, portée de `RevisionSheets.kt` et
// `RevisionSheet.kt`. Le store local rend un tableau de fiches ; le pont peut
// aussi envelopper la liste (`{sheets: []}` ou `{items: []}`). Une fiche non
// conforme est ignorée, jamais affichée à moitié.
import { cleanText, frDate, parseDate } from "../../lib/format";

export interface RevisionSheet {
  id: string;
  title: string;
  subject: string;
  date: string;
  sources: string[];
  body: string;
}

export const SHEETS_MAX_ITEMS = 200;
export const SHEETS_MAX_SCAN = 200;
export const SHEET_MAX_SOURCES = 20;
export const SHEET_MAX_BODY = 20_000;
const SHEET_MAX_SOURCE_CHARS = 400;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, max: number): string {
  return cleanText(value).slice(0, max);
}

/** Fiche affichable : `id` et `title` et `body` sont le minimum lisible. Les
 *  champs de contrat absents du pont (`examId`, `templateVersion`, `createdAt`)
 *  ne bloquent pas l'affichage. */
export function parseRevisionSheet(raw: unknown): RevisionSheet | null {
  const o = record(raw);
  if (!o) return null;
  const id = text(o["id"], 200);
  const title = text(o["title"], 400);
  const body = text(o["body"], SHEET_MAX_BODY);
  if (!id || !title || !body) return null;
  const rawSources = Array.isArray(o["sources"]) ? o["sources"] : [];
  const sources: string[] = [];
  for (const source of rawSources.slice(0, SHEET_MAX_SOURCES)) {
    if (typeof source !== "string") continue;
    const value = text(source, SHEET_MAX_SOURCE_CHARS);
    if (value && !sources.includes(value)) sources.push(value);
  }
  return {
    id,
    title,
    subject: text(o["subject"], 200),
    date: text(o["date"], 64),
    sources,
    body,
  };
}

function listOf(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  // Le pont peut sérialiser l'enveloppe en JSON : `"{"sheets":[]}"`.
  if (typeof raw === "string") {
    try {
      return listOf(JSON.parse(raw) as unknown);
    } catch {
      return [];
    }
  }
  const o = record(raw);
  if (!o) return [];
  for (const key of ["sheets", "items"]) {
    if (Array.isArray(o[key])) return o[key] as unknown[];
  }
  return [];
}

export function parseRevisionSheets(raw: unknown): RevisionSheet[] {
  const list = listOf(raw);
  const sheets: RevisionSheet[] = [];
  const seen = new Set<string>();
  const scan = Math.min(list.length, SHEETS_MAX_SCAN);
  for (let index = 0; index < scan && sheets.length < SHEETS_MAX_ITEMS; index++) {
    const sheet = parseRevisionSheet(list[index]);
    if (!sheet || seen.has(sheet.id)) continue;
    seen.add(sheet.id);
    sheets.push(sheet);
  }
  return sheets.sort((a, b) => {
    const left = parseDate(a.date)?.getTime() ?? 0;
    const right = parseDate(b.date)?.getTime() ?? 0;
    return right - left;
  });
}

/** « lundi 18 octobre » ; vide si la date manque ou est illisible. */
export function revisionDateLabel(sheet: RevisionSheet): string {
  return parseDate(sheet.date) ? frDate(sheet.date) : "";
}
