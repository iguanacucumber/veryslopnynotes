// check.ts — `make check` : les 11 étapes tournent EN MÊME TEMPS, une sortie par étape.
//
// Avant : 7 cibles en séquence = 168 s (unit 70 s + Gradle 95 s + 2 s de tsc).
// Chaque étape est indépendante (lint / typecheck / tests / architecture /
// contrats / garde-fou Kotlin / compilation Gradle / typecheck web / tests web /
// build Vite) : la seule limite est le cœur, et il y en a 16.
//
// SOURCE UNIQUE : chaque étape est une cible du Makefile, invoquée `make -s`,
// donc une recette écrite une fois, jamais dupliquée ici (sinon `make unit`
// finirait par diverger de `make check`). Ce script n'ajoute que le
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
//
// LISTE D'ÉTAPES FIXE. `CHECK_TARGETS` ne la remplace QUE si l'opt-in
// explicite `CHECK_HARNESS=1` est posé (usage interne : `make check-fast`,
// harnais de test). Sans opt-in, la variable est REFUSÉE et signalée : un
// `CHECK_TARGETS=lint` glissé dans l'environnement (shell, CI, `agents/ship.sh`
// qui en hérite) ne peut pas remplacer les 11 étapes par un scan de secrets et
// faire passer le gate en vert (#368).
// `--plan` : affiche le plan résolu et sort SANS lancer les étapes (lecture du
// plan, jamais un gate).
//
// MAKEFLAGS (#523) : chaque étape est un `make` ENFANT, et `make -i` (ou
// `MAKEFLAGS=-i`) fait IGNORER l'échec d'une recette : l'enfant rendrait une
// étape ROUGE verte. Les enfants sont donc lancés SANS `MAKEFLAGS` — les
// seules options sont celles qu'on passe en ligne de commande.
import { join, resolve } from "node:path";

// ponytail: racine en argument pour le test (fixture temporaire), défaut dépôt.
const ROOT = process.argv[2] ? resolve(process.argv[2]) : join(import.meta.dir, "..", "..");

/** Ordre de départ : le plus long d'abord, pour que le dernier fini soit bref.
 *  `web` était une cible unique qui sérialisait typecheck + tests + build
 *  (5,2 s à elle seule) : ses trois composants sont maintenant des étapes. */
export const DEFAULT_TARGETS = [
  "android-compile",
  "unit",
  "typecheck",
  "architecture",
  "contracts",
  "check-kotlin",
  "lint",
  "audit",
  "web-typecheck",
  "web-test",
  "web-build",
];

/** Plan d'étapes : ce qui va RÉELLEMENT tourner. */
export interface Plan {
  /** Étapes à lancer. */
  targets: string[];
  /** `CHECK_TARGETS` demandé mais refusé (opt-in absent) — à signaler. */
  refused: string | null;
}

/** Résolution du plan : l'override n'est honoré qu'avec l'opt-in explicite
 *  `CHECK_HARNESS=1` (usage interne). Sinon la liste par défaut s'impose et
 *  l'override est signalé (#368). */
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

/** Environnement des make ENFANTS : `MAKEFLAGS` NEUTRALISÉ.
 *
 *  `make -i` (ou `MAKEFLAGS=-i`) fait IGNORER l'échec d'une recette : sans
 *  cette neutralisation, une étape ROUGE passait pour verte (#523). On repart
 *  d'un environnement sans options make — les seules options sont celles
 *  qu'on passe en ligne de commande. `MFLAGS` (compat BSD) part avec. */
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
}

// Point d'entrée seulement : le module reste importable (tests) SANS lancer
// les étapes.
if (import.meta.main) await main();
