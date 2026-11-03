import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_TARGETS } from "../../agents/runtime/check";

// `make help` lit les descriptions `##` du Makefile. Ce test est statique : il
// lit le fichier et exécute l'aide, jamais le gate.

const ROOT = join(import.meta.dir, "..", "..");
const MAKEFILE = readFileSync(join(ROOT, "Makefile"), "utf8");

/** Cibles déclarées `.PHONY` : la liste publique que l'aide doit couvrir. */
export function phonyTargets(makefile: string): string[] {
  const line = makefile.split("\n").find((l) => l.startsWith(".PHONY:")) ?? "";
  return line.replace(/^\.PHONY:/, "").trim().split(/\s+/).filter(Boolean);
}

function runHelp(): { code: number; out: string } {
  const p = Bun.spawnSync(["make", "--no-print-directory", "help"], {
    cwd: ROOT,
    env: { ...process.env, MAKEFLAGS: "" },
  });
  return { code: p.exitCode ?? -1, out: `${p.stdout.toString()}${p.stderr.toString()}` };
}

/** Ligne d'aide : deux espaces, la cible paddée à 20, puis la description. */
const HELP_LINE = /^\s{2}([a-zA-Z][\w-]*)\s{2,}(\S.*)$/;

describe("make help", () => {
  const PHONY = phonyTargets(MAKEFILE);

  test("cible .PHONY sans prérequis, hors gate", () => {
    expect(PHONY).toContain("help");
    const line = MAKEFILE.split("\n").find((l) => l.startsWith("help:"))!;
    expect(line.replace(/^help:/, "").replace(/#.*$/, "").trim()).toBe("");
    expect(DEFAULT_TARGETS).not.toContain("help");
  });

  test("liste toutes les cibles .PHONY publiques", () => {
    const { code, out } = runHelp();
    expect(code).toBe(0);
    const listed = new Set(out.split("\n").flatMap((l) => HELP_LINE.exec(l)?.[1] ?? []));
    expect(PHONY.filter((target) => !listed.has(target))).toEqual([]);
  });

  test("une description non vide par cible listée", () => {
    const lines = runHelp()
      .out.split("\n")
      .filter((l) => HELP_LINE.test(l));
    expect(lines).toHaveLength(PHONY.length);
    for (const line of lines) expect(HELP_LINE.exec(line)![2]!.trim()).not.toBe("");
  });
});
