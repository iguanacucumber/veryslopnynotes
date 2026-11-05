// La politique de dérogation est un contrat de release : sans test de forme,
// une colonne retirée, une dérogation auto-approuvée ou un `tier:L` dérogé
// passeraient la revue sans que le gate rougisse.
import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const FILE = "docs/RELEASE-WAIVERS.md";
const TEXT = readFileSync(join(ROOT, FILE), "utf8");
const FLAT = TEXT.replace(/^>\s?/gm, "").replace(/\s+/g, " ");

const SECTIONS = [
  "Politique de dérogation",
  "Règle de lancement",
  "Décision par blocage",
  "Approbations",
];

const REQUIRED_FIELDS = ["Risque", "Atténuation", "Propriétaire", "Expiration", "Preuve"];

const BETA = ["831", "972", "976", "978"];
const TIER_L = ["965", "969"];

/** Lignes du tableau sous un titre `###`, jusqu'au titre de niveau égal ou supérieur. */
function rowsUnder(heading: string): string[][] {
  const start = TEXT.indexOf(`### ${heading}`);
  expect({ heading, présent: start >= 0 }).toEqual({ heading, présent: true });
  const end = TEXT.slice(start + 1).search(/\n#{2,3} /);
  const body = end < 0 ? TEXT.slice(start) : TEXT.slice(start, start + 1 + end);
  return body
    .split("\n")
    .filter((line) => line.startsWith("| [#"))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
}

const id = (cell: string) => /^\[#(\d+)\]/.exec(cell)?.[1] ?? "";
const status = (row: string[]) => row[2]?.replaceAll("`", "") ?? "";

const relLinks = (text: string) =>
  [...text.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((m) => m[1]!)
    .filter((target) => !/^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(target))
    .map((target) => decodeURIComponent(target.split("#")[0]!))
    .filter((target) => target.length > 0);

const resolves = (file: string, link: string) => {
  try {
    return statSync(resolve(ROOT, dirname(file), link)).isFile();
  } catch {
    return false;
  }
};

describe("dérogations de release (#972)", () => {
  test("le document porte les sections exigées", () => {
    for (const section of SECTIONS) {
      expect({ section, présent: TEXT.includes(`## ${section}`) }).toEqual({
        section,
        présent: true,
      });
    }
  });

  test("la politique nomme les approbateurs et interdit l'auto-approbation", () => {
    for (const terme of [
      "deux signatures humaines distinctes",
      "responsable de release",
      "mainteneur de garde",
      "demandeur",
      "agent",
      "mainteneur sécurité",
    ]) {
      expect({ terme, présent: FLAT.includes(terme) }).toEqual({ terme, présent: true });
    }
  });

  test("chaque dérogation exige risque, atténuation, propriétaire, expiration et preuve", () => {
    for (const field of REQUIRED_FIELDS) {
      expect({ field, présent: TEXT.includes(`| \`${field}\` |`) }).toEqual({
        field,
        présent: true,
      });
    }
    for (const field of ["risk", "mitigation", "owner", "expiry"]) {
      expect({ field, présent: FLAT.includes(field) }).toEqual({ field, présent: true });
    }
    expect(FLAT).toContain("Un champ vide, `TBD`, `à définir` ou une date absente");
  });

  test("les interdictions couvrent les tier:L, la sécurité, la perte de données et la confidentialité", () => {
    for (const terme of [
      "Aucune dérogation `tier:L`",
      "violation de sécurité",
      "perte de données",
      "revendication de confidentialité",
      "privacy claim",
      "Aucune dérogation au gate",
    ]) {
      expect({ terme, présent: FLAT.includes(terme) }).toEqual({ terme, présent: true });
    }
  });

  test("la règle de lancement de #982 est recopiée", () => {
    expect(FLAT).toContain(
      "Aucun tag public `v1.0.0` tant que chaque issue `tier:L` n'est pas close, que l'APK signé ne se vérifie pas sur un appareil propre, et que le sign-off juridique n'est pas archivé.",
    );
  });

  test("chaque bloqueur tier:B a un statut autorisé et une preuve", () => {
    const rows = rowsUnder("Bloqueurs `tier:B`");
    const ids = rows.map((row) => id(row[0]!));
    expect(ids.sort()).toEqual([...BETA].sort());
    for (const row of rows) {
      expect({ id: id(row[0]!), cellules: row.length }).toEqual({
        id: id(row[0]!),
        cellules: 8,
      });
      expect({ id: id(row[0]!), statut: status(row) }).toEqual({
        id: id(row[0]!),
        statut: ["open", "to-waive", "closed"].includes(status(row)) ? status(row) : "invalide",
      });
      expect({ id: id(row[0]!), preuve: row[7]!.length > 0 }).toEqual({
        id: id(row[0]!),
        preuve: true,
      });
    }
  });

  test("aucune dérogation n'est proposée ni approuvée", () => {
    const rows = rowsUnder("Bloqueurs `tier:B`");
    expect(rows.some((row) => status(row) === "to-waive")).toBe(false);
    expect(TEXT).toContain("Aucune dérogation n'est approuvée dans ce document");
    expect(TEXT).toContain("Aucune proposition en attente");
    expect(TEXT).not.toContain("[x]");
    expect(TEXT).not.toMatch(/Décision\s*:\s*approuvée/i);
  });

  test("aucun tier:L n'est dérogé", () => {
    const rows = rowsUnder("Bloqueurs `tier:L` — non dérogeables");
    expect(rows.map((row) => id(row[0]!)).sort()).toEqual([...TIER_L].sort());
    for (const row of rows) {
      expect({ id: id(row[0]!), statut: status(row) }).toEqual({
        id: id(row[0]!),
        statut: status(row) === "open" || status(row) === "closed" ? status(row) : "invalide",
      });
    }
  });

  test("la section Approbations ne contient aucun bloc de signature", () => {
    const start = TEXT.indexOf("## Approbations");
    expect(start).toBeGreaterThanOrEqual(0);
    const approvals = TEXT.slice(start);
    expect(approvals).toContain("Aucune proposition en attente");
    expect(approvals).not.toContain("### Dérogation proposée");
    expect(approvals).not.toContain("proposée, non approuvée");
    expect(approvals).not.toContain("nom : ______________________ date : __________");
  });

  test("chaque lien relatif résout depuis le document", () => {
    const bad = relLinks(TEXT).filter((link) => !resolves(FILE, link));
    expect({ bad }).toEqual({ bad: [] });
  });
});
