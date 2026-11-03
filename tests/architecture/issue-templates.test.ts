// Le formulaire de demande est un contrat public : un champ retiré, un titre
// hors format ou un lien de sécurité mort casse le triage sans rougir ailleurs.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

type Field = {
  type: string;
  id?: string;
  attributes?: { value?: string; label?: string; options?: string[] };
  validations?: { required?: boolean };
};

const FEATURE = Bun.YAML.parse(read(".github/ISSUE_TEMPLATE/feature_request.yml")) as {
  name: string;
  description: string;
  title: string;
  labels: string[];
  body: Field[];
};

describe("modèle de demande de fonctionnalité", () => {
  test("métadonnées françaises, titre [Feature] et label enhancement", () => {
    expect(FEATURE.name).toBe("Demande de fonctionnalité");
    expect(FEATURE.description).toBe(
      "Proposer une fonctionnalité ou une amélioration, sans donnée scolaire.",
    );
    expect(FEATURE.title).toBe("[Feature] ");
    expect(FEATURE.labels).toEqual(["enhancement"]);
    expect(FEATURE.labels).not.toContain("good first issue");
  });

  test("champs problème, proposition, alternative et écran ou module", () => {
    const fields = FEATURE.body.filter((field) => field.id);
    expect(fields.map((field) => field.id)).toEqual([
      "probleme",
      "proposition",
      "alternative",
      "ecran-module",
      "donnees",
    ]);
    for (const id of ["probleme", "proposition", "ecran-module"]) {
      expect(fields.find((field) => field.id === id)?.validations?.required).toBe(true);
    }
    expect(fields.find((field) => field.id === "ecran-module")?.attributes?.options?.length).toBeGreaterThan(1);
  });

  test("avertissement données scolaires et renvoi SECURITY.md valide", () => {
    const markdown = FEATURE.body
      .filter((field) => field.type === "markdown")
      .map((field) => field.attributes?.value ?? "")
      .join("\n");
    expect(markdown).toContain("Ne joins aucune donnée");
    expect(markdown).toContain("scolaire");

    const links = [...markdown.matchAll(/\]\((https?:\/\/[^)]+)\)/g)].map((match) => match[1]!);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const local = link.replace(
        /^https:\/\/github\.com\/iguanacucumber\/veryslopnynotes\/blob\/main\//,
        "",
      );
      expect(existsSync(join(ROOT, local))).toBe(true);
    }
    expect(links.some((link) => link.endsWith("/SECURITY.md"))).toBe(true);
  });

  test("aucun bon premier ticket dans le dossier des modèles", () => {
    const dir = join(ROOT, ".github/ISSUE_TEMPLATE");
    for (const file of readdirSync(dir)) {
      expect(readFileSync(join(dir, file), "utf8")).not.toContain("good first");
    }
  });
});
