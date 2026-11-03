// #970 : les scans axe et les captures de référence vivent dans `web-smoke`.
// Ce test verrouille le CÂBLAGE (cible make, config, routes, baselines, CI),
// pas le rendu : une suppression silencieuse de l'étape doit rougir ici, même
// si personne ne relance Chromium.
import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { SMOKE_ROUTES } from "../../web/src/smoke-routes";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const MAKEFILE = read("Makefile");
const CONFIG = read("tests/visual/playwright.config.ts");
const SPEC = read("tests/visual/a11y.pw.ts");
const CI = read(".github/workflows/ci.yml");
const PKG = JSON.parse(read("package.json")) as {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
};

/** Recette d'une cible make : lignes tabulées jusqu'à la prochaine cible. */
function recette(cible: string): string {
  const bloc = new RegExp(`^${cible}:[^\\n]*\\n((?:\\t.*\\n)+)`, "m").exec(MAKEFILE)?.[1] ?? "";
  return bloc;
}

/** Lignes d'un job YAML, jusqu'au job suivant (clé à l'indentation 2). */
function jobBlock(yaml: string, name: string): string {
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^  ${name}:\\s*$`).test(line));
  if (start < 0) return "";
  const end = lines.findIndex((line, i) => i > start && /^  [A-Za-z][\w-]*:\s*$/.test(line));
  return lines.slice(start, end < 0 ? lines.length : end).join("\n");
}

describe("web a11y et régression visuelle — câblage", () => {
  test("`make web-smoke` exécute le smoke ET la suite axe/captures", () => {
    const smoke = recette("web-smoke");
    expect(smoke).toContain("bun run agents/runtime/web-smoke.ts");
    expect(smoke).toContain("bun run test:visual");
    // Le build est déjà une dépendance de la cible, pas deux builds.
    expect(recette("web-smoke")).not.toContain("bun run build:web");
  });

  test("le script test:visual pointe la config Playwright dédiée", () => {
    expect(PKG.scripts["test:visual"]).toBe(
      "playwright test --config tests/visual/playwright.config.ts",
    );
  });

  test("les dépendances navigateur/axe sont épinglées", () => {
    expect(PKG.devDependencies["@playwright/test"]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(PKG.devDependencies["axe-core"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("la config fixe viewport, moteur, horloge et rendu de police", () => {
    expect(CONFIG).toContain("testDir: import.meta.dirname");
    // Suffixe `.pw.ts` : `bun test` ne doit pas ramasser les specs Playwright.
    expect(CONFIG).toContain('testMatch: "*.pw.ts"');
    expect(CONFIG).toMatch(/workers:\s*1/);
    expect(CONFIG).toMatch(/retries:\s*0/);
    expect(CONFIG).toMatch(/fullyParallel:\s*false/);
    expect(CONFIG).toContain("viewport: { width: 390, height: 844 }");
    expect(CONFIG).toMatch(/deviceScaleFactor:\s*1/);
    expect(CONFIG).toContain('reducedMotion: "reduce"');
    expect(CONFIG).toContain('timezoneId: "Europe/Paris"');
    expect(CONFIG).toContain('locale: "fr-FR"');
    expect(CONFIG).toContain('snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}"');
    for (const drapeau of [
      "--force-color-profile=srgb",
      "--disable-lcd-text",
      "--font-render-hinting=none",
      "--disable-font-subpixel-positioning",
    ]) {
      expect(CONFIG).toContain(drapeau);
    }
  });

  test("le spec visite TOUTES les routes du smoke, en clair et en sombre", () => {
    expect(SPEC).toContain('from "../../web/src/smoke-routes"');
    expect(SPEC).toMatch(/for \(const \[name, route\] of SMOKE_ROUTES\)/);
    // Une route ajoutée à App.tsx/smoke-routes.ts est donc scannée sans liste
    // parallèle à maintenir.
    expect(SPEC).toContain("await ouvrir(page, route, false)");
    expect(SPEC).toContain("await ouvrir(page, route, true)");
  });

  test("axe tourne sur les tags WCAG A/AA et le contraste est demandé", () => {
    expect(SPEC).toContain('"wcag2a"');
    expect(SPEC).toContain('"wcag2aa"');
    expect(SPEC).toContain('"wcag21a"');
    expect(SPEC).toContain('"wcag21aa"');
    expect(SPEC).toContain('"wcag22a"');
    expect(SPEC).toContain('"wcag22aa"');
    expect(SPEC).toContain('rules: { "color-contrast": { enabled: true } }');
    expect(SPEC).toContain("api.run(document");
    expect(SPEC).toContain("expect(clair, formaterViolations(route, \"clair\", clair)).toEqual([])");
    expect(SPEC).toContain("expect(sombre, formaterViolations(route, \"sombre\", sombre)).toEqual([])");
  });

  test("le contraste est aussi mesuré sur les variables réellement appliquées", () => {
    expect(SPEC).toContain("couleursAppliquees(page)");
    expect(SPEC).toContain("PAIRES_CONTRASTE");
    expect(SPEC).toContain("toBeGreaterThanOrEqual(minimum)");
  });

  test("l'horloge est figée et les dates relatives sont masquées", () => {
    expect(SPEC).toContain("page.clock.setFixedTime(FIXED_TIME)");
    expect(SPEC).toContain("FIXED_TIME = new Date(");
    for (const selecteur of [".week-nav__detail", ".messages-card__date", ".grades-latest__date", ".news-card__date"]) {
      expect(SPEC).toContain(`"${selecteur}"`);
    }
    expect(SPEC).toContain("toHaveScreenshot(`${name}.png`");
  });

  test("une baseline PNG existe pour chaque route smoke", () => {
    for (const [name] of SMOKE_ROUTES) {
      const chemin = join(ROOT, "tests", "visual", "__screenshots__", `${name}.png`);
      const contenu = readFileSync(chemin);
      expect({ route: name, png: contenu.subarray(0, 8).toString("hex") }).toEqual({
        route: name,
        png: "89504e470d0a1a0a",
      });
      expect({ route: name, taille: statSync(chemin).size > 1_000 }).toEqual({ route: name, taille: true });
    }
  });

  test("la CI garde les diffs visuels en artefact, même en échec", () => {
    const smoke = jobBlock(CI, "web-smoke");
    expect(smoke).toContain("make web-smoke");
    expect(smoke).toContain("name: web-smoke-shots");
    expect(smoke).toContain("test-results");
    expect(smoke).toMatch(/if: always\(\)/);
    expect(smoke).toMatch(/retention-days:\s*7/);
  });

  test("les sorties Playwright sont ignorées par git", () => {
    const ignore = read(".gitignore");
    expect(ignore).toContain("test-results/");
    expect(ignore).toContain("playwright-report/");
  });
});
