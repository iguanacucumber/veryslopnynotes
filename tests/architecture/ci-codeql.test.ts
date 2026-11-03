// CodeQL n'a pas de comportement exécutable dans le dépôt : la couverture des
// langages, les déclencheurs, les permissions et l'épinglage ne se prouvent que
// par le workflow lui-même. Scan de source, même raison que ci-permissions.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const WORKFLOW = readFileSync(join(ROOT, ".github", "workflows", "codeql.yml"), "utf8");
// Les commentaires expliquent le rapport au gate ; ils ne sont pas exécutés.
const BODY = WORKFLOW.split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n");
const CI = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");

const on = /^on:\n([\s\S]*?)(?=\npermissions:)/m.exec(WORKFLOW)?.[1] ?? "";

describe("CI : CodeQL (#899)", () => {
  test("analyse TypeScript et Kotlin/Java", () => {
    expect(WORKFLOW).toMatch(/^ {10}- language: javascript-typescript\n {12}build-mode: none$/m);
    expect(WORKFLOW).toMatch(/^ {10}- language: java-kotlin\n {12}build-mode: manual$/m);
    // Kotlin n'a pas de mode sans build : sans compilation, le job serait vert
    // en n'analysant aucun fichier Kotlin.
    expect(WORKFLOW).toContain(":app:compileDebugKotlin");
    expect(WORKFLOW).toContain("github/codeql-action/analyze@");
  });

  test("tourne sur chaque PR et une fois par semaine, jamais sur push", () => {
    expect(on).toMatch(/^ {2}pull_request:$/m);
    const crons = [...on.matchAll(/^ {4}- cron: "([^"]+)"$/gm)].map((m) => m[1]!);
    expect(crons).toHaveLength(1);
    const fields = crons[0]!.split(/\s+/);
    expect(fields).toHaveLength(5);
    expect(fields[2]).toBe("*");
    expect(fields[3]).toBe("*");
    expect(fields[4]).toMatch(/^[0-7]$/);
    expect(on).not.toMatch(/^ {2}push:/m);
  });

  test("permissions minimales : lecture, plus security-events pour le SARIF", () => {
    expect(WORKFLOW).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(WORKFLOW).toMatch(
      /^ {4}permissions:\n {6}contents: read\n {6}security-events: write$/m,
    );
    // Une seule permission élargie, aucune autre, à aucune profondeur.
    expect([...WORKFLOW.matchAll(/^\s*([\w-]+):\s*write\s*$/gm)].map((m) => m[1])).toEqual([
      "security-events",
    ]);
    expect([...WORKFLOW.matchAll(/^(\s*)permissions:/gm)].map((m) => m[1])).toEqual(["", "    "]);
  });

  test("aucune action tierce n'est un tag mutable", () => {
    const lines = WORKFLOW.split("\n").filter((line) => /^\s+uses:/.test(line));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
    }
    expect(WORKFLOW).not.toMatch(/uses: [^@\s]+@(v\d|main|master)\b/);
  });

  test("aucun secret, aucun checkout qui persiste le jeton", () => {
    expect(WORKFLOW).not.toMatch(/\bsecrets\./);
    expect(WORKFLOW).not.toMatch(/\bgithub\.token\b/);
    const checkouts = WORKFLOW.split(/\n\s*- name:/).filter((step) =>
      step.includes("uses: actions/checkout@"),
    );
    expect(checkouts.length).toBe(1);
    expect(checkouts[0]).toContain("persist-credentials: false");
  });

  test("ne rejoue ni n'affaiblit le gate", () => {
    expect(BODY).not.toContain("make check");
    expect(WORKFLOW).not.toMatch(/^ {2}check:$/m);
    expect(WORKFLOW).not.toContain("continue-on-error");
    expect(CI).toMatch(/^name: gate$/m);
    expect(CI).toContain("make check");
  });
});
