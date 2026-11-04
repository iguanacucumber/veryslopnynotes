// La bêta est une procédure publique : un lien mort, une section retirée ou une
// promesse de consentement inventée casserait le parcours sans rougir ailleurs.
import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const FILE = "docs/BETA.md";
const BETA = read(FILE);
const RELEASE = read("docs/RELEASE.md");
const TEMPLATE_FILE = ".github/ISSUE_TEMPLATE/beta_feedback.yml";
const TEMPLATE = Bun.YAML.parse(read(TEMPLATE_FILE)) as {
  name: string;
  description: string;
  title: string;
  labels: string[];
  body: Field[];
};

type Field = {
  type: string;
  id?: string;
  attributes?: { value?: string; label?: string; options?: string[] };
  validations?: { required?: boolean };
};

const SECTIONS = [
  "Rejoindre la bêta privée",
  "Installer et mettre à jour",
  "Aucune télémétrie",
  "Consentement et vie privée",
  "Donner un retour",
  "Triage et problèmes connus",
  "Sortir de la bêta",
  "Checklist du participant",
  "Preuves attendues",
] as const;

const relLinks = (text: string) =>
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

const githubBlob = (link: string) =>
  link.replace(
    /^https:\/\/github\.com\/iguanacucumber\/veryslopnynotes\/blob\/main\//,
    "",
  );

describe("kit de bêta privée (#969)", () => {
  test("le document existe et porte les sections requises", () => {
    expect({ fichier: FILE, existe: exists(FILE) }).toEqual({ fichier: FILE, existe: true });
    for (const section of SECTIONS) {
      expect({ section, présente: new RegExp(`^## ${section}$`, "m").test(BETA) }).toEqual({
        section,
        présente: true,
      });
    }
  });

  test("le canal, l'installation signée et la sortie vers la finale sont explicites", () => {
    for (const terme of [
      "vX.Y.Z-beta.N",
      "Pre-release",
      "APK release signé",
      "SHA256SUMS",
      "apksigner verify --print-certs",
      "sans désinstaller",
      "`versionCode`",
      "vX.Y.Z",
      "downgrade",
    ]) {
      expect({ terme, présent: BETA.includes(terme) }).toEqual({ terme, présent: true });
    }
  });

  test("l'absence de télémétrie et les frontières de consentement sont nommées", () => {
    for (const terme of [
      "Aucune télémétrie",
      "SDK d'analytics",
      "identifiant d'installation",
      "journal automatique",
      "PRIVACY.md",
      "TERMS.md",
      "consentement versionné",
      "autorisation parentale",
      "sans donnée scolaire",
    ]) {
      expect({ terme, présent: BETA.includes(terme) }).toEqual({ terme, présent: true });
    }
  });

  test("le retour passe par GitHub Issues et le triage known-issues", () => {
    for (const terme of [
      "GitHub Issues",
      "beta_feedback.yml",
      "`[known-issues] vX.Y.Z`",
      "Revue de bêta",
      "J+0, J+1, J+3, J+7",
      "Advisory privé",
    ]) {
      expect({ terme, présent: BETA.includes(terme) }).toEqual({ terme, présent: true });
    }
  });

  test("aucune preuve de participation ou de consentement n'est inventée", () => {
    for (const terme of [
      "ne prouve ni recrutement ni consentement",
      "objectif, pas un résultat",
      "s'invente pas",
      "reste ouverte",
    ]) {
      expect({ terme, présent: BETA.includes(terme) }).toEqual({ terme, présent: true });
    }
    expect(BETA).not.toMatch(/mailto:|support@|contact@/i);
  });

  test("chaque lien relatif du kit résout depuis docs/", () => {
    const links = relLinks(BETA);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect({ lien: link, résout: exists(join(dirname(FILE), link)) }).toEqual({
        lien: link,
        résout: true,
      });
    }
  });

  test("le modèle de retour bêta suit le format des autres modèles", () => {
    expect(TEMPLATE.name).toBe("Retour bêta");
    expect(TEMPLATE.title).toBe("[Beta] ");
    expect(TEMPLATE.labels).toEqual(["beta"]);
    expect(TEMPLATE.description).toContain("sans donnée scolaire");

    const fields = TEMPLATE.body.filter((field) => field.id);
    for (const id of [
      "type-retour",
      "version-app",
      "version-android",
      "version-webview",
      "constat",
      "etapes",
      "attendu",
    ]) {
      expect({ id, requis: fields.find((field) => field.id === id)?.validations?.required }).toEqual({
        id,
        requis: true,
      });
    }
    expect(fields.find((field) => field.id === "type-retour")?.attributes?.options?.length).toBeGreaterThan(1);
  });

  test("le modèle avertit sur les données scolaires et les liens résolvent", () => {
    const markdown = TEMPLATE.body
      .filter((field) => field.type === "markdown")
      .map((field) => field.attributes?.value ?? "")
      .join("\n");
    expect(markdown).toContain("Ne joins");
    expect(markdown).toContain("donnée");
    expect(markdown).toContain("scolaire");

    const links = [...markdown.matchAll(/\]\((https?:\/\/[^)]+)\)/g)].map((match) => match[1]!);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      if (!link.startsWith("https://github.com/iguanacucumber/veryslopnynotes/blob/main/")) continue;
      expect({ lien: link, résout: exists(githubBlob(link)) }).toEqual({ lien: link, résout: true });
    }
    expect(links.some((link) => link.endsWith("/SECURITY.md"))).toBe(true);
    expect(links.some((link) => link.endsWith("/docs/BETA.md"))).toBe(true);
  });

  test("RELEASE.md renvoie vers le kit sans dupliquer la procédure", () => {
    expect(relLinks(RELEASE)).toContain("BETA.md");
  });
});
