// check.ts — `make check` : les 9 étapes tournent EN MÊME TEMPS.
//
// SOURCE UNIQUE : chaque étape est une cible du Makefile invoquée `make -s`,
// jamais dupliquée ici (sinon `make unit` divergerait de `make check`). Ce
// script n'ajoute que le parallélisme et le résumé (log en mémoire, affiché à
// la fin de l'étape).
//
// Sortie : `✔`/`✘` + durée, dernière ligne utile en succès, FIN du log en
// échec (le fichier complet est écrit et son chemin imprimé). Un log contenant
// « SKIP » est affiché entier même en succès : SKIP BRUYANT, jamais de faux
// vert.
// ponytail: pas de timeout ni de retry (une étape lente n'est pas une étape
// fausse) ni de filtre par étape — `make <cible>` existe déjà.
//
// LISTE D'ÉTAPES FIXE : `CHECK_TARGETS` n'est honoré qu'avec l'opt-in
// `CHECK_HARNESS=1` (usage interne). Sinon il est REFUSÉ et signalé : un
// `CHECK_TARGETS=lint` hérité de l'environnement ne peut pas réduire le gate à
// un scan de secrets.
//
// MAKEFLAGS neutralisé : chaque étape est un `make` ENFANT, et `make -i` fait
// IGNORER l'échec d'une recette — l'enfant rendrait une étape ROUGE verte.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// ponytail: racine en argument pour le test (fixture temporaire), défaut dépôt.
const ROOT = process.argv[2] ? resolve(process.argv[2]) : join(import.meta.dir, "..", "..");

/** Ordre de départ : le plus long d'abord, pour que le dernier fini soit bref.
 *  `web-build` n'est pas une étape : `architecture` le tire dans le Makefile. */
export const DEFAULT_TARGETS = [
  "android-compile",
  "unit",
  "typecheck",
  "architecture",
  "contracts",
  "lint",
  "audit",
  "web-typecheck",
  "web-test",
];

export interface Plan {
  targets: string[];
  refused: string | null;
}

export function resolveTargets(env: Record<string, string | undefined> = process.env): Plan {
  const raw = (env["CHECK_TARGETS"] ?? "").split(" ").filter(Boolean);
  if (raw.length === 0) return { targets: DEFAULT_TARGETS, refused: null };
  if (env["CHECK_HARNESS"] === "1") return { targets: raw, refused: null };
  return { targets: DEFAULT_TARGETS, refused: raw.join(" ") };
}

interface Result {
  target: string;
  code: number;
  ms: number;
  stdout: string;
  stderr: string;
}

/** Environnement des make ENFANTS : `MAKEFLAGS` NEUTRALISÉ, sinon `make -i`
 *  ferait passer une étape ROUGE pour verte. `MFLAGS` (compat BSD) part aussi. */
export function childEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined) out[k] = v;
  delete out["MAKEFLAGS"];
  delete out["MFLAGS"];
  return out;
}

