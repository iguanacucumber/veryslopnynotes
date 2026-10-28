// #400 : la route de l'interface survit à la recréation de l'activité.
//
// Rotation de l'écran, changement de configuration, mort du processus : dans
// les trois cas l'activité est RECRÉÉE, donc la WebView repart de zéro. Or la
// route vit dans le HASH de l'URL (`web/src/main.tsx` : `HashRouter`) : sans
// état sauvegardé, l'utilisateur retombait sur l'accueil.
//
// Ce test garde les CONTRATS structurels (identifiant stable, source pure
// rejouée par la parité, routeur en hash). Le câblage de la sauvegarde et de la
// restauration dans l'activité, comme l'unicité de la liste des routes, n'est
// plus épinglé au texte des appels : un refactor à comportement identique doit
// passer. Ces points restent des conventions de relecture.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const APP = join(ROOT, "android/app/src/main/java/fr/veryslopnynotes/app");
const ROUTE_STATE = join(APP, "WebRouteState.kt");
const IDS = join(ROOT, "android/app/src/main/res/values/ids.xml");

describe("la route survit à la recréation de l'activité (#400)", () => {
  test("la WebView a un identifiant STABLE", () => {
    // L'état d'une vue est indexé par son identifiant : un id régénéré à
    // chaque lancement ne survivrait pas à la recréation, et l'état de la
    // WebView ne serait jamais retrouvé. L'identifiant est déclaré une fois
    // dans les ressources ; son affectation à la vue reste une convention de
    // relecture.
    const ids = readFileSync(IDS, "utf8");
    expect(ids).toContain('<item name="web_view" type="id" />');
  });

  test("la logique de route est PURE : elle est compilée et rejouée par la parité", () => {
    // Aucun `android.*` : le fichier se compile seul sous `kotlinc`, donc le
    // harnais de parité rejoue le VRAI code (et pas un miroir TS).
    const route = readFileSync(ROUTE_STATE, "utf8");
    expect(route).not.toMatch(/^import\s+android\./m);
    // Et il est bien dans les sources de production du port de parité.
    const sources = readFileSync(join(ROOT, "tests/unit/fixtures/parity-sources.ts"), "utf8");
    expect(sources).toContain('"WebRouteState.kt"');
  });

  test("la route de l'interface est dans le HASH de l'URL", () => {
    // Le socle du correctif : le repli natif relit la route dans le
    // FRAGMENT de l'URL. Si le routeur quittait le hash, la route deviendrait
    // illisible et la rotation ramènerait l'utilisateur sur l'accueil — en
    // silence, sans la moindre erreur.
    const main = readFileSync(join(ROOT, "web", "src", "main.tsx"), "utf8");
    expect(main).toContain("HashRouter");
    expect(main).not.toContain("BrowserRouter");
    // Les routes sont des CHEMINS ABSOLUS : c'est le format que le natif lit.
    // (« * » est le filet de sécurité du routeur, pas une route servie.)
    const app = readFileSync(join(ROOT, "web", "src", "App.tsx"), "utf8");
    const routes = [...app.matchAll(/<Route path="([^"]+)"/g)]
      .map((m) => m[1]!)
      .filter((route) => route !== "*");
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) expect(route.startsWith("/")).toBe(true);
  });
});
