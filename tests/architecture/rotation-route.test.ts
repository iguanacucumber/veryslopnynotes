// La route de l'interface survit à la recréation de l'activité : rotation,
// changement de configuration ou mort du process recréent la WebView. La route
// vit dans le HASH de l'URL (`HashRouter`), donc sans état sauvegardé
// l'utilisateur retombe sur l'accueil.
//
// Ce test garde les CONTRATS structurels (identifiant stable, source pure rejouée
// par la parité, routeur en hash) ; le câblage exact reste une convention de
// relecture, pour qu'un refactor à comportement identique passe.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const APP = join(ROOT, "android/app/src/main/java/fr/veryslopnynotes/app");
const ROUTE_STATE = join(APP, "WebRouteState.kt");
const IDS = join(ROOT, "android/app/src/main/res/values/ids.xml");

describe("la route survit à la recréation de l'activité (#400)", () => {
  test("la WebView a un identifiant STABLE", () => {
    // L'état d'une vue est indexé par son identifiant : un id régénéré à chaque
    // lancement ne survivrait pas à la recréation.
    const ids = readFileSync(IDS, "utf8");
    expect(ids).toContain('<item name="web_view" type="id" />');
  });

  test("la logique de route est PURE : elle est compilée et rejouée par la parité", () => {
    // Aucun `android.*` : le fichier se compile seul sous `kotlinc`, le harnais
    // de parité rejoue donc le VRAI code.
    const route = readFileSync(ROUTE_STATE, "utf8");
    expect(route).not.toMatch(/^import\s+android\./m);
    const sources = readFileSync(join(ROOT, "tests/unit/fixtures/parity-sources.ts"), "utf8");
    expect(sources).toContain('"WebRouteState.kt"');
  });

  test("la route de l'interface est dans le HASH de l'URL", () => {
    // Le repli natif relit la route dans le FRAGMENT de l'URL : si le routeur
    // quittait le hash, la rotation ramènerait l'utilisateur sur l'accueil.
    const main = readFileSync(join(ROOT, "web", "src", "main.tsx"), "utf8");
    expect(main).toContain("HashRouter");
    expect(main).not.toContain("BrowserRouter");
    // CHEMINS ABSOLUS : c'est le format que le natif lit (« * » est le filet du
    // routeur, pas une route servie).
    const app = readFileSync(join(ROOT, "web", "src", "App.tsx"), "utf8");
    const routes = [...app.matchAll(/<Route path="([^"]+)"/g)]
      .map((m) => m[1]!)
      .filter((route) => route !== "*");
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) expect(route.startsWith("/")).toBe(true);
  });
});
