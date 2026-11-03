// La déclaration d'accessibilité est une PROMESSE publique : ses sections, ses
// limites et ses liens ne peuvent pas disparaître sans rougir le gate. Le test
// vérifie la forme et le câblage, jamais une conformité appareil.
import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const FILE = "docs/ACCESSIBILITY.md";
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const exists = (path: string) => {
  try {
    statSync(join(ROOT, path));
    return true;
  } catch {
    return false;
  }
};

const DECLARATION = read(FILE);
const CONTEXT = read("docs/CONTEXT.md");
const README = read("README.md");
const HELP = read("web/src/features/help/HelpScreen.tsx");
const PKG = JSON.parse(read("package.json")) as {
  devDependencies: Record<string, string>;
};

const SECTIONS = [
  "Cible de conformité",
  "Limites connues",
  "Environnements testés",
  "Technologies d'assistance",
  "Contact et support",
  "Mise à jour",
] as const;

/** Lien Markdown relatif, sans ancre ; les URL externes sortent. */
function relativeLinks(md: string): string[] {
  return [...md.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((match) => match[1]!)
    .filter((target) => !/^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(target))
    .map((target) => decodeURIComponent(target.split("#")[0]!))
    .filter((target) => target.length > 0);
}

describe("déclaration d'accessibilité (#981)", () => {
  test("le fichier de preuve existe et porte les sections exigées", () => {
    expect({ fichier: FILE, existe: exists(FILE) }).toEqual({ fichier: FILE, existe: true });
    for (const section of SECTIONS) {
      expect({ section, présente: new RegExp(`^## ${section}$`, "m").test(DECLARATION) }).toEqual({
        section,
        présente: true,
      });
    }
  });

  test("la cible et les limites ne promettent pas une conformité totale", () => {
    expect(DECLARATION).toContain("WCAG 2.2 niveaux A et AA");
    expect(DECLARATION).toContain("partiellement vérifiée, jamais certifiée");
    expect(DECLARATION).toContain("Aucune conformité totale n'est revendiquée");
    // Les limites renvoient à la matrice QA, pas à une appréciation vague.
    for (const qa of ["QA-01", "QA-05", "QA-07", "QA-13"]) {
      expect({ qa, cité: DECLARATION.includes(qa) }).toEqual({ qa, cité: true });
    }
    expect(DECLARATION).toContain("TalkBack");
    expect(DECLARATION).toContain("Chromium 100");
  });

  test("les versions testées et les outils suivent les manifestes", () => {
    for (const version of ["Android 8.0 (API 26)", "Android 12 (API 31)", "Android 15 (API 35)", "Android 16 (API 36)"]) {
      expect({ version, citée: DECLARATION.includes(version) }).toEqual({ version, citée: true });
    }
    expect(DECLARATION).toContain("Chrome for Testing 156.0.8078.4");
    expect(DECLARATION).toContain(`axe-core ${PKG.devDependencies["axe-core"]}`);
    expect(DECLARATION).toContain(`Playwright ${PKG.devDependencies["@playwright/test"]}`);
  });

  test("le contact et la cadence sont explicites", () => {
    expect(DECLARATION).toContain("https://github.com/iguanacucumber/veryslopnynotes/issues/new/choose");
    expect(DECLARATION).toContain("security/advisories/new");
    expect(DECLARATION).toContain("6 mois");
    expect(DECLARATION).toContain("2027-05-03");
  });

  test("chaque lien relatif résout depuis la déclaration", () => {
    const links = relativeLinks(DECLARATION);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect({ lien: link, résout: exists(join(dirname(FILE), link)) }).toEqual({
        lien: link,
        résout: true,
      });
    }
  });

  test("la déclaration est atteignable depuis l'index des docs et l'aide", () => {
    expect(CONTEXT).toContain("(ACCESSIBILITY.md)");
    expect(README).toContain("(docs/ACCESSIBILITY.md)");
    expect(HELP).toContain('id="aide-accessibilite"');
    expect(HELP).toContain("docs/ACCESSIBILITY.md");
  });
});
