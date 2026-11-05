// #976 : le dossier de validation est une pièce de procédure, pas une
// signature. Ce test verrouille les sept sujets, les questions, les preuves,
// la dernière vérification et les blocs de signature vides tant qu'aucune
// décision écrite n'existe.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const FILE = "docs/legal/SIGNOFF.md";
const TEXT = readFileSync(join(ROOT, FILE), "utf8");

const SECTIONS = [
  "## 1. GPL et relicence",
  "## 2. Notice de confidentialité",
  "## 3. Assistant IA et mineurs",
  "## 4. Autorisation Pronote et établissement",
  "## 5. Marque et nom public",
  "## 6. Droit d'auteur des manuels et du scraper",
  "## 7. Sécurité et garde des clés",
] as const;

const SIGNATURE_FIELDS = [
  "- Nom et qualité du signataire",
  "- Date",
  "- Signature",
  "- Décision",
  "- Réserves",
] as const;

/** Preuve courante que chaque section doit lier, en plus de #976. */
const EVIDENCE = {
  "## 1. GPL et relicence": "](RELICENSING.md)",
  "## 2. Notice de confidentialité": "](CONTROLLER.md)",
  "## 3. Assistant IA et mineurs": "](../adr/009-ai-eligibility.md)",
  "## 4. Autorisation Pronote et établissement": "](CONTROLLER.md)",
  "## 5. Marque et nom public": "](NAME.md)",
  "## 6. Droit d'auteur des manuels et du scraper": "](manual-scraper.md)",
  "## 7. Sécurité et garde des clés": "](../SIGNING.md)",
} as const satisfies Record<(typeof SECTIONS)[number], string>;

/** Corps d'une section `## …` jusqu'au prochain titre de même niveau. */
function section(md: string, heading: string): string {
  const start = md.indexOf(`${heading}\n`);
  if (start === -1) return "";
  const end = md.indexOf("\n## ", start + heading.length + 1);
  return md.slice(start, end === -1 ? undefined : end);
}

/** Valeur après `libellé :` ; un champ signé ne contient pas que des `_`. */
function fieldValue(body: string, label: string): string {
  const line = body.split("\n").find((l) => l.startsWith(`${label} :`));
  return line?.slice(label.length + 2).trim() ?? "";
}

describe("dossier de validation juridique (#976)", () => {
  test("le fichier annonce l'absence de signature et ne clôt pas la revue", () => {
    expect(TEXT.startsWith("# Dossier de validation juridique et vie privée\n")).toBe(true);
    expect(TEXT).toContain("aucune signature de conseil enregistrée");
    expect(TEXT).toContain("Révision : **3**");
    expect(TEXT).toContain("Dernière vérification : **2026-11-05**");
    expect(TEXT).toContain("#976");
    expect(TEXT).not.toContain("Closes #976");
  });

  test("les sept sujets requis ont leur section", () => {
    for (const heading of SECTIONS) {
      expect({ heading, présent: section(TEXT, heading).length > 0 }).toEqual({
        heading,
        présent: true,
      });
    }
  });

  test("chaque sujet reste pending tant qu'aucune signature n'est archivée", () => {
    for (const heading of SECTIONS) {
      expect({ heading, statut: section(TEXT, heading).includes("- Statut : `pending`") }).toEqual({
        heading,
        statut: true,
      });
    }
  });

  test("chaque sujet porte constat, questions, preuves et bloc de signature", () => {
    for (const heading of SECTIONS) {
      const body = section(TEXT, heading);
      for (const block of ["**Ce que le dépôt permet de vérifier**", "**Questions au conseil**", "**Preuves**", "**Bloc de signature"]) {
        expect({ heading, block, présent: body.includes(block) }).toEqual({
          heading,
          block,
          présent: true,
        });
      }
      expect({ heading, questions: body.includes("1. ") }).toEqual({ heading, questions: true });
    }
  });

  test("chaque sujet nomme la décision humaine restante et sa preuve courante", () => {
    for (const heading of SECTIONS) {
      const body = section(TEXT, heading);
      expect({ heading, décision: body.includes("- Décision humaine restante : ") }).toEqual({
        heading,
        décision: true,
      });
      expect({ heading, preuve: body.includes(EVIDENCE[heading]) }).toEqual({
        heading,
        preuve: true,
      });
    }
  });

  test("les champs de signature restent vides pour un statut pending", () => {
    for (const heading of SECTIONS) {
      const body = section(TEXT, heading);
      for (const label of SIGNATURE_FIELDS) {
        const value = fieldValue(body, label);
        expect({ heading, label, vide: /^_+$/.test(value) }).toEqual({
          heading,
          label,
          vide: true,
        });
      }
    }
  });

  test("le journal ne porte aucune signature inventée", () => {
    const journal = section(TEXT, "## Journal des signatures");
    const rows = journal.split("\n").filter((line) => /^\| .+ \| `pending` \|/.test(line));
    expect(rows.length).toBe(SECTIONS.length);
    expect(journal).not.toMatch(/[0-9a-f]{32,}/i);
  });

  test("la procédure d'archive dit où, qui lit et comment la release la cite", () => {
    const archive = section(TEXT, "## Archive de la copie signée");
    for (const fait of [
      "archive privée",
      "iguanacucumber",
      "hors du dépôt public",
      "Le mainteneur, le signataire",
      "SHA-256",
      "notes de release",
      "checklist de publication",
      "dérogation",
    ]) {
      expect({ fait, cité: archive.includes(fait) }).toEqual({ fait, cité: true });
    }
  });

  test("les faits ouverts renvoient aux issues de suivi", () => {
    for (const issue of ["#826", "#827", "#828", "#829", "#831", "#838", "#906", "#976"]) {
      expect({ issue, cité: TEXT.includes(issue) }).toEqual({ issue, cité: true });
    }
  });
});
