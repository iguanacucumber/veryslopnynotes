// replay-corpus.ts — rejoue le corpus local en JSON attendu.
//
// Le corpus (`tests/fixtures/pronote/<domaine>.json`, gitignoré, données
// d'élève) contient déjà la sortie des readers TS. Ce script la NORMALISE
// (clés triées, `undefined` omis — même forme que `canonTs` du harnais,
// verrouillée par test) ; le test de parité y fait passer les MÊMES octets dans
// le `Json` du port et compare au domaine + champ près.
//
// Lecture seule, aucune valeur hors du corpus. Sans corpus : refus net
// (exit 2), jamais un faux attendu.
//
// Usage : `bun run agents/runtime/replay-corpus.ts [dir-sortie]`
// (défaut : `node_modules/.cache/corpus-expected/`, jamais commité).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CORPUS_DIR } from "./corpus-path";

const ROOT = join(import.meta.dir, "..", "..");
export const EXPECTED_DIR = join(ROOT, "node_modules", ".cache", "corpus-expected");

/**
 * Canonique compact : clés triées, `undefined` omis, tableaux intacts. Même
 * forme que `canonTs` — équivalence verrouillée par test, pas par import (le
 * runtime n'importe jamais depuis `tests/`).
 */
export function compactCanon(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(compactCanon).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${compactCanon(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function replayDomains(dir: string = CORPUS_DIR): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .sort();
}

/**
 * Attendu canonique d'un domaine. Lève si la fixture est absente, illisible ou
 * non marquée `__untrusted` : un corpus à moitié écrit ne produit jamais un
 * attendu partiel silencieux.
 */
export function replayDomain(domain: string, dir: string = CORPUS_DIR): string {
  const file = join(dir, `${domain}.json`);
  if (!existsSync(file)) {
    throw new Error(
      `replay : domaine absent du corpus local (${domain})`,
    );
  }
  const body: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (body === null || typeof body !== "object" || (body as { __untrusted?: unknown }).__untrusted !== true) {
    throw new Error(`replay : ${domain}.json non marqué __untrusted — pas un corpus rejouable`);
  }
  return compactCanon(body);
}

/** Tout le corpus ; lève si vide. */
export function replayCorpus(dir: string = CORPUS_DIR): Record<string, string> {
  const domains = replayDomains(dir);
  if (domains.length === 0) {
    throw new Error(
      `replay : corpus local absent (${dir})`,
    );
  }
  const out: Record<string, string> = {};
  for (const d of domains) out[d] = replayDomain(d, dir);
  return out;
}

/** Vide `<domaine>.expected.json`. `dir` injectable. */
export function writeExpected(corpus: Record<string, string>, dir: string = EXPECTED_DIR): string[] {
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const domain of Object.keys(corpus).sort()) {
    const file = join(dir, `${domain}.expected.json`);
    writeFileSync(file, `${corpus[domain]}\n`);
    written.push(file);
  }
  return written;
}

async function main(): Promise<void> {
  const outDir = process.argv[2] ?? EXPECTED_DIR;
  const corpus = replayCorpus(CORPUS_DIR);
  const files = writeExpected(corpus, outDir);
  process.stdout.write(`${files.length} attendus écrits dans ${outDir} (jamais commités).\n`);
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    process.stderr.write(`replay en échec : ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  });
}