async function run(target: string): Promise<Result> {
  const start = performance.now();
  const p = Bun.spawn(["make", "--no-print-directory", "-s", target], {
    cwd: ROOT,
    env: childEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { target, code, ms: performance.now() - start, stdout, stderr };
}

function lastLine(out: string): string {
  const lines = out.split("\n").map((l) => l.trimEnd()).filter(Boolean);
  return lines.at(-1) ?? "";
}

/** `bun test` écrit SON résumé sur stderr, Gradle et les scripts TS sur
 *  stdout — on lit donc stderr d'abord. */
function summary(r: Result): string {
  const line = lastLine(r.stderr) || lastLine(r.stdout);
  return line ? `   ${line}` : "";
}

function indent(out: string): string {
  return out
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n")
    .replace(/\s+$/, "");
}

/** Lignes d'un log d'échec affichées au terminal (le reste part en fichier) :
 *  la cause est dans la fin. 24 lignes ≈ 400 tokens. */
const FAIL_TAIL_LINES = 24;

const MAX_LOUD_LINES = 12;

/** Log complet hors contexte : le chemin ne sert qu'au cas où. */
function dumpLog(target: string, out: string): string {
  const dir = mkdtempSync(join(tmpdir(), "vsn-check-"));
  const path = join(dir, `${target.replace(/[^\w.-]+/g, "_")}.log`);
  writeFileSync(path, out, { mode: 0o600 });
  return path;
}

function failedLog(target: string, out: string): string {
  const lines = out.replace(/\s+$/, "").split("\n");
  const path = dumpLog(target, out);
  if (lines.length <= FAIL_TAIL_LINES) return indent(lines.join("\n"));
  const hidden = lines.length - FAIL_TAIL_LINES;
  return (
    `    … ${hidden} ligne(s) masquée(s) — log complet : ${path}\n` +
    indent(lines.slice(-FAIL_TAIL_LINES).join("\n"))
  );
}

/** SKIP BRUYANT / REPLI + les 2 lignes suivantes. Casse-SENSIBLE : « 1 skip »
 *  d'un résumé bun n'est pas un saut d'étape. Bloc identique répété N fois
 *  replié en `(×N)`. */
function loudLines(out: string): string[] {
  const lines = out.split("\n");
  const blocks: string[][] = [];
  lines.forEach((l, i) => {
    if (/\b(SKIP|REPLI)\b/.test(l)) blocks.push(lines.slice(i, Math.min(i + 3, lines.length)));
  });
  const kept: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    let n = 1;
    const block = blocks[i]!;
    while (i + 1 < blocks.length && blocks[i + 1]!.join("\n") === block.join("\n")) {
      n++;
      i++;
    }
    const first = n > 1 ? `${block[0]} (×${n})` : block[0]!;
    kept.push(first, ...block.slice(1));
  }
  if (kept.length <= MAX_LOUD_LINES) return kept;
  return [...kept.slice(0, MAX_LOUD_LINES), `… ${kept.length - MAX_LOUD_LINES} ligne(s) de plus (log : make <cible>)`];
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)}s`;
const label = (t: string) => t.padEnd(17, " ");

async function main(): Promise<void> {
  const { targets: TARGETS, refused } = resolveTargets();
  if (refused) {
    console.error(
      `check : CHECK_TARGETS REFUSÉ (« ${refused} ») — opt-in CHECK_HARNESS=1 absent : la liste par défaut s'impose.`,
    );
  }
  if (process.argv.includes("--plan")) {
    console.log(`check : PLAN — ${TARGETS.length} étapes : ${TARGETS.join(" ")}`);
    return;
  }

  console.log(`check : ${TARGETS.length} étapes en parallèle`);
  const started = performance.now();
  const results = await Promise.all(TARGETS.map(run));

  const failed: Result[] = [];
  for (const r of results) {
    const ok = r.code === 0;
    if (!ok) failed.push(r);
    const out = r.stdout + r.stderr;
    console.log(`${ok ? "✔" : "✘"} ${label(r.target)} ${seconds(r.ms)}${ok ? summary(r) : ""}`);
    // Une étape verte ne montre que son résumé, sauf signal de niveau étape
    // (SKIP bruyant, repli offline→online). Une SEULE étape rouge détaille :
    // une régression partagée ferait 5 queues identiques pour la même cause.
    if (!ok) {
      const first = failed.length === 1;
      console.log(first ? failedLog(r.target, out) : `    … détail : make ${r.target}`);
    } else {
      const loud = loudLines(out);
      if (loud.length) console.log(indent(loud.join("\n")));
    }
  }

  const total = seconds(performance.now() - started);
  if (failed.length === 0) {
    console.log(`check : OK en ${total}`);
  } else {
    console.log(`check : ÉCHEC — ${failed.map((f) => f.target).join(", ")} (${total})`);
    process.exitCode = 1;
  }
}

// Module importable par les tests sans lancer les étapes.
if (import.meta.main) await main();
