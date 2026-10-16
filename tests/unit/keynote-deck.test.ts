// keynote-deck.test.ts — pin le deck keynote (durées, langue, hygiène).
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const DECK = join(ROOT, "keynote", "index.html");

describe("keynote deck", () => {
  test("fichiers présents", () => {
    for (const f of ["keynote/index.html", "keynote/export.mjs", "keynote/README.md"]) {
      expect(existsSync(join(ROOT, f))).toBe(true);
    }
  });

  test("7 scènes, total 210 s (≥ 2 min)", () => {
    const html = readFileSync(DECK, "utf8");
    const durs = [...html.matchAll(/data-dur="(\d+)"/g)].map((m) => Number(m[1]));
    expect(durs).toEqual([20, 25, 30, 50, 40, 30, 15]);
    expect(durs.reduce((a, b) => a + b, 0)).toBe(210);
  });

  test("FR + titre + sections archi/features", () => {
    const html = readFileSync(DECK, "utf8");
    expect(html).toContain('lang="fr"');
    expect(html).toContain("VerySloppy");
    for (const needle of ["ADR-003", "OpenRouter", "UNTRUSTED", "hors-ligne", "MIT"]) {
      expect(html).toContain(needle);
    }
  });

  test("hygiène : aucun secret ni hôte réel", () => {
    const html = readFileSync(DECK, "utf8");
    expect(html).not.toMatch(/sk-or-v1-|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/);
    expect(html).not.toMatch(/index-education\.net|pronote\.example|0000000x/);
    expect(html).not.toMatch(/https?:\/\/[a-z0-9-]+\.[a-z]{2,}/i);
  });

  test("voxel : vendor épinglé + fallback + heartbeat", () => {
    const html = readFileSync(DECK, "utf8");
    expect(html).toContain('<script src="vendor/three.min.js">');
    expect(html).toContain("voxelFallback");
    expect(html).toContain('id="ambient"');
    expect(html).toContain("__voxelActive");
    const vendor = join(ROOT, "keynote", "vendor", "three.min.js");
    expect(existsSync(vendor)).toBe(true);
    expect(readFileSync(vendor, "utf8").length).toBeGreaterThan(500_000);
    const version = readFileSync(join(ROOT, "keynote", "vendor", "VERSION"), "utf8").trim();
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(version).toBe(pkg.devDependencies.three);
    expect(existsSync(join(ROOT, "keynote", "motion-proof.mjs"))).toBe(true);
  });
});
