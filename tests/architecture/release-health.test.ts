// La santé de release est une politique, pas du code : le seul contrôle
// possible est la forme du document. Sans ce test, un retrait de section ou un
// lien mort passerait la revue sans que le gate rougisse.
import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const HEALTH = "docs/RELEASE-HEALTH.md";
const INCIDENTS = "docs/INCIDENTS.md";
const HEALTH_TEXT = read(HEALTH);
const INCIDENTS_TEXT = read(INCIDENTS);

const SECTIONS = [
  "Aucune télémétrie",
  "Signaux observés",
  "Propriétaires et cadence",
  "Seuils et déclencheurs",
  "Retrait, retour arrière et reprise",
];

const SIGNALS: [string, string][] = [
  ["S1", "Crash Android"],
  ["S2", "ANR Android"],
  ["S3", "Gate CI"],
  ["S4", "Rapports d'issue"],
  ["S5", "Intégrité des artefacts"],
  ["S6", "Santé serveur"],
];

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

describe("santé de release (#834)", () => {
  test("le document existe et porte les sections exigées", () => {
    expect(() => read(HEALTH)).not.toThrow();
    for (const section of SECTIONS) {
      expect({ section, présent: HEALTH_TEXT.includes(`## ${section}`) }).toEqual({
        section,
        présent: true,
      });
    }
  });

  test("les six signaux sont nommés avec source, propriétaire et cadence", () => {
    for (const [id, label] of SIGNALS) {
      const row = new RegExp(`^\\| ${id} \\| ${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\|.*\\|$`, "m");
      expect({ id, ligne: row.test(HEALTH_TEXT) }).toEqual({ id, ligne: true });
    }
    expect(HEALTH_TEXT).toContain("Responsable de release");
    expect(HEALTH_TEXT).toContain("Mainteneur de garde");
    expect(HEALTH_TEXT).toContain("J+0, J+1, J+3, J+7");
  });

  test("les seuils de crash, d'ANR et de perte de données sont chiffrés", () => {
    for (const seuil of ["1,0 %", "2,0 %", "0,5 %", "100 sessions", "3 rapports", "2 rapports"]) {
      expect({ seuil, présent: HEALTH_TEXT.includes(seuil) }).toEqual({ seuil, présent: true });
    }
  });

  test("le retrait, le retour arrière et la reprise sont définis", () => {
    for (const terme of ["Retrait (yank)", "Retour arrière serveur", "Reprise", "SHA-256", "digest"]) {
      expect({ terme, présent: HEALTH_TEXT.includes(terme) }).toEqual({ terme, présent: true });
    }
  });

  test("aucune télémétrie n'est ajoutée par la politique", () => {
    expect(HEALTH_TEXT).toContain("Aucune télémétrie n'est ajoutée");
    expect(HEALTH_TEXT).toContain("ne contacte aucun serveur de mesure");
  });

  test("aucun manifeste de l'app ne déclare un SDK de télémétrie", () => {
    // Preuve négative : la politique interdit la collecte, la dépendance ne doit
    // pas arriver par un lockfile ou un catalogue Gradle.
    const interdits = /firebase|crashlytics|sentry|bugsnag|datadog|amplitude|mixpanel|play-services-analytics/i;
    for (const manifeste of ["package.json", "android/app/build.gradle.kts", "android/gradle/libs.versions.toml"]) {
      expect({ manifeste, télémétrie: interdits.test(read(manifeste)) }).toEqual({
        manifeste,
        télémétrie: false,
      });
    }
  });

  test("les docs de release et d'incident pointent vers la politique", () => {
    for (const file of ["docs/RELEASE.md", INCIDENTS, "SECURITY.md"]) {
      expect({ file, lien: relLinks(read(file)).includes("RELEASE-HEALTH.md") || relLinks(read(file)).includes("docs/RELEASE-HEALTH.md") }).toEqual({
        file,
        lien: true,
      });
    }
  });

  test("chaque lien relatif de la politique et du suivi d'incident résout", () => {
    for (const file of [HEALTH, INCIDENTS]) {
      const bad = relLinks(read(file)).filter((link) => !resolves(file, link));
      expect({ file, bad }).toEqual({ file, bad: [] });
    }
  });

  test("le suivi d'incident porte known-issues, triage, pause et revue de bêta", () => {
    for (const terme of ["known-issues", "Triage", "Règle de pause", "Revue de bêta", "perte de données"]) {
      expect({ terme, présent: INCIDENTS_TEXT.includes(terme) }).toEqual({ terme, présent: true });
    }
  });
});
