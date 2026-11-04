// CI-02 (#883) : un workflow n'a pas de comportement exécutable en test. On
// verrouille la DÉCLARATION — clé éphémère hors workspace, refus du repli
// debug, mapping R8 exigé, artefact borné — pour qu'une édition du YAML ne
// puisse pas retirer une preuve en silence.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const WORKFLOW = read(".github/workflows/release-artifact.yml");
const BUILD = read("docs/architecture/BUILD.md");

function step(name: string): string {
  const start = WORKFLOW.indexOf(`- name: ${name}`);
  if (start < 0) return "";
  const next = WORKFLOW.indexOf("\n      - name:", start + 1);
  return WORKFLOW.slice(start, next < 0 ? WORKFLOW.length : next);
}

describe("CI : artefact release (#883)", () => {
  test("le workflow est réutilisable et sans secret", () => {
    expect(WORKFLOW).toMatch(/^ {2}workflow_call:$/m);
    expect(WORKFLOW).not.toContain("secrets.");
    expect(WORKFLOW).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(WORKFLOW).not.toMatch(/^\s+\w[\w-]*:\s*write\s*$/m);
    // Aucune permission de job ne doit élargir la racine.
    expect(WORKFLOW.match(/^permissions:/gm)?.length).toBe(1);
    expect(WORKFLOW).not.toMatch(/^ {2,}permissions:/m);
    expect(WORKFLOW).toContain("persist-credentials: false");
  });

  test("la clé est éphémère, hors workspace et hors artefact", () => {
    const key = step("Clé éphémère");
    expect(key).toContain("keytool -genkeypair");
    expect(key).toContain('store="$RUNNER_TEMP/vsn-ci-release.jks"');
    expect(key).toContain("::add-mask::");
    const upload = step("APK et mapping");
    expect(upload).not.toMatch(/\.jks|keystore/i);
    expect(upload).toContain("name: release-apk");
    expect(upload).toMatch(/retention-days:\s*7/);
    expect(upload).toContain("if-no-files-found: error");
  });

  test("la release est construite et sa signature est vérifiée", () => {
    expect(step("APK release")).toContain("assembleRelease");
    const verify = step("Vérification signature et mapping");
    expect(verify).toContain('"$apksigner" verify --print-certs');
    // Le repli debug du build passe sans erreur : il doit être REFUSÉ ici.
    expect(verify).toContain("CN=Android Debug");
    expect(verify).toContain("certificate SHA-256 digest");
    expect(verify).toContain('"$signataire" != "$attendue"');
  });

  test("R8 a bien produit mapping et seeds", () => {
    const verify = step("Vérification signature et mapping");
    for (const file of ["mapping.txt", "seeds.txt"]) {
      expect(verify).toContain(file);
      expect(verify).toMatch(/\[ -s "\$chemin" \]/);
    }
    expect(verify).toContain("^fr\\.veryslopnynotes\\.");
  });

  test("BUILD.md documente le job et son artefact", () => {
    const section = BUILD.slice(BUILD.indexOf("## Artefact release"));
    expect(section).toContain("`release-artifact`");
    expect(section).toMatch(/ÉPHÉMÈRE/);
    expect(section).toContain("`workflow_call`");
    expect(section).toMatch(/7 jours/);
  });
});
