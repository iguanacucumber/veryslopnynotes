import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  filterTestOutput,
  greenOutput,
} from "../../agents/runtime/test-output";

// `test-output.ts` filtre la sortie de `bun test` : un échec garde sa cause
// (fichier:ligne, `error:`, premier hunk) et jette le reste.
const ROOT = join(import.meta.dir, "..", "..");
const FIXTURES = join(import.meta.dir, "fixtures");
const SCRIPT = join(ROOT, "agents", "runtime", "test-output.ts");
const LOGS = join(ROOT, "node_modules", ".cache", "gate-logs");

/** Sortie combinée d'un run du script (même ordre que check.ts). */
function drive(target: string, file: string): { code: number; shown: string } {
  const p = Bun.spawnSync(["bun", SCRIPT, target, file], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = new TextDecoder();
  return {
    code: p.exitCode ?? -1,
    shown: text.decode(p.stdout) + text.decode(p.stderr),
  };
}

describe("filtre d'un échec bun test", () => {
  const raw = readFileSync(
    join(FIXTURES, "test-output-bun-1.4.4-gros-diff.txt"),
    "utf8",
  );
  const out = filterTestOutput(raw);

  test("garde fichier:ligne, la première erreur et le PREMIER hunk", () => {
    expect(out).toContain("gros-diff.test.ts:4:18");
    expect(out).toContain("error: expect(received).toEqual(expected)");
    expect(out).toContain("@@ -4,3 +4,3 @@");
  });

  test("jette l'extrait numéroté et les hunks suivants", () => {
    expect(out).not.toContain("| import { expect, test } from");
    expect(out).not.toContain("@@ -9,3 +9,3 @@");
    expect(out).not.toContain("eleve-399");
  });

  test("2 000+ lignes de diff tiennent sous 800 octets", () => {
    expect(raw.split("\n").length).toBeGreaterThan(2_000);
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(800);
  });
});

describe("filtre d'un succès bun test", () => {
  const raw = readFileSync(
    join(FIXTURES, "test-output-bun-1.4.4-succes-skip.txt"),
    "utf8",
  );

  test("un résumé, plus les lignes SKIP BRUYANT intactes", () => {
    const out = greenOutput(raw);
    expect(out).toContain("SKIP BRUYANT");
    expect(out.split("\n").at(-1)).toStartWith("Ran 1 test across 1 file.");
  });
});

describe("script : le code de sortie de bun n'est jamais réécrit", () => {
  test("échec → code 1, log complet écrit, sortie bornée", () => {
    const dir = mkdtempSync(join(tmpdir(), "vsn-test-output-"));
    const file = join(dir, "sonde.test.ts");
    const eleves = "Array.from({ length: 40 }, (_, i) => ({ id: i }))";
    writeFileSync(
      file,
      `import { expect, test } from "bun:test";\n` +
        `test("sonde", () => { expect(${eleves}).toEqual([]); });\n`,
    );
    const { code, shown } = drive("sonde-test-output", file);
    expect(code).toBe(1);
    expect(shown.length).toBeLessThan(2_000);
    // Le log garde ce que la sortie jette : la preuve que rien n'est perdu.
    const log = join(LOGS, "sonde-test-output.log");
    expect(existsSync(log)).toBe(true);
    expect(readFileSync(log, "utf8")).toContain("| import { expect, test }");
  });

  test("au-delà de 10 échecs, seule la ligne `… reste: N` parle", () => {
    const dir = mkdtempSync(join(tmpdir(), "vsn-test-output-"));
    const file = join(dir, "serie.test.ts");
    const tests = Array.from(
      { length: 12 },
      (_, i) => `test("t${i}", () => { expect(${i}).toBe(-1); });`,
    );
    writeFileSync(
      file,
      `import { expect, test } from "bun:test";\n${tests.join("\n")}\n`,
    );
    const { code, shown } = drive("sonde-serie", file);
    expect(code).toBe(1);
    expect(shown.match(/\(fail\)/g)?.length).toBe(10);
    expect(shown).toContain("… reste: 2");
  });
});
