// Filtre de la sortie Gradle à la frontière `android-compile`.
//
// Mesure : une cascade de visibilité produit 1 074 lignes
// `e: file:///home/…:l:c message` (190 740 o, dont ~32 o de préfixe
// absolu par ligne), plus 500–600 o de passe-partout Gradle par tâche,
// répété par module et DEUX FOIS quand le build hors-ligne tombe en repli.
//
// Ce filtre ne change NI le code de sortie NI la sémantique du gate (I5) :
// une erreur Kotlin vue ici fait TOUJOURS échouer le build, même si Gradle
// a rendu 0. Le journal entier reste dans le fichier fixe ci-dessous.
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Racine du dépôt : un chemin absolu en est réécrit en relatif. */
const ROOT = join(import.meta.dir, "..", "..");

/** Journal complet, hors contexte : le filtre n'en montre que la cause. */
export const LOG_PATH = "node_modules/.cache/gate-logs/android-compile.log";

/** Plafond de lignes d'erreur affichées (le reste est compté). */
export const MAX_LINES = 10;

/** Une erreur Kotlin extraite d'une ligne `e:`. */
export interface KotlinError {
  /** Chemin relatif au dépôt (absolu conservé s'il sort du dépôt). */
  file: string;
  line: number;
  column: number;
  message: string;
}

// `e: file:///…/Foo.kt:12:3 message` — le préfixe `file://` est optionnel.
const E_LINE = /^e:\s+(?:file:\/\/)?(.+?):(\d+):(\d+)\s+(.*)$/;

/** Réécrit un chemin absolu du dépôt en chemin relatif. */
function repoRelative(path: string): string {
  const prefix = ROOT.endsWith("/") ? ROOT : `${ROOT}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/** Extrait les lignes `e:` du journal, dans l'ordre. */
export function parseKotlinErrors(text: string): KotlinError[] {
  const errors: KotlinError[] = [];
  for (const raw of text.split("\n")) {
    const m = E_LINE.exec(raw.replace(/\r$/, ""));
    if (!m) continue;
    errors.push({
      file: repoRelative(m[1]!),
      line: Number(m[2]),
      column: Number(m[3]),
      message: m[4]!.trim(),
    });
  }
  return errors;
}

/** Motif d'un message : noms cités et nombres masqués.
 *
 *  Dans une cascade, seule l'occurrence change (`'a'`, `'b'`, ligne 12, 40) :
 *  c'est le MOTIF qui identifie l'erreur, l'occurrence n'apporte rien. */
function motif(message: string): string {
  return message
    .replace(/`[^`]*`|'[^']*'|"[^"]*"/g, "…")
    .replace(/\d+/g, "N");
}

/** Lignes d'erreur : dédoublonnées par (fichier, motif), plafonnées. */
function formatErrors(errors: KotlinError[], max: number): string[] {
  const groups = new Map<string, { first: KotlinError; n: number }>();
  for (const e of errors) {
    const key = `${e.file}:${motif(e.message)}`;
    const group = groups.get(key);
    if (group) group.n++;
    else groups.set(key, { first: e, n: 1 });
  }
  const shown = [...groups.values()].slice(0, max);
  const lines = shown.map(({ first, n }) => {
    const at = `${first.file}:${first.line}:${first.column}`;
    return `${at} ${first.message}${n > 1 ? ` (×${n})` : ""}`;
  });
  const rest = groups.size - shown.length;
  if (rest > 0) lines.push(`… reste: ${rest}`);
  return lines;
}

/** Repli hors-ligne → en ligne : Gradle répète le MÊME bloc « What went
 *  wrong » (une fois par invocation). On n'en garde qu'un, sans la section
 *  `* Try:` qui dit comment relancer, pas ce qui a cassé. */
function gradleFailure(text: string, max: number): string[] {
  const blocks = text.split(/^\* What went wrong:\s*$/m);
  const body = blocks.length > 1 ? blocks[1]! : text;
  const lines: string[] = [];
  let trySection = false;
  for (const raw of body.split("\n")) {
    const line = raw.replace(/\r$/, "").trimEnd();
    // `* Try:` (et `* Get more help`) et leurs continuations
    // (`> Run with --stacktrace`, `> Get more help…`) forment UNE section :
    // elle s'arrête au `* ` suivant.
    if (/^\* (Try:|Get more help)/.test(line)) {
      trySection = true;
      continue;
    }
    if (trySection && /^\* /.test(line)) trySection = false;
    if (trySection) continue;
    // Fin d'invocation : le repli en ligne rejoue tout, on le coupe ici.
    if (/^(FAILURE:|BUILD FAILED|\* Exception is:)/.test(line)) break;
    if (line !== "") lines.push(line);
  }
  const tail = lines.slice(-max);
  const rest = lines.length - tail.length;
  return rest > 0 ? [`… ${rest} ligne(s) avant`, ...tail] : tail;
}

/** Vue filtrée du journal. Vide quand tout va bien : le gate reste muet. */
export function filterKotlinLog(
  text: string,
  code: number,
  max = MAX_LINES,
): string {
  const errors = parseKotlinErrors(text);
  if (errors.length > 0) {
    return [
      `android-compile : ${errors.length} ligne(s) e:`,
      ...formatErrors(errors, max).map((l) => `  ${l}`),
      `log complet : ${LOG_PATH}`,
    ].join("\n");
  }
  if (code === 0) return "";
  return [
    `android-compile : ÉCHEC (code ${code}), aucune erreur Kotlin`,
    ...gradleFailure(text, max).map((l) => `  ${l}`),
    `log complet : ${LOG_PATH}`,
  ].join("\n");
}

// Point d'entrée seulement : le module reste importable (tests) sans lire
// de journal. `-` (ou rien) lit stdin, pour rejouer une capture.
if (import.meta.main) {
  const [file, rawCode] = process.argv.slice(2);
  const declared = Number.parseInt(rawCode ?? "0", 10) || 0;
  const text =
    !file || file === "-"
      ? readFileSync(0, "utf8")
      : readFileSync(file, "utf8");
  const errors = parseKotlinErrors(text);
  const out = filterKotlinLog(text, declared);
  if (out) process.stdout.write(`${out}\n`);
  // Un `e:` vu avec un code 0 = le filtre ne doit pas blanchir l'échec (I5).
  process.exitCode = declared !== 0 ? declared : errors.length > 0 ? 1 : 0;
}
