/** L'échec imprime un extrait court, jamais le fichier entier (200 Ko) : le
 *  message porte le fichier, le motif et 6 lignes de contexte. */
import { readFileSync } from "node:fs";

const CONTEXT = 3;

/** Extrait autour de la 1re occurrence de `needle`, ou les 6 premières lignes. */
function excerpt(source: string, needle: string): string {
  const lines = source.split("\n");
  const idx = lines.findIndex((l) => l.includes(needle));
  const start = idx === -1 ? 0 : Math.max(0, idx - CONTEXT);
  const end = Math.min(lines.length, idx === -1 ? CONTEXT * 2 : idx + CONTEXT + 1);
  return lines.slice(start, end).join("\n");
}

/** Extrait autour de la 1re correspondance de `re`. */
function excerptRe(source: string, re: RegExp): string {
  const lines = source.split("\n");
  const idx = lines.findIndex((l) => re.test(l));
  const start = idx === -1 ? 0 : Math.max(0, idx - CONTEXT);
  const end = Math.min(lines.length, idx === -1 ? CONTEXT * 2 : idx + CONTEXT + 1);
  return lines.slice(start, end).join("\n");
}

export function expectSourceContains(source: string, needle: string, file: string): void {
  if (!source.includes(needle)) {
    throw new Error(
      [
        `✘ ${file}`,
        `  attendu : présence de ${JSON.stringify(needle)}`,
        `  extrait (6 lignes) :`,
        excerpt(source, needle),
        "",
      ].join("\n"),
    );
  }
}

export function expectSourceMatch(source: string, re: RegExp, file: string): void {
  if (!re.test(source)) {
    throw new Error(
      [
        `✘ ${file}`,
        `  attendu : correspondance de ${re}`,
        `  extrait (6 lignes) :`,
        excerptRe(source, re),
        "",
      ].join("\n"),
    );
  }
}

export function expectSourceNotMatch(source: string, re: RegExp, file: string): void {
  if (re.test(source)) {
    throw new Error(
      [
        `✘ ${file}`,
        `  interdit : correspondance de ${re}`,
        `  extrait (6 lignes) :`,
        excerptRe(source, re),
        "",
      ].join("\n"),
    );
  }
}

export function expectFileContains(file: string, needle: string): void {
  const source = readFileSync(file, "utf8");
  expectSourceContains(source, needle, file);
}

export function expectFileMatch(file: string, re: RegExp): void {
  const source = readFileSync(file, "utf8");
  expectSourceMatch(source, re, file);
}

export function expectCodeContains(file: string, needle: string): void {
  const source = readFileSync(file, "utf8");
  expectSourceContains(source, needle, `${file} (code)`);
}
