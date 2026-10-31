// Logique pure des fiches de révision. Le store rend un tableau ; le pont peut
// envelopper la liste (`{sheets}`, `{items}`). Une fiche non conforme est
// ignorée, jamais affichée à moitié.
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

/** `id`, `title` et `body` sont le minimum lisible ; les champs de contrat
 *  absents du pont (`examId`, `createdAt`…) ne bloquent pas l'affichage. */
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

export function revisionDateLabel(sheet: RevisionSheet): string {
  return frDate(sheet.date);
}

/** En-tête du bloc canonique que le corps assemblé porte en fin de texte. */
const CANONICAL_SOURCES_HEADING = /^\s*sources\s*:\s*$/i;
const CANONICAL_SOURCE_ENTRY = /^\s*-\s+\S/;

/** Bloc « Sources : » final du corps, s'il y en a un. */
function canonicalSourcesSplit(body: string): { content: string; found: boolean } {
  const lines = body.split(/\r\n?|\n/);
  for (let index = lines.length - 1; index >= 0; index--) {
    if (!CANONICAL_SOURCES_HEADING.test(lines[index] ?? "")) continue;
    const tail = lines.slice(index + 1).filter((line) => line.trim() !== "");
    if (tail.length === 0 || !tail.every((line) => CANONICAL_SOURCE_ENTRY.test(line))) continue;
    return { content: lines.slice(0, index).join("\n").trimEnd(), found: true };
  }
  return { content: body.trimEnd(), found: false };
}

/** Corps sans son bloc « Sources : » : l'aperçu ne montre pas la bibliographie. */
export function bodyWithoutSources(body: string): string {
  return canonicalSourcesSplit(body).content;
}

/** Le corps porte-t-il déjà la liste des sources ? Elle n'est alors rendue
 *  qu'UNE fois : le markdown du corps la contient (I15, liste canonique). */
export function bodyCarriesSources(body: string): boolean {
  return canonicalSourcesSplit(body).found;
}
