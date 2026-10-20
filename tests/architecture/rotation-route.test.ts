// #400 : la route de l'interface survit à la recréation de l'activité.
//
// Rotation de l'écran, changement de configuration, mort du processus : dans
// les trois cas l'activité est RECRÉÉE, donc la WebView repart de zéro. Or la
// route vit dans le HASH de l'URL (`web/src/main.tsx` : `HashRouter`) : sans
// état sauvegardé, l'utilisateur retombait sur l'accueil.
//
// Ce test lit les SOURCES RÉELLES (jamais une copie) : il échoue dès qu'on
// retire l'un des volets du correctif — la sauvegarde, la restauration, le
// repli sur la route, ou l'identifiant stable de la WebView.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";

const ROOT = join(import.meta.dir, "..", "..");
const APP = join(ROOT, "android/app/src/main/java/fr/veryslopnynotes/app");
const ACTIVITY = join(APP, "MainActivity.kt");
const SHELL = join(APP, "WebApp.kt");
const ROUTE_STATE = join(APP, "WebRouteState.kt");
const IDS = join(ROOT, "android/app/src/main/res/values/ids.xml");

describe("la route survit à la recréation de l'activité (#400)", () => {
  test("l'activité sauvegarde et restaure l'état de la WebView", () => {
    const code = codeOnly(readFileSync(ACTIVITY, "utf8"));
    // Les deux callbacks du contrat de l'activité…
    expect(code).toContain("override fun onSaveInstanceState(outState: Bundle)");
    expect(code).toContain("override fun onRestoreInstanceState(savedInstanceState: Bundle)");
    // …et les deux appels qui sauvent la WebView.
    expect(code).toMatch(/view\.saveState\(outState\)/);
    expect(code).toMatch(/view\.restoreState\(savedInstanceState\)/);
    // L'état de la PLATEFORME n'est pas sacrifié au passage.
    expect(code).toContain("super.onSaveInstanceState(outState)");
    expect(code).toContain("super.onRestoreInstanceState(savedInstanceState)");
  });

  test("le chemin de la route est écrit dans l'état sauvegardé, puis relu", () => {
    const code = codeOnly(readFileSync(ACTIVITY, "utf8"));
    // L'écriture : le CHEMIN de la route, pas l'URL entière.
    expect(code).toContain("outState.putString(ROUTE_STATE_KEY");
    expect(code).toContain("routePathFromUrl(view.url)");
    // La relecture : le chemin relu passe par la logique PUR (une route hors
    // contrat est refusée, pas servie).
    expect(code).toContain("routePathFromState");
  });

  test("un état de WebView irrécupérable rouvre sur la route, pas sur l'accueil", () => {
    const code = codeOnly(readFileSync(ACTIVITY, "utf8"));
    // `restoreState` renvoie null quand l'état n'a pas pu être restauré :
    // le repli est alors la route SAUVEGARDÉE.
    expect(code).toMatch(/if \(restored == null\)\s*\{[\s\S]*?open\(savedRoute\(savedInstanceState\)\)/);
  });

  test("la route sauvegardée prime sur le deep link (l'intention est périmée)", () => {
    const code = codeOnly(readFileSync(ACTIVITY, "utf8"));
    // Un deep link ne sert qu'au PREMIER lancement : après une recréation,
    // c'est la route sauvegardée qui compte, sinon l'utilisateur est renvoyé
    // sur l'écran du deep link au lieu de celui qu'il regardait.
    expect(code).toContain("shell.open(savedRoute(savedInstanceState) ?: routePath(intent))");
  });

  test("la WebView a un identifiant STABLE", () => {
    // L'état d'une vue est indexé par son identifiant : un id régénéré à
    // chaque lancement ne survivrait pas à la recréation, et l'état de la
    // WebView ne serait jamais retrouvé.
    const ids = readFileSync(IDS, "utf8");
    expect(ids).toContain('<item name="web_view" type="id" />');
    const shell = codeOnly(readFileSync(SHELL, "utf8"));
    expect(shell).toContain("id = R.id.web_view");
    expect(shell).not.toContain("generateViewId()");
  });

  test("la logique de route est PURE : elle est compilée et rejouée par la parité", () => {
    // Aucun `android.*` : le fichier se compile seul sous `kotlinc`, donc le
    // harnais de parité rejoue le VRAI code (et pas un miroir TS).
    const route = readFileSync(ROUTE_STATE, "utf8");
    expect(route).not.toMatch(/^import\s+android\./m);
    expect(route).toContain("fun routePathFromUrl");
    expect(route).toContain("fun routePathFromState");
    // Et il est bien dans les sources de production du port de parité.
    const sources = readFileSync(join(ROOT, "tests/unit/fixtures/parity-sources.ts"), "utf8");
    expect(sources).toContain('"WebRouteState.kt"');
  });

  test("la liste des routes n'a qu'un endroit de vérité", () => {
    // `WEB_ROUTES` vit dans le fichier PUR : la WebView, l'activité et les
    // tests lisent la MÊME liste (une liste dupliquée, c'est une route
    // servie par l'un et refusée par l'autre).
    const shell = codeOnly(readFileSync(SHELL, "utf8"));
    expect(shell).not.toMatch(/val WEB_ROUTES: Set<String> = setOf\(/);
    const route = readFileSync(ROUTE_STATE, "utf8");
    expect(route).toMatch(/val WEB_ROUTES: Set<String> = setOf\(/);
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
