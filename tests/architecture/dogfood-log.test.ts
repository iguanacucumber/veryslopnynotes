// Le journal de dogfood est rempli par un humain : ce test garde le modèle
// vierge (champs, 14 jours, signature) et interdit qu'une entrée ou une date
// inventée soit livrée à la place du run.
import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const FILE = "docs/DOGFOOD-LOG.md";
const LOG = read(FILE);
const DOGFOOD = read("docs/DOGFOOD.md");

const FIELDS = [
  "Date",
  "Build/tag",
  "Appareil/WebView",
  "Parcours testés",
  "Hors-ligne",
  "IA désactivée/activée",
  "Mise à jour / données conservées",
  "Erreurs",
  "Sévérité",
  "Décision",
];

function relativeLinks(md: string): string[] {
  return [...md.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((match) => match[1]!)
    .filter((target) => !/^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(target))
    .map((target) => decodeURIComponent(target.split("#")[0]!))
    .filter((target) => target.length > 0);
}

const exists = (path: string) => {
  try {
    statSync(join(ROOT, path));
    return true;
  } catch {
    return false;
  }
};

describe("journal de dogfood (#965)", () => {
  test("le modèle existe, est vierge et porte les champs exigés", () => {
    expect({ fichier: FILE, existe: exists(FILE) }).toEqual({ fichier: FILE, existe: true });
    expect(LOG).toContain("aucune entrée");
    expect(LOG).toContain("aucune date préremplie");
    expect(LOG).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);

    const header = LOG.split("\n").find((line) => line.startsWith("| Jour | Date |"));
    expect(header).toBeDefined();
    const cells = header!.split("|").map((cell) => cell.trim());
    for (const field of FIELDS) {
      expect({ field, colonne: cells.includes(field) }).toEqual({ field, colonne: true });
    }
  });

  test("les 14 jours sont présents et vides", () => {
    const rows = LOG.split("\n").filter((line) => /^\| J\d+ \|/.test(line));
    expect(rows).toHaveLength(14);
    rows.forEach((row, index) => {
      const cells = row.split("|").slice(1, -1).map((cell) => cell.trim());
      expect(cells[0]).toBe(`J${index + 1}`);
      expect(cells.slice(1).filter(Boolean)).toEqual([]);
    });
  });

  test("la bannière interdit les données scolaires et les secrets", () => {
    for (const terme of [
      "Aucune donnée scolaire",
      "établissement",
      "note",
      "message",
      "QR",
      "PIN",
      "jeton",
      "clé OpenRouter",
      "capture non caviardée",
      "export de données",
      "identifiant d'appareil",
      "Connexion démo",
      "texte synthétique",
    ]) {
      expect({ terme, présent: LOG.includes(terme) }).toEqual({ terme, présent: true });
    }
  });

  test("la signature finale demande propriétaire, date et empreinte du build", () => {
    for (const terme of [
      "Propriétaire du dogfood",
      "Date de clôture",
      "Build final",
      "SHA-256",
      "[ ] GO",
      "[ ] NO-GO",
    ]) {
      expect({ terme, présent: LOG.includes(terme) }).toEqual({ terme, présent: true });
    }
  });

  test("le protocole pointe vers le journal et les liens résolvent", () => {
    expect(relativeLinks(DOGFOOD)).toContain("DOGFOOD-LOG.md");
    expect(relativeLinks(LOG)).toContain("DOGFOOD.md");
    for (const [file, links] of [
      ["docs/DOGFOOD.md", relativeLinks(DOGFOOD)],
      [FILE, relativeLinks(LOG)],
    ] as const) {
      for (const link of links) {
        expect({ lien: link, résout: exists(join(dirname(file), link)) }).toEqual({
          lien: link,
          résout: true,
        });
      }
    }
  });
});
