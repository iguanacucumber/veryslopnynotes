/** Assertions de scan de source : l'échec imprime un extrait court, jamais
 * le fichier entier. Chaque échec tient en quelques lignes pour ne pas noyer
 * le signal dans le `Received:` d'un source de 200 Ko.
 *
 * Le message d'erreur porte : le fichier vérifié, le motif attendu, et un
 * extrait de 6 lignes autour de la première occurrence (ou du début si
 * absente). Bun affiche ce message sans vider le source complet.
 *
 * Les deux fonctions lancent une `Error` ; le caller l'enveloppe dans
 * `expect(() => ...).toThrow(...)` ou laisse bun l'afficher directement.
 * Elles ne modifient pas la sémantique de l'assertion : présence de sous-chaîne
 * ou correspondance de regex, exactement comme `toContain` / `toMatch`.
 */
import { readFileSync } from "node:fs";

const CONTEXT = 3; // lignes avant + après la ligne ciblée

/** Extrait de 6 lignes autour de la première occurrence de `needle` dans
 *  `source`, ou les 6 premières lignes si absente. */
function excerpt(source: string, needle: string): string {
  const lines = source.split("\n");
  const idx = lines.findIndex((l) => l.includes(needle));
  const start = idx === -1 ? 0 : Math.max(0, idx - CONTEXT);
  const end = Math.min(lines.length, idx === -1 ? CONTEXT * 2 : idx + CONTEXT + 1);
  return lines.slice(start, end).join("\n");
}

/** Extrait de 6 lignes autour de la première correspondance de `re`. */
function excerptRe(source: string, re: RegExp): string {
  const lines = source.split("\n");
  const idx = lines.findIndex((l) => re.test(l));
  const start = idx === -1 ? 0 : Math.max(0, idx - CONTEXT);
  const end = Math.min(lines.length, idx === -1 ? CONTEXT * 2 : idx + CONTEXT + 1);
  return lines.slice(start, end).join("\n");
}

/** Le source manque `needle`. Lève une `Error` avec un message court. */
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

/** Le source ne correspond pas à `re`. Lève une `Error` avec un message court. */
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

/** Le source correspond à `re` alors qu'il ne devrait pas. Lève une `Error`
 *  avec un message court. */
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

/** Lit `file` et vérifie qu'il contient `needle` (extraits courts en cas
 * d'échec). Équivalent de `expect(readFileSync(file)).toContain(needle)` sans
 * le dump complet. */
export function expectFileContains(file: string, needle: string): void {
  const source = readFileSync(file, "utf8");
  expectSourceContains(source, needle, file);
}

/** Lit `file` et vérifie qu'il correspond à `re` (extraits courts en cas
 * d'échec). Équivalent de `expect(readFileSync(file)).toMatch(re)` sans le
 * dump complet. */
export function expectFileMatch(file: string, re: RegExp): void {
  const source = readFileSync(file, "utf8");
  expectSourceMatch(source, re, file);
}

/** Lit `file`, retire les commentaires, et vérifie qu'il contient `needle`. */
export function expectCodeContains(file: string, needle: string): void {
  const source = readFileSync(file, "utf8");
  expectSourceContains(source, needle, `${file} (code)`);
}
