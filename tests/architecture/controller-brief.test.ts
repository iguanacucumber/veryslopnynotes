// #831 : la notice ne peut pas inventer un responsable. Ce test verrouille le
// dossier de décision, les champs vides et le lien depuis les points ouverts.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const BRIEF = read("docs/legal/CONTROLLER.md");
const PRIVACY = read("PRIVACY.md");

const FIELDS = [
  "Nom ou entité juridique",
  "Forme juridique",
  "Adresse ou siège",
  "Contact vie privée",
  "Représentant UE (art. 27)",
  "DPO (art. 37)",
] as const;

const OPTIONS = [
  "Mainteneur personne physique",
  "Association",
  "Société",
] as const;

const PLACEHOLDERS = [
  "{{NOM_OU_ENTITÉ}}",
  "{{ADRESSE_OU_SIÈGE}}",
  "{{CONTACT_VIE_PRIVÉE}}",
  "{{REPRÉSENTANT_UE}}",
  "{{DPO}}",
] as const;

function section(md: string, heading: string): string {
  const start = md.indexOf(`${heading}\n`);
  if (start === -1) return "";
  const end = md.indexOf("\n## ", start + heading.length + 1);
  return md.slice(start, end === -1 ? undefined : end);
}

function decisionValue(label: string): string {
  const decision = section(BRIEF, "## 8. Champs de décision");
  const line = decision.split("\n").find((l) => l.startsWith(`| ${label} |`));
  return line?.split("|")[2]?.trim() ?? "";
}

describe("dossier responsable du traitement (#831)", () => {
  test("le dossier prépare la décision, sans la prendre ni clore l'issue", () => {
    expect(
      BRIEF.startsWith("# Responsable du traitement et contact — dossier de décision\n"),
    ).toBe(true);
    expect(BRIEF).toContain("ne vaut\npas avis juridique");
    expect(BRIEF).toContain("validation par un conseil");
    expect(BRIEF).toContain("#831");
    expect(BRIEF).toContain("#976");
    expect(BRIEF).not.toContain("Closes #831");
  });

  test("les trois options réalistes sont décrites", () => {
    for (const option of OPTIONS) {
      expect({ option, présent: BRIEF.includes(option) }).toEqual({ option, présent: true });
    }
    for (const heading of [
      "### A. Mainteneur personne physique, à titre personnel",
      "### B. Association",
      "### C. Société",
    ]) {
      expect({ heading, présent: section(BRIEF, heading).length > 0 }).toEqual({
        heading,
        présent: true,
      });
    }
  });

  test("les champs de décision restent vides", () => {
    for (const field of FIELDS) {
      expect({ field, vide: /^_+$/.test(decisionValue(field)) }).toEqual({ field, vide: true });
    }
  });

  test("le texte de remplacement garde des placeholders, jamais une identité inventée", () => {
    const start = BRIEF.indexOf("## 9. Texte exact de remplacement de `PRIVACY.md` §1");
    const end = BRIEF.indexOf("\n## 10. Validation", start);
    const template = BRIEF.slice(start, end === -1 ? undefined : end);
    expect(template).toContain("## 1. Responsable du traitement et contact");
    for (const placeholder of PLACEHOLDERS) {
      expect({ placeholder, présent: template.includes(placeholder) }).toEqual({
        placeholder,
        présent: true,
      });
    }
    expect(BRIEF).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  });

  test("la notice renvoie au dossier sans remplir l'identité", () => {
    const open = section(PRIVACY, "## 15. Points ouverts avant la release publique");
    expect(open).toContain("[`docs/legal/CONTROLLER.md`](docs/legal/CONTROLLER.md)");
    expect(open).toContain("#831");
    expect(PRIVACY).toContain("La désignation formelle du responsable");
    expect(PRIVACY).toContain("ouverte");
    expect(PRIVACY).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  });
});
