// #827 : la voie de relicence est une preuve documentaire. Ce test vérifie les
// sections, les faits cités et les liens — pas l'opinion juridique, qui reste
// suivie par #976.
import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const FILE = "docs/legal/RELICENSING.md";
const TEXT = readFileSync(join(ROOT, FILE), "utf8");
const ADR = "docs/adr/008-relicense-gpl.md";
const ADR_TEXT = readFileSync(join(ROOT, ADR), "utf8");

const SECTIONS = [
  "## Décision en une ligne",
  "## Pourquoi MIT permet la relicence",
  "### Avis MIT conservé",
  "## Ayants droit et contributeurs (preuve Git)",
  "## Politique de contribution : inbound = outbound et DCO",
  "## Origine Papillon et inventaire #838",
  "## Fait d'ingénierie, pas avis juridique",
  "## Vérification",
];

const FACTS = [
  "GPL-3.0-only",
  "2def868",
  "aa47c0e",
  "sublicense",
  "Copyright (c) 2026 veryslopnynotes contributors",
  "THE SOFTWARE IS PROVIDED",
  "inbound = outbound",
  "Signed-off-by",
  "IguanaCucumber",
  "Brassdelere",
  "docs/legal/PROVENANCE.md",
  "#838",
  "SIGNOFF.md",
  "#976",
  "ADR-008",
];

/** Liens relatifs du document, résolus depuis son dossier. */
function brokenLinks(): string[] {
  return [...TEXT.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((m) => decodeURIComponent(m[1]!.split("#")[0]!))
    .filter((target) => !/^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(target))
    .filter((target) => target.length > 0)
    .filter((target) => {
      try {
        statSync(join(ROOT, dirname(FILE), target));
        return false;
      } catch {
        return true;
      }
    });
}

describe("dossier de relicence (#827)", () => {
  test("le fichier porte les sections attendues", () => {
    expect(TEXT.startsWith("# Relicence MIT → GPL-3.0-only\n")).toBe(true);
    for (const section of SECTIONS) {
      expect({ section, présent: TEXT.includes(`${section}\n`) }).toEqual({ section, présent: true });
    }
  });

  test("les faits et références exigés sont cités", () => {
    for (const fact of FACTS) {
      expect({ fait: fact, cité: TEXT.includes(fact) }).toEqual({ fait: fact, cité: true });
    }
  });

  test("les liens relatifs résolvent depuis docs/legal/", () => {
    expect(brokenLinks()).toEqual([]);
  });

  test("ADR-008 renvoie au dossier", () => {
    expect(ADR_TEXT).toContain("(../legal/RELICENSING.md)");
  });
});
