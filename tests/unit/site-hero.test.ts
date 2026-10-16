// site-hero.test.ts — pin le hero (helpers, budgets, hygiène).
// Note : site/hero.js est du vanilla JS non typé par choix (zéro toolchain
// côté page) ; l'import ci-dessous est donc explicitement non vérifié.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// @ts-ignore - hero.js volontairement sans types (page vanilla autonome)
import { CONFIG, clamp, countUpValue, easeOutExpo, formatAverage, screenIndexForProgress } from "../../site/hero.js";

const ROOT = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("site hero", () => {
  test("fichiers présents", () => {
    for (const f of ["site/index.html", "site/style.css", "site/hero.js", "site/README.md"]) {
      expect(existsSync(join(ROOT, f))).toBe(true);
    }
  });

  test("easing + count-up", () => {
    expect(easeOutExpo(0)).toBe(0);
    expect(easeOutExpo(1)).toBe(1);
    expect(easeOutExpo(0.5)).toBeGreaterThan(0.5);
    expect(easeOutExpo(0.25)).toBeLessThan(easeOutExpo(0.75));
    expect(countUpValue(0, 14.82, 0)).toBe(0);
    expect(countUpValue(0, 14.82, 1)).toBeCloseTo(14.82, 10);
    expect(formatAverage(14.82)).toBe("14,82");
    expect(formatAverage(0)).toBe("0,00");
    expect(CONFIG.average).toBe(14.82);
    expect(CONFIG.parallaxMax).toBe(12);
    expect(CONFIG.magneticMax).toBe(8);
  });

  test("timeline : 4 écrans sur la progression", () => {
    expect(screenIndexForProgress(0)).toBe(0);
    expect(screenIndexForProgress(0.24)).toBe(0);
    expect(screenIndexForProgress(0.25)).toBe(1);
    expect(screenIndexForProgress(0.5)).toBe(2);
    expect(screenIndexForProgress(0.99)).toBe(3);
    expect(screenIndexForProgress(1)).toBe(3);
    expect(screenIndexForProgress(-0.5)).toBe(0);
    expect(screenIndexForProgress(2)).toBe(3);
    expect(clamp(99, 0, 1)).toBe(1);
  });

  test("budgets : JS < 25 Ko gzip, CSS < 15 Ko gzip", () => {
    const js = Bun.gzipSync(Buffer.from(read("site/hero.js")));
    const css = Bun.gzipSync(Buffer.from(read("site/style.css")));
    expect(js.length).toBeLessThan(25 * 1024);
    expect(css.length).toBeLessThan(15 * 1024);
  });

  test("FR + a11y + mouvement réduit + thèmes", () => {
    const html = read("site/index.html");
    const css = read("site/style.css");
    expect(html).toContain('lang="fr"');
    expect(html).toContain("Ton Pronote");
    expect(html).toContain("Injection neutralisée");
    expect(html).toContain("non affilié");
    expect(html).toContain('aria-label');
    expect(html).toContain("skip");
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain('[data-theme="light"]');
    expect(html).toContain("themeToggle");
  });

  test("hygiène : synthétique, sans secret ni hôte Pronote", () => {
    const all = read("site/index.html") + read("site/hero.js") + read("site/style.css");
    expect(all).not.toMatch(/sk-or-v1-|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/);
    expect(all).not.toMatch(/index-education\.net|pronote\.example|0000000x/);
    expect(all).not.toMatch(/cdn\.|googleapis|analytics/);
    // Seuls liens externes tolérés : GitHub du projet (CTA).
    const urls = [...all.matchAll(/https:\/\/[a-z0-9.-]+/gi)].map((m) => m[0]);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).toMatch(/^https:\/\/github\.com/);
  });
});
