// #919 : `assembleRelease` sans clé custom doit ÉCHOUER, pas retomber sur la
// clé debug. Le gate ne rejoue pas Gradle ici (configuration froide > 3 min en
// CI, mesuré) : il verrouille la DÉCLARATION, et le job `release-apk` prouve le
// comportement réel — release sans clé en échec, debug construit, puis release
// signée avec la clé éphémère.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const BUILD = readFileSync(join(ROOT, "android", "app", "build.gradle.kts"), "utf8");
const WORKFLOW = readFileSync(join(ROOT, ".github", "workflows", "release-artifact.yml"), "utf8");

function step(name: string): string {
  const start = WORKFLOW.indexOf(`- name: ${name}`);
  if (start < 0) return "";
  const next = WORKFLOW.indexOf("\n      - name:", start + 1);
  return WORKFLOW.slice(start, next < 0 ? WORKFLOW.length : next);
}

describe("release sans clé : fail-closed (#919)", () => {
  test("aucun repli debug dans le script ; debug signé debug explicitement", () => {
    const buildTypes = BUILD.slice(BUILD.indexOf("    buildTypes {"), BUILD.indexOf("    buildFeatures {"));
    const release = buildTypes.slice(buildTypes.indexOf("        release {"));
    // Le repli exact qui signait la release avec la clé debug.
    expect(release).not.toContain('getByName("debug")');
    expect(release).toContain('signingConfig = signingConfigs.getByName("release")');
    // Le debug l'assigne une fois, explicitement.
    expect(BUILD.match(/signingConfigs\.getByName\("debug"\)/g)?.length).toBe(1);
    expect(BUILD).toContain("throw GradleException(");
    expect(BUILD).toContain("Aucun repli debug.");
    // Le refus nomme les quatre champs et leurs variables d'environnement.
    for (const champ of ["release.storeFile", "release.storePassword", "release.keyAlias", "release.keyPassword"]) {
      expect(BUILD).toContain(champ);
    }
    for (const env of ["STORE_FILE", "STORE_PASSWORD", "KEY_ALIAS", "KEY_PASSWORD"]) {
      expect(BUILD).toContain(env);
    }
    // Les valeurs ne sont jamais écrites dans le dépôt.
    expect(BUILD).not.toMatch(/storePassword\s*=\s*"/);
    expect(BUILD).not.toMatch(/keyPassword\s*=\s*"/);
  });

  test("le CI prouve l'échec sans clé, le debug, puis la clé éphémère", () => {
    const sansCle = step("Release sans clé = échec");
    expect(sansCle).toContain("assembleRelease");
    expect(sansCle).toContain("release.storeFile");
    expect(sansCle).toContain("STORE_FILE");
    expect(sansCle).toContain("Aucun repli debug");
    expect(sansCle).toContain('if [ "$code" -eq 0 ]');
    const debug = step("Debug sans clé = OK");
    expect(debug).toContain("assembleDebug");
    // L'échec est prouvé AVANT que la clé éphémère n'existe.
    expect(WORKFLOW.indexOf("- name: Release sans clé = échec")).toBeLessThan(
      WORKFLOW.indexOf("- name: Clé éphémère"),
    );
    // Et la clé éphémère construit bien la release ensuite.
    expect(WORKFLOW.indexOf("- name: APK release")).toBeGreaterThan(WORKFLOW.indexOf("- name: Clé éphémère"));
  });
});
