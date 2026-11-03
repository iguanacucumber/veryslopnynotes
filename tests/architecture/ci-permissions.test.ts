// Le workflow tourne sur des PR et des pushs : un jeton d'écriture ou des
// identifiants persistés dans `.git/config` y sont une surface d'attaque. Un
// fichier YAML n'a pas de comportement à tester, le scan de source est donc le
// seul contrôle possible.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CI = readFileSync(join(import.meta.dir, "..", "..", ".github", "workflows", "ci.yml"), "utf8");

describe("CI : permissions minimales (#912)", () => {
  test("le workflow n'accorde que contents: read, au niveau racine", () => {
    expect(CI).toMatch(/^permissions:\n {2}contents: read$/m);
    // `write` à n'importe quelle profondeur serait une permission élargie.
    expect(CI).not.toMatch(/^\s+\w[\w-]*:\s*write\s*$/m);
  });

  test("aucun job ne déclare ses propres permissions", () => {
    const declarations = [...CI.matchAll(/^(\s*)permissions:/gm)].map((m) => m[1]);
    expect(declarations).toEqual([""]);
  });

  test("chaque checkout ne persiste pas les identifiants", () => {
    const checkouts = CI.split(/\n\s*- name:/).filter((step) => step.includes("uses: actions/checkout@"));
    expect(checkouts.length).toBeGreaterThan(0);
    for (const step of checkouts) expect(step).toContain("persist-credentials: false");
  });
});
