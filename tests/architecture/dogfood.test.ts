// Le dogfood est une procédure humaine : le test garde la forme du protocole,
// pas un résultat. Une section, un champ de journal ou une règle d'arrêt
// supprimés doivent rougir avant qu'une checklist incomplète passe en revue.
import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const FILE = "docs/DOGFOOD.md";
const DOGFOOD = read(FILE);
const QA = read("docs/QA-MATRIX.md");

const SECTIONS = [
  "Périmètre et données",
  "Préparation (J0)",
  "Journal quotidien",
  "Triage P0/P1 et règle d'arrêt",
  "Critères de sortie",
  "Preuves et confidentialité",
];

const DAILY_FIELDS = [
  "Date",
  "Build/tag",
  "Appareil/WebView",
  "Parcours",
  "Erreurs",
  "Perte de données",
  "IA désactivée/activée",
  "Hors-ligne",
  "Mise à jour",
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

describe("dogfood interne (#965)", () => {
  test("le protocole existe et porte toutes les sections requises", () => {
    expect({ fichier: FILE, existe: exists(FILE) }).toEqual({ fichier: FILE, existe: true });
    for (const section of SECTIONS) {
      expect({ section, présente: DOGFOOD.includes(`## ${section}`) }).toEqual({
        section,
        présente: true,
      });
    }
  });

  test("le run est un téléphone réel, en debug, sans donnée scolaire", () => {
    for (const terme of [
      "seul téléphone Android réel",
      "APK debug",
      "Connexion démo",
      "texte synthétique",
      "Aucun QR",
      "compte Pronote réel",
      "Aucune télémétrie",
      "aucun résultat",
    ]) {
      expect({ terme, présent: DOGFOOD.includes(terme) }).toEqual({ terme, présent: true });
    }
    expect(DOGFOOD).toContain("l'issue #965 reste ouverte");
  });

  test("le journal quotidien garde les champs exigés", () => {
    const header = DOGFOOD.split("\n").find((line) => line.startsWith("| Date | Build/tag |"));
    expect(header).toBeDefined();
    const cells = header!.split("|").map((cell) => cell.trim());
    for (const field of DAILY_FIELDS) {
      expect({ field, colonne: cells.includes(field) }).toEqual({ field, colonne: true });
    }
    expect(DOGFOOD).toContain("Une entrée par jour");
    expect(DOGFOOD).toContain("AAAA-MM-JJ");
  });

  test("le triage P0/P1 et la règle d'arrêt sont explicites", () => {
    for (const terme of [
      "| P0 |",
      "| P1 |",
      "| P2 |",
      "| P3 |",
      "**Règle d'arrêt.**",
      "14 jours repart à zéro",
      "compteur est suspendu",
      "Aucune P0/P1 de données ouverte",
    ]) {
      expect({ terme, présent: DOGFOOD.includes(terme) }).toEqual({ terme, présent: true });
    }
  });

  test("la checklist de sortie exige 14 jours et une signature humaine", () => {
    for (const terme of [
      "14 jours consécutifs",
      "même téléphone réel",
      "Propriétaire du dogfood",
      "Date de clôture",
      "[ ] GO",
      "[ ] NO-GO",
      "checklist ci-dessous signée",
      "Aucune donnée scolaire",
      "aucune télémétrie",
    ]) {
      expect({ terme, présent: DOGFOOD.includes(terme) }).toEqual({ terme, présent: true });
    }
  });

  test("les preuves interdisent les données scolaires et la collecte cachée", () => {
    for (const terme of [
      "captures **caviardées**",
      "adb logcat",
      "export de données",
      "numéro de série",
      "lien du journal",
      "checklist signée",
    ]) {
      expect({ terme, présent: DOGFOOD.includes(terme) }).toEqual({ terme, présent: true });
    }
  });

  test("QA-MATRIX renvoie vers le protocole, et ses liens résolvent", () => {
    expect(relativeLinks(QA)).toContain("DOGFOOD.md");
    for (const link of relativeLinks(DOGFOOD)) {
      expect({ lien: link, résout: exists(join(dirname(FILE), link)) }).toEqual({
        lien: link,
        résout: true,
      });
    }
  });
});
