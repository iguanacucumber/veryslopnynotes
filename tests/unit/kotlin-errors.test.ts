// #732 : le filtre de la frontière `android-compile` — chemins relatifs,
// dédoublonnage par motif, plafond, et surtout AUCUN échec avalé (I5).
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  filterKotlinLog,
  LOG_PATH,
  MAX_LINES,
} from "../../agents/runtime/kotlin-errors";

const ROOT = join(import.meta.dir, "..", "..");
const SCRIPT = join(ROOT, "agents/runtime/kotlin-errors.ts");

/** Une ligne `e:` telle que Gradle la jette sur stdout. */
function e(file: string, line: number, col: number, message: string): string {
  return `e: file://${ROOT}/${file}:${line}:${col} ${message}`;
}

/** Échantillon doré : 3 lignes réelles d'une cascade de visibilité. */
const GOLDEN = [
  e(
    "android/core/src/Lesson.kt",
    42,
    7,
    "Cannot access 'label': it is private in 'Lesson'.",
  ),
  e(
    "android/core/src/Lesson.kt",
    42,
    13,
    "Cannot access 'title': it is private in 'Lesson'.",
  ),
  e("android/core/src/Lesson.kt", 87, 1, "Unresolved reference: Lesson."),
].join("\n");

describe("kotlin-errors : la sortie Gradle réduite à sa cause", () => {
  test("chemins repo-relatifs, dédoublonnage par motif (×N)", () => {
    const out = filterKotlinLog(GOLDEN, 1);
    // Aucun préfixe absolu ne reste (~32 o par ligne économisés).
    expect(out).not.toContain(ROOT);
    // Deux occurrences du même motif (le nom cité varie) : une ligne.
    expect(out).toContain(
      "android/core/src/Lesson.kt:42:7 " +
        "Cannot access 'label': it is private in 'Lesson'. (×2)",
    );
    expect(out).toContain(
      "android/core/src/Lesson.kt:87:1 Unresolved reference: Lesson.",
    );
    expect(out).toContain(`log complet : ${LOG_PATH}`);
  });

  test("plafond : MAX_LINES lignes, le reste est compté", () => {
    const noms = (
      "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu " +
      "nu xi"
    ).split(" ");
    const many = noms
      .map((n, i) =>
        e("android/core/A.kt", i + 1, 1, `Unresolved reference: ${n}.`),
      )
      .join("\n");
    const out = filterKotlinLog(many, 1);
    const shown = out
      .split("\n")
      .filter((l) => l.trimStart().startsWith("android/"));
    expect(shown.length).toBe(MAX_LINES);
    expect(out).toContain(`… reste: ${noms.length - MAX_LINES}`);
  });

  test("succès : rien sur stdout (le gate reste muet)", () => {
    const ok = "> Task :core:compileDebugKotlin\nBUILD SUCCESSFUL in 3s";
    expect(filterKotlinLog(ok, 0)).toBe("");
  });

  test("échec sans e: : un « What went wrong », sans les * Try:", () => {
    const bloc = [
      "FAILURE: Build failed with an exception.",
      "* What went wrong:",
      "Execution failed for task ':core:compileDebugKotlin'.",
      "> Compilation error.",
      "* Try:",
      "> Run with --stacktrace to get the stack trace.",
      "BUILD FAILED in 3s",
    ].join("\n");
    // Repli hors-ligne → en ligne : le bloc arrive DEUX fois.
    const out = filterKotlinLog(`${bloc}\n${bloc}`, 1);
    expect(out).toContain("Execution failed for task");
    expect(out.match(/Execution failed for task/g)?.length).toBe(1);
    expect(out).not.toContain("Try:");
    expect(out).not.toContain("Run with");
    expect(out).toContain(`log complet : ${LOG_PATH}`);
  });

  test("un e: vu avec un code 0 fait ÉCHOUER le build (I5)", () => {
    const dir = mkdtempSync(join(tmpdir(), "vsn-kotlin-errors-"));
    const log = join(dir, "android-compile.log");
    writeFileSync(log, GOLDEN);
    // Gradle rendrait 0 : le filtre refuse de blanchir l'échec.
    expect(Bun.spawnSync(["bun", "run", SCRIPT, log, "0"]).exitCode).toBe(1);
    // Un code Gradle déjà non nul n'est jamais écrasé.
    expect(Bun.spawnSync(["bun", "run", SCRIPT, log, "3"]).exitCode).toBe(3);
  });

  test("la recette android-compile garde le code de sortie", () => {
    const makefile = readFileSync(join(ROOT, "Makefile"), "utf8");
    const start = makefile.indexOf("android-compile:");
    const recipe = makefile.slice(start, makefile.indexOf("\n\n", start));
    expect(recipe).toContain("agents/runtime/kotlin-errors.ts");
    expect(recipe).toContain("gate-logs/android-compile.log");
    expect(recipe).toContain('exit "$$code"');
  });
});
