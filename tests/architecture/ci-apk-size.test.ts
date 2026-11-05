// Un workflow n'a pas de comportement exécutable en test : on verrouille la
// DÉCLARATION. Le budget APK est mesuré sur le commit de la PR, mais le
// vérificateur vient de la branche par défaut : une PR ne doit pas pouvoir
// modifier le code qui juge sa propre taille.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const WORKFLOW = readFileSync(join(ROOT, ".github", "workflows", "apk-size.yml"), "utf8");

describe("CI : budget APK (#974)", () => {
  test("exécute le script de la branche par défaut, jamais celui du checkout", () => {
    expect(WORKFLOW).toContain("contents/agents/runtime/apk-size.ts?ref=$DEFAULT_BRANCH");
    expect(WORKFLOW).toContain('script="$RUNNER_TEMP/apk-size.ts"');
    expect(WORKFLOW).toContain('bun run "$APK_SIZE_SCRIPT"');
    expect(WORKFLOW).not.toContain("bun run agents/runtime/apk-size.ts");
  });

  test("la baseline reste celle du commit mesuré, avec repli main borné", () => {
    expect(WORKFLOW).toContain("--baseline apk-size-baseline.json");
    expect(WORKFLOW).toContain("contents/apk-size-baseline.json?ref=$DEFAULT_BRANCH");
    expect(WORKFLOW).toContain("Budget APK incomplet");
  });

  test("aucun secret et actions épinglées", () => {
    expect(WORKFLOW).not.toContain("secrets.");
    for (const [, ref] of WORKFLOW.matchAll(/uses: [^@\s]+@(\S+)/g)) {
      expect(ref).toMatch(/^[0-9a-f]{40}$/);
    }
  });
});
