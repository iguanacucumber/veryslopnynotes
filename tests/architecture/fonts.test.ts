// UX-14 : les fontes embarquées sont des SOUS-ENSEMBLES WOFF2, limités aux
// graisses posées par les styles et préchargés pour le premier écran. Le budget
// gzip est mesuré sur le bundle RÉEL de l'APK, après `make web-build`.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describeFontBudget, measureFontBudget } from "../../agents/runtime/font-budget";

const ROOT = join(import.meta.dir, "..", "..");
const FONTS = join(ROOT, "web", "src", "fonts");
const BUNDLE = join(ROOT, "android", "app", "src", "main", "assets", "web");

const GRASSES = ["400", "500", "600", "700", "800"];
const PRELOADS = ["SNPro-Medium.woff2", "SNPro-Semibold.woff2", "SNPro-Bold.woff2"];

function faces(): { weight: string; src: string }[] {
  const css = readFileSync(join(ROOT, "web", "src", "styles", "tokens.css"), "utf8");
  return [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => ({
    weight: /font-weight:\s*(\d+)/.exec(m[1]!)?.[1] ?? "",
    src: /url\(["']?([^"')]+)["']?\)/.exec(m[1]!)?.[1] ?? "",
  }));
}

describe("fontes embarquées : sous-ensemble, graisses utiles, préchargement", () => {
  test("seuls des WOFF2 sous-ensemblés sont livrés", () => {
    const fichiers = readdirSync(FONTS).sort();
    expect(fichiers.every((name) => name.endsWith(".woff2"))).toBe(true);
    expect(fichiers).toEqual([
      "SNPro-Black.woff2",
      "SNPro-Bold.woff2",
      "SNPro-Medium.woff2",
      "SNPro-Regular.woff2",
      "SNPro-Semibold.woff2",
    ]);
  });

  test("les @font-face déclarent les graisses réellement utilisées", () => {
    const declared = faces();
    expect(declared.map((face) => face.weight)).toEqual(GRASSES);
    for (const face of declared) {
      expect({ src: face.src, woff2: face.src.endsWith(".woff2") }).toEqual({
        src: face.src,
        woff2: true,
      });
    }
  });

  test("le premier écran précharge ses graisses critiques", () => {
    const html = readFileSync(join(ROOT, "web", "index.html"), "utf8");
    const preloads = [...html.matchAll(
      /<link\s+rel="preload"\s+href="([^"]+\.woff2)"\s+as="font"\s+type="font\/woff2"\s+crossorigin\s*\/?>/g,
    )].map((m) => m[1]!.split("/").at(-1)!);
    expect(preloads).toEqual(PRELOADS);
    for (const name of preloads) expect(existsSync(join(FONTS, name))).toBe(true);
  });
});

describe("budget gzip du bundle de l'APK", () => {
  test("les cinq WOFF2 tiennent le budget et aucun TTF ne traîne", () => {
    if (!existsSync(BUNDLE)) {
      throw new Error(`bundle web ABSENT (${BUNDLE}) — lancer « make web-build » avant ce test.`);
    }
    const assets = join(BUNDLE, "assets");
    const budget = measureFontBudget(assets);
    expect(budget.failures).toEqual([]);
    expect(budget.fonts.length).toBe(GRASSES.length);
    expect(describeFontBudget(budget)).toContain("gzip");
    expect(readdirSync(assets).filter((name) => name.endsWith(".ttf"))).toEqual([]);
  });
});
