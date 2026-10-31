// CVE-2026-111497 (node2shell / HTTP2Shell) : le décodeur Brotli du runtime est
// vulnérable (RCE) avant Bun 1.4.4. Le correctif est un RUNTIME, pas un paquet
// npm : `bun audit` ne le voit pas. Ce test verrouille le plancher et la
// cohérence des trois endroits qui fixent le runtime (image, CI, types).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const PLANCHER = "1.4.4";

function versionParts(version: string): number[] {
  const parts = version.split(".").map(Number);
  expect(parts.every(Number.isInteger)).toBe(true);
  return parts;
}

/** `version >= plancher`, composant par composant (sans dépendance semver). */
function auMoins(version: string, plancher: string): boolean {
  const a = versionParts(version);
  const b = versionParts(plancher);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return true;
}

describe("runtime Bun : plancher CVE-2026-111497", () => {
  const dockerfile = readFileSync(join(ROOT, "Dockerfile.server"), "utf8");
  const ci = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    devDependencies: Record<string, string>;
  };
  const lock = readFileSync(join(ROOT, "bun.lock"), "utf8");

  const image = /^FROM\s+oven\/bun:([\d.]+)/m.exec(dockerfile)?.[1];
  const ciVersion = /bun-version:\s*"([\d.]+)"/.exec(ci)?.[1];
  const typesVersion = pkg.devDependencies["@types/bun"];
  if (!image || !ciVersion || !typesVersion) {
    throw new Error("version Bun illisible dans Dockerfile.server, la CI ou package.json");
  }

  test(`l'image serveur ne descend pas sous Bun ${PLANCHER}`, () => {
    expect(auMoins(image, PLANCHER)).toBe(true);
  });

  test(`la CI ne descend pas sous Bun ${PLANCHER}`, () => {
    expect(auMoins(ciVersion, PLANCHER)).toBe(true);
  });

  test("la CI teste la MÊME version que l'image déployée", () => {
    expect(ciVersion).toBe(image);
  });

  test("@types/bun et le lock suivent le runtime (pas de types périmés)", () => {
    expect(typesVersion).toBe(image);
    expect(lock).toContain(`"@types/bun@${typesVersion}"`);
    expect(lock).toContain(`"bun-types@${typesVersion}"`);
  });
});
