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
  const body = text(o["body"], 40_000);
  if (!id || !title || !body) return null;
  const rawSources = Array.isArray(o["sources"]) ? o["sources"] : [];
  const sources = rawSources
    .filter((source): source is string => typeof source === "string")
    .map((source) => text(source, 400))
    .filter(Boolean);
  return {
    id,
    title,
    subject: text(o["subject"], 200),
    date: text(o["date"], 64),
    sources,
    body,
  };
}

export function parseRevisionSheets(raw: unknown): RevisionSheet[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else {
    const o = record(raw);
    if (o) {
      for (const key of ["sheets", "items"]) {
        if (Array.isArray(o[key])) {
          list = o[key] as unknown[];
          break;
        }
      }
    }
  }
  const sheets: RevisionSheet[] = [];
  for (const item of list) {
    const sheet = parseRevisionSheet(item);
    if (sheet) sheets.push(sheet);
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
