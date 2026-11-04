// L'annonce est un contrat public : une limite retirée, une valeur inventée ou
// une publication annoncée sans release signée casserait la confiance sans
// rougir ailleurs. Ce test verrouille la forme, pas la vérité d'une publication.
import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const FILE = "docs/RELEASE-ANNOUNCEMENT.md";
const DOC = read(FILE);
const FLAT = DOC.replace(/\s+/g, " ");
const RELEASE = read("docs/RELEASE.md");
const CHANGELOG = read("CHANGELOG.md");

const SECTIONS = [
  "Statut et mode d'emploi",
  "Annonce prête à publier",
  "Notes de version (modèle GitHub)",
  "Checklist avant publication",
  "Ne pas annoncer si",
  "Liens du kit",
] as const;

const PLACEHOLDERS = ["<tag>", "<AAAA-MM-JJ>", "<url-release>", "<sha256-apk>", "<empreinte-certificat>"] as const;

const relativeLinks = (text: string) =>
  [...text.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((match) => match[1]!)
    .filter((target) => !/^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(target))
    .map((target) => decodeURIComponent(target.split("#")[0]!))
    .filter((target) => target.length > 0);

const exists = (path: string) => {
  try {
    statSync(join(ROOT, path));
    return true;
  } catch {
    return false;
  }
};

describe("kit d'annonce v1.0.0 (#978)", () => {
  test("le document existe et porte les sections requises", () => {
    expect({ fichier: FILE, existe: exists(FILE) }).toEqual({ fichier: FILE, existe: true });
    const headings = new Set(DOC.split("\n"));
    for (const section of SECTIONS) {
      expect({ section, présente: headings.has(`## ${section}`) }).toEqual({
        section,
        présente: true,
      });
    }
  });

  test("la cible est v1.0.0 mais aucune release n'est revendiquée", () => {
    for (const terme of [
      "v1.0.0",
      "Brouillon",
      "aucune release n'est publiée",
      "reste ouverte",
      "page de release signée",
      "#978",
    ]) {
      expect({ terme, présent: FLAT.includes(terme) }).toEqual({ terme, présent: true });
    }
    expect(DOC).not.toMatch(/releases\/(?:tag|download)\//);
    expect(DOC).not.toMatch(/\b[0-9a-f]{64}\b/);
  });

  test("les limites réelles sont nommées, sans promesse de confort", () => {
    for (const terme of [
      "Pas de rappels ni de notifications",
      "QR + PIN uniquement",
      "Un compte élève à la fois",
      "MFA",
      "pas de SSO d'ENT",
      "Assistant IA facultatif",
      "OpenRouter",
      "peut être facturée",
      "Aucune télémétrie",
      "SDK d'analytics",
      "rapport de crash",
      "identifiant d'installation",
      "journal automatique",
      "non affilié à Pronote / Index Éducation ni à Papillon",
      "Association Papillon",
    ]) {
      expect({ terme, présent: FLAT.includes(terme) }).toEqual({ terme, présent: true });
    }
  });

  test("installation, vérification, mise à jour et source sont explicites", () => {
    for (const terme of [
      "sha256sum -c SHA256SUMS",
      "apksigner verify --print-certs",
      "release → release",
      "Bêta → finale",
      "Debug → release",
      "downgrade",
      "Obtainium",
      "GPL-3.0-only",
      "archive source",
      "PRIVACY.md",
      "TERMS.md",
      "SUPPORT.md",
      "SECURITY.md",
    ]) {
      expect({ terme, présent: FLAT.includes(terme) }).toEqual({ terme, présent: true });
    }
    expect(RELEASE).toContain("SHA256SUMS");
    expect(RELEASE).toContain("apksigner verify --print-certs");
  });

  test("les placeholders de publication restent vides et la checklist est liée", () => {
    for (const placeholder of PLACEHOLDERS) {
      expect({ placeholder, présent: DOC.includes(placeholder) }).toEqual({
        placeholder,
        présent: true,
      });
    }
    for (const terme of [
      "docs/RELEASE-CHECKLIST.md",
      "#976",
      "#972",
      "#969",
      "#982",
      "Ne pas annoncer si",
      "page de release GitHub réelle et signée",
    ]) {
      expect({ terme, présent: FLAT.includes(terme) }).toEqual({ terme, présent: true });
    }
  });

  test("aucune date, empreinte, adresse ou URL de release n'est inventée", () => {
    expect(DOC).not.toMatch(/\b20\d{2}-\d{2}-\d{2}\b/);
    expect(DOC).not.toMatch(/mailto:|support@|contact@/i);
    expect(DOC).not.toMatch(/releases\/(?:tag|download)\//);
    expect(DOC).not.toMatch(/\b[0-9a-f]{64}\b/);
  });

  test("chaque lien relatif résout depuis docs/", () => {
    const links = relativeLinks(DOC);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect({ lien: link, résout: exists(join(dirname(FILE), link)) }).toEqual({
        lien: link,
        résout: true,
      });
    }
  });

  test("le CHANGELOG porte une entrée pour le kit", () => {
    expect(CHANGELOG).toContain("docs/RELEASE-ANNOUNCEMENT.md");
  });
});
