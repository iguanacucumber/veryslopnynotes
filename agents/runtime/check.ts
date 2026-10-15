// check.ts — `make check` : les 7 étapes tournent EN MÊME TEMPS, une sortie par étape.
//
// Avant : 7 cibles en séquence = 168 s (unit 70 s + Gradle 95 s + 2 s de tsc).
// Chaque étape est indépendante (lint / typecheck / tests / architecture /
// contrats / garde-fou Kotlin / compilation Gradle) : la seule limite est le
// cœur, et il y en a 16.
//
// SOURCE UNIQUE : chaque étape est une cible du Makefile, invoquée `make -s`,
// donc une recette écrite une fois, jamais dupliquée ici (sinon `make unit`
// finirait par divergier de `make check`). Ce script n'ajoute que le
// PARALLÉLISME + le RAPOINTI (log mémoire par étape, affiché à la fin de
// l'étape : l'intercalage de 68 lignes Gradle au milieu des tests ne se lit
// pas).
//
// Sortie : `✔`/`✘` + durée par étape, la dernière ligne utile en succès, le
// log COMPLET en échec. Un log contenant « SKIP » est affiché entier même en
// succès : la règle du repo est le SKIP BRUYANT, jamais un faux vert (même
// philosophie que `make android-compile` sans JDK/SDK).
// ponytail: pas de timeout ni de retry (une étape lente n'est pas une étape
// fausse) ni de filtre par étape — `make <cible>` existe déjà pour ça.
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

/** Ordre de départ : le plus long d'abord, pour que le dernier fini soit bref. */
const DEFAULT_TARGETS = ["android-compile", "unit", "typecheck", "architecture", "contracts", "check-kotlin", "lint"];
// Surchargeable pour tester le harnais lui-même (même piège volontaire que
// ANDROID_PROJECT_DIR dans android-env.sh) : `CHECK_TARGETS="lint nope"`.
const override = process.env["CHECK_TARGETS"]?.split(" ").filter(Boolean) ?? [];
const TARGETS = override.length > 0 ? override : DEFAULT_TARGETS;

interface Result {
  target: string;
  code: number;
  ms: number;
  stdout: string;
  stderr: string;
}

async function run(target: string): Promise<Result> {
  const start = performance.now();
  const p = Bun.spawn(["make", "--no-print-directory", "-s", target], {
    cwd: ROOT,
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

/** Dernière ligne non vide d'un flux. */
function lastLine(out: string): string {
  const lines = out.split("\n").map((l) => l.trimEnd()).filter(Boolean);
  return lines.at(-1) ?? "";
}

/** Résumé d'une étape verte : `bun test` écrit SON résumé sur stderr, Gradle
 *  et les scripts TS sur stdout — on lit donc stderr d'abord. */
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

/** SKIP BRUYANT / REPLI + les 2 lignes suivantes (le message tient en 3 lignes).
 *  Afficher le log entier à chaque run parce que le corpus Pronote saute ferait
 *  du bruit de fond, pas du signal : c'est le saut qui doit se voir, pas tout le
 *  reste. Casse-SENSIBLE : « 1 skip » d'un résumé bun n'est pas un saut d'étape. */
function loudLines(out: string): string[] {
  const lines = out.split("\n");
  const keep = new Set<number>();
  lines.forEach((l, i) => {
    if (/\b(SKIP|REPLI)\b/.test(l)) for (let j = i; j <= Math.min(i + 2, lines.length - 1); j++) keep.add(j);
  });
  return [...keep].sort((a, b) => a - b).map((i) => lines[i]!);
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)}s`;
const label = (t: string) => t.padEnd(17, " ");

console.log(`check : ${TARGETS.length} étapes en parallèle`);
const started = performance.now();
const results = await Promise.all(TARGETS.map(run));

const failed: Result[] = [];
for (const r of results) {
  const ok = r.code === 0;
  if (!ok) failed.push(r);
  const out = r.stdout + r.stderr;
  console.log(`${ok ? "✔" : "✘"} ${label(r.target)} ${seconds(r.ms)}${ok ? summary(r) : ""}`);
  // Une étape verte ne montre que son résumé SAUF signal de niveau étape :
  // SKIP bruyant (jamais de faux vert) ou repli offline→online. En échec, le
  // log complet : c'est là qu'on lit, et il n'y a rien à filtrer.
  if (!ok) console.log(indent(out));
  else {
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
