// #622 : la liste des routes du smoke vivait DANS le script Playwright, donc
// rien ne signalait qu'une route de `App.tsx` n'était plus visitée. Le module
// `web/src/smoke-routes.ts` est la source unique ; ce test verrouille sa
// parité avec les `<Route path="...">` explicites de l'application.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SMOKE_ROUTES } from "../../web/src/smoke-routes";

const ROOT = join(import.meta.dir, "..", "..");
const APP = join(ROOT, "web", "src", "App.tsx");

/** Routes explicites de `App.tsx` : alias compris, catch-all `*` exclu. */
function appRoutes(source: string): string[] {
  return [...source.matchAll(/<Route\b[^>]*?\bpath="([^"]+)"/g)]
    .map((m) => m[1]!)
    .filter((path) => path !== "*");
}

describe("parité des routes du smoke", () => {
  test("le smoke visite exactement les routes de App.tsx", () => {
    const app = appRoutes(readFileSync(APP, "utf8"));
    const smoke = SMOKE_ROUTES.map(([, path]) => path);

    // Un parseur qui ne trouve rien rendrait la comparaison vacuement vraie :
    // même règle que les scanners (un invariant non vérifiable = ÉCHEC).
    expect(app.length).toBeGreaterThan(0);
    expect(new Set(app).size).toBe(app.length);
    expect(new Set(smoke).size).toBe(smoke.length);

    const absentesDuSmoke = app.filter((path) => !smoke.includes(path));
    const absentesDeApp = smoke.filter((path) => !app.includes(path));
    if (absentesDuSmoke.length || absentesDeApp.length) {
      throw new Error(
        [
          "Liste de routes désynchronisée entre web/src/App.tsx et web/src/smoke-routes.ts.",
          ...absentesDuSmoke.map((path) => `  App.tsx seulement (à ajouter au smoke) : ${path}`),
          ...absentesDeApp.map((path) => `  smoke seulement (absente de App.tsx) : ${path}`),
          "Corriger des DEUX côtés, puis relancer `make web-smoke`.",
        ].join("\n"),
      );
    }
  });
});
