// Le workflow télécharge des archives que le gate EXÉCUTE (SDK Android,
// compilateur Kotlin) : sans empreinte, une archive remplacée changerait
// l'outil sans qu'aucun test ne rougisse. Un fichier YAML n'a pas de
// comportement à tester, le scan de source est donc le seul contrôle possible.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const CI = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
const WRAPPER = readFileSync(join(ROOT, "android", "gradle", "wrapper", "gradle-wrapper.properties"), "utf8");

function step(name: string): string {
  const match = new RegExp(`- name: ${name}\\n([\\s\\S]*?)(?=\\n      - name: )`).exec(CI);
  if (match === null) throw new Error(`étape CI absente : ${name}`);
  return match[1]!;
}

function expectVerifiedBeforeUnzip(body: string, archives: number) {
  expect([...body.matchAll(/\b[0-9a-f]{64}\b/g)]).toHaveLength(archives);
  expect([...body.matchAll(/^\s*curl .* -o /gm)]).toHaveLength(archives);
  const check = body.indexOf("sha256sum -c");
  const unzip = body.indexOf("unzip ");
  expect(check).toBeGreaterThan(-1);
  expect(unzip).toBeGreaterThan(check);
}

describe("CI : caches et archives vérifiées (#916)", () => {
  test("le cache Gradle suit la version du wrapper", () => {
    const version = /gradle-([\d.]+)-bin\.zip/.exec(WRAPPER)?.[1];
    if (version === undefined) throw new Error("version Gradle absente du wrapper");
    expect(CI).toContain(`~/.gradle/caches/${version}`);
    expect(CI).not.toMatch(/\.gradle\/caches\/9\.8\.1/);
  });

  test("les trois archives du SDK sont vérifiées par SHA-256 avant extraction", () => {
    expectVerifiedBeforeUnzip(step("SDK Android"), 3);
  });

  test("le compilateur Kotlin est vérifié par SHA-256 avant extraction", () => {
    expectVerifiedBeforeUnzip(step("Compilateur Kotlin"), 1);
  });
});
