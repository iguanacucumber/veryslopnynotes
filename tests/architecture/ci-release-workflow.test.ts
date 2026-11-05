// REL-04 (#931) : un workflow n'a pas de comportement exécutable en test. On
// verrouille la DÉCLARATION — tag exact, environnement protégé, build
// réutilisé, signature réelle fail-closed, checksums et source GPL — pour qu'une
// édition du YAML ne puisse pas retirer une preuve en silence.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const WORKFLOW = read(".github/workflows/release.yml");
const README = read("README.md");

describe("CI : release sur tag (#931)", () => {
  test("déclenché par un tag v*, avec dry-run manuel, jamais par une PR", () => {
    expect(WORKFLOW).toMatch(/^on:\n {2}push:\n {4}tags: \["v\*"\]\n {2}workflow_dispatch:$/m);
    expect(WORKFLOW).not.toContain("pull_request");
    expect(WORKFLOW).toContain('if [ "$GITHUB_EVENT_NAME" != "push" ]');
  });

  test("checkout le tag exact et dérive la version avec le script existant", () => {
    expect(WORKFLOW).toContain("ref: ${{ github.ref }}");
    expect(WORKFLOW).toContain("ref: ${{ needs.prepare.outputs.tag }}");
    expect(WORKFLOW.match(/fetch-depth: 0/g)?.length).toBe(2);
    expect(WORKFLOW).toContain("bun agents/runtime/android-version.ts");
    expect(WORKFLOW).toContain('"$version" != "${tag#v}"');
    expect(WORKFLOW).toContain('"$GITHUB_REF_TYPE" != "tag"');
    expect(WORKFLOW).toContain('"$(git rev-parse HEAD)" != "$GITHUB_SHA"');
    expect(WORKFLOW).toContain("git tag --points-at HEAD");
  });

  test("réutilise le workflow de build au lieu de dupliquer Gradle", () => {
    expect(WORKFLOW).toContain("uses: ./.github/workflows/release-artifact.yml");
    expect(WORKFLOW).not.toContain("gradlew");
    expect(WORKFLOW).not.toContain("assembleRelease");
  });

  test("environnement protégé et secrets réels : absent = échec, jamais debug", () => {
    expect(WORKFLOW).toMatch(/^ {4}environment: release$/m);
    for (const secret of [
      "RELEASE_KEYSTORE_BASE64",
      "RELEASE_STORE_PASSWORD",
      "RELEASE_KEY_ALIAS",
      "RELEASE_KEY_PASSWORD",
    ]) {
      expect(WORKFLOW).toContain(`secrets.${secret}`);
    }
    expect(WORKFLOW).toContain('if [ -z "${!name:-}" ]');
    expect(WORKFLOW).toContain("::error title=Secret release absent");
    expect(WORKFLOW).toContain("::add-mask::");
    expect(WORKFLOW).not.toContain("set -x");
    // Le certificat debug est REFUSÉ, pas utilisé comme repli.
    expect(WORKFLOW).toContain("CN=Android Debug");
    expect(WORKFLOW).toContain('"$signataire" != "$attendue"');
    expect(WORKFLOW).toContain("::error title=APK signé debug");
  });

  test("re-signe l'APK puis vérifie signature, SHA-256 et mapping R8", () => {
    expect(WORKFLOW).toContain('"$apksigner" sign');
    expect(WORKFLOW).toContain('"$apksigner" verify --print-certs');
    expect(WORKFLOW).toContain("sha256sum -c SHA256SUMS");
    expect(WORKFLOW).toContain("mapping.txt");
    expect(WORKFLOW).toContain("seeds.txt");
  });

  test("publie la GitHub Release avec notes, assets et source GPL exacte", () => {
    expect(WORKFLOW).toContain('gh release create "$TAG" dist/* --verify-tag');
    expect(WORKFLOW).toContain("--notes-file");
    expect(WORKFLOW).toContain("git archive");
    expect(WORKFLOW).toContain("archive/refs/tags/");
    expect(WORKFLOW).toContain("tree/%s");
    expect(WORKFLOW).toContain("GPL-3.0-only");
  });

  test("bêta : format -beta.N, pré-release conditionnelle, mêmes gates", () => {
    // Le canal est dérivé du tag AVANT le build, et un tag hors
    // vX.Y.Z / vX.Y.Z-beta.N échoue au lieu de publier autre chose.
    expect(WORKFLOW).toContain("prerelease=$prerelease");
    expect(WORKFLOW).toContain("-beta\\.[0-9]+$");
    expect(WORKFLOW).toContain("attendu vX.Y.Z ou vX.Y.Z-beta.N");
    expect(WORKFLOW).toContain('if [ "$PRERELEASE" = "true" ]');
    expect(WORKFLOW).toContain('flags+=(--prerelease)');
    expect(WORKFLOW).toContain('"${flags[@]}"');
    // Une pré-release ne contourne ni la signature réelle ni les checksums.
    expect(WORKFLOW).toContain("environment: release");
    expect(WORKFLOW).toContain("CN=Android Debug");
    expect(WORKFLOW).toContain("sha256sum -c SHA256SUMS");
    expect(WORKFLOW).toContain("git archive");
    expect(WORKFLOW).toContain("GPL-3.0-only");
    expect(WORKFLOW).not.toContain("pull_request");
    expect(README).toContain("Canal bêta");
    expect(README).toContain("downgrade");
  });

  test("permissions minimales et actions épinglées", () => {
    expect(WORKFLOW).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(WORKFLOW.match(/contents: write/g)?.length).toBe(1);
    expect(WORKFLOW.match(/^ {4}permissions:/gm)?.length).toBe(3);
    const actions = WORKFLOW.split("\n").flatMap((line) => {
      const match = /^\s+uses:\s+(\S+)/.exec(line);
      return match ? [match[1]!] : [];
    });
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      if (action.startsWith("./")) continue;
      expect({ action, pinned: /@[0-9a-f]{40}$/.test(action) }).toEqual({ action, pinned: true });
    }
  });

});
