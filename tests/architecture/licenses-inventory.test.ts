// Le contrôle de licences n'a de valeur que s'il échoue : chaque test ci-dessous
// injecte une dépendance incompatible ou inconnue dans une fixture et exige un
// refus. Le dernier test vérifie que l'inventaire RÉEL couvre le lock et le
// catalogue ; la CI rejoue le même script dans `.github/workflows/licenses.yml`.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkLicenses, type Inventory } from "../../agents/runtime/check-licenses";

const ROOT = join(import.meta.dir, "..", "..");
const WORKFLOW = readFileSync(join(ROOT, ".github", "workflows", "licenses.yml"), "utf8");
const PACKAGE_JSON = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  scripts?: Record<string, string>;
};

const DEFAULT_INVENTORY: Inventory = {
  allowed: ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "OFL-1.1"],
  bun: { ok: { license: "MIT" } },
  bunFamilies: [],
  gradle: { "androidx.core:core-ktx": { license: "Apache-2.0" } },
};

const DEFAULT_CATALOG = `[versions]
core = "1.0.0"
[libraries]
core = { module = "androidx.core:core-ktx", version.ref = "core" }
`;

interface Fixture {
  packages?: Record<string, string>;
  dependencies?: string[];
  inventory?: Inventory;
  catalog?: string;
}

const fixtures: string[] = [];

function makeFixture(options: Fixture = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "vsn-licenses-"));
  fixtures.push(dir);
  mkdirSync(join(dir, "licenses"), { recursive: true });
  mkdirSync(join(dir, "android", "gradle"), { recursive: true });

  const packages = Object.fromEntries(
    Object.entries(options.packages ?? { ok: "1.0.0" }).map(([name, version]) => [
      name,
      [`${name}@${version}`, "", {}, "sha512-fixture"],
    ]),
  );
  const dependencies = Object.fromEntries((options.dependencies ?? []).map((name) => [name, "1.0.0"]));
  writeFileSync(join(dir, "bun.lock"), JSON.stringify({ packages, workspaces: { "": { dependencies } } }));
  writeFileSync(join(dir, "android", "gradle", "libs.versions.toml"), options.catalog ?? DEFAULT_CATALOG);
  writeFileSync(join(dir, "licenses", "inventory.json"), JSON.stringify(options.inventory ?? DEFAULT_INVENTORY));
  return dir;
}

function errorsOf(options: Fixture): string {
  return checkLicenses(makeFixture(options)).errors.join("\n");
}

afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("inventaire de licences", () => {
  test("l'inventaire du dépôt couvre le lock et le catalogue", () => {
    const report = checkLicenses(ROOT);
    expect(report.errors).toEqual([]);
    expect(report.bun).toBeGreaterThan(0);
    expect(report.gradle).toBeGreaterThan(0);
  });

  test("une licence incompatible échoue, même inventoriée", () => {
    const inventory = structuredClone(DEFAULT_INVENTORY);
    inventory.bun.evil = { license: "GPL-3.0" };
    const errors = errorsOf({ packages: { ok: "1.0.0", evil: "2.0.0" }, inventory });
    expect(errors).toContain("evil");
    expect(errors).toContain("INCOMPATIBLE");
  });

  test("une dépendance absente de l'inventaire échoue", () => {
    const errors = errorsOf({ packages: { ok: "1.0.0", mystery: "1.0.0" } });
    expect(errors).toContain("mystery");
    expect(errors).toContain("INCONNUE");
  });

  test("MPL-2.0 sans portée build/test échoue", () => {
    const inventory = structuredClone(DEFAULT_INVENTORY);
    inventory.bun.lightningcss = { license: "MPL-2.0" };
    const errors = errorsOf({ packages: { ok: "1.0.0", lightningcss: "1.33.0" }, inventory });
    expect(errors).toContain("MPL-2.0");
    expect(errors).toContain("INCOMPATIBLE");
  });

  test("MPL-2.0 build-only mais atteignable en production échoue", () => {
    const inventory = structuredClone(DEFAULT_INVENTORY);
    inventory.bun.lightningcss = { license: "MPL-2.0", scope: "build-only", reason: "outil de build" };
    const errors = errorsOf({
      packages: { ok: "1.0.0", lightningcss: "1.33.0" },
      dependencies: ["lightningcss"],
      inventory,
    });
    expect(errors).toContain("ATTEIGNABLE");
  });

  test("MPL-2.0 build-only hors production passe", () => {
    const inventory = structuredClone(DEFAULT_INVENTORY);
    inventory.bun.lightningcss = { license: "MPL-2.0", scope: "build-only", reason: "outil de build" };
    const report = checkLicenses(makeFixture({ packages: { ok: "1.0.0", lightningcss: "1.33.0" }, inventory }));
    expect(report.errors).toEqual([]);
  });

  test("un module Gradle inconnu échoue", () => {
    const catalog = `${DEFAULT_CATALOG}evil = { module = "example:evil", version.ref = "core" }\n`;
    const errors = errorsOf({ catalog });
    expect(errors).toContain("example:evil");
    expect(errors).toContain("INCONNUE");
  });
});

describe("CI : contrôle de licences", () => {
  test("le workflow est séparé, en lecture seule et sans secret", () => {
    expect(WORKFLOW).toMatch(/^name: licenses$/m);
    expect(WORKFLOW).toMatch(/^ {2}pull_request:$/m);
    expect(WORKFLOW).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(WORKFLOW).not.toMatch(/^\s+\w[\w-]*:\s*write\s*$/m);
    expect(WORKFLOW).not.toContain("${{ secrets.");
    expect(WORKFLOW).not.toContain("continue-on-error");
  });

  test("le workflow exécute le script local, sans installer de dépendances", () => {
    expect(WORKFLOW).toContain("bun run check:licenses");
    expect(WORKFLOW).not.toMatch(/run:.*bun install/);
    expect(PACKAGE_JSON.scripts?.["check:licenses"]).toBe("bun run agents/runtime/check-licenses.ts");
  });

  test("les actions sont épinglées par SHA", () => {
    const refs = [...WORKFLOW.matchAll(/uses: [^@\s]+@(\S+)/g)].map((match) => match[1]!);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(ref).toMatch(/^[0-9a-f]{40}$/);
  });
});
