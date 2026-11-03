// Politique anti-flake (#924) : le smoke navigateur attend des ÉVÉNEMENTS
// bornés, la reprise est UNIQUE et réservée au navigateur, et les preuves
// (captures, logs) restent en artefact. Ces scans verrouillent la politique
// pour qu'un sleep fixe ou une reprise du gate ne revienne pas sans diff.
import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const SMOKE = read("agents/runtime/web-smoke.ts");
const CI = read(".github/workflows/ci.yml");
const BUILD = read("docs/architecture/BUILD.md");
const PORTEURS = [
  ...new Glob("tests/**/*.ts").scanSync(ROOT),
  ...new Glob("agents/runtime/*.ts").scanSync(ROOT),
];

/** Lignes d'un job YAML, jusqu'au job suivant (clé à l'indentation 2). */
export function jobBlock(yaml: string, name: string): string {
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^  ${name}:\\s*$`).test(line));
  if (start < 0) return "";
  const end = lines.findIndex((line, i) => i > start && /^  [A-Za-z][\w-]*:\s*$/.test(line));
  return lines.slice(start, end < 0 ? lines.length : end).join("\n");
}

describe("web-smoke — attentes", () => {
  test("aucun sleep fixe ni waitForTimeout", () => {
    expect(SMOKE).not.toMatch(/waitForTimeout\s*\(/);
    // Une seule boucle de sonde, bornée par une échéance explicite.
    const sleeps = [...SMOKE.matchAll(/Bun\.sleep\(([^)]*)\)/g)].map((m) => m[1]!.trim());
    expect(sleeps).toEqual(["INTERVALLE_SONDE_MS"]);
    expect(SMOKE).not.toMatch(/timeout:\s*\d/);
  });

  test("les bornes sont nommées et le serveur a une échéance", () => {
    expect(SMOKE).toMatch(/const DELAI_SERVEUR_MS = \d[\d_]*;/);
    expect(SMOKE).toMatch(/const DELAI_UI_MS = \d[\d_]*;/);
    expect(SMOKE).toMatch(/const echeance = Date\.now\(\) \+ DELAI_SERVEUR_MS;/);
    expect(SMOKE).toMatch(/waitForFunction\(/);
  });

  test("aucun waitForTimeout dans les tests ou les scripts runtime", () => {
    const fautifs = PORTEURS.filter((file) => /waitForTimeout\s*\(/.test(read(file)));
    expect(fautifs).toEqual([]);
  });

  test("un seul lanceur de navigateur", () => {
    const lanceurs = PORTEURS.filter((file) => /chromium\.launch\s*\(/.test(read(file)));
    expect(lanceurs).toEqual(["agents/runtime/web-smoke.ts"]);
  });
});

describe("CI — reprise et artefacts", () => {
  const gate = jobBlock(CI, "check");
  const smoke = jobBlock(CI, "web-smoke");

  test("les deux jobs existent et portent un timeout", () => {
    expect(gate).not.toBe("");
    expect(smoke).not.toBe("");
    expect(gate).toMatch(/timeout-minutes:\s*\d+/);
    expect(smoke).toMatch(/timeout-minutes:\s*\d+/);
  });

  test("seul le smoke est rejoué, une seule fois", () => {
    // Les commentaires citent les commandes : on ne compte que les recettes.
    const recettes = (bloc: string) =>
      bloc
        .split("\n")
        .filter((line) => !/^\s*#/.test(line))
        .join("\n");
    // Premier essai + une reprise : deux invocations, jamais trois.
    expect((recettes(smoke).match(/make web-smoke\b/g) ?? []).length).toBe(2);
    // Le gate garde le verdict du PREMIER essai.
    expect((recettes(gate).match(/make check\b/g) ?? []).length).toBe(1);
    expect(gate).not.toMatch(/(?:retry|reprise)/i);
  });

  test("les artefacts restent disponibles en échec", () => {
    expect(smoke).toMatch(/name: web-smoke-shots/);
    expect(smoke).toMatch(/if: always\(\)/);
    expect(smoke).toMatch(/retention-days:\s*7/);
    expect(gate).toMatch(/name: gate-logs/);
    expect(gate).toMatch(/if: always\(\)/);
  });
});

describe("documentation de la politique", () => {
  test("BUILD.md décrit attentes, reprise unique et artefacts", () => {
    expect(BUILD).toContain("## Politique anti-flake");
    const section = BUILD.slice(BUILD.indexOf("## Politique anti-flake"));
    expect(section).toMatch(/web-smoke/);
    expect(section).toMatch(/UNE\s+reprise/);
    expect(section).toMatch(/AUCUNE/);
    expect(section).toMatch(/artefact/i);
  });
});
