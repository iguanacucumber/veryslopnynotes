// #400 : la route de l'interface web survit à la recréation de l'activité.
//
// La route vit dans le HASH de l'URL de la WebView (`web/src/main.tsx` :
// `HashRouter`) : la lire, la garder et la relire est une LOGIQUE PURE, dans
// `android/app/.../WebRouteState.kt` (aucun import `android.*`). Ce test
// compile cette VRAIE source et la pilote via
// `agents/runtime/kotlin-parity/WebRouteParityMain.kt` : les assertions
// portent donc sur du code EXÉCUTÉ, pas sur un miroir TS.
//
// Outillage `kotlinc`/`java` absent = SKIP BRUYANT du harnais (jamais un faux
// vert) ; un échec de compilation, lui, est un défaut (le test rougit).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const ROOT_APP = join(ROOT, "android", "app", "src", "main", "java", "fr", "veryslopnynotes", "app");
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "WebRouteParityMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

/** URL de la WebView : l'origine locale de l'app, servie depuis les assets. */
const INDEX = "https://appassets.androidplatform.net/index.html";

/** Chemin de route lu par le VRAI Kotlin dans l'URL d'une WebView. */
async function routeFromUrl(url: string | null): Promise<string | null> {
  const res = JSON.parse(await link!.ask({ op: "route", url })) as { path: string | null };
  return res.path;
}

/** Chemin de route RELU par le VRAI Kotlin dans l'état sauvegardé. */
async function routeFromState(path: string | null): Promise<string | null> {
  const res = JSON.parse(await link!.ask({ op: "state", path })) as { path: string | null };
  return res.path;
}

/** Les routes servies, lues dans le VRAI Kotlin. */
async function servedRoutes(): Promise<string[]> {
  const res = JSON.parse(await link!.ask({ op: "routes" })) as { routes: string[] };
  return res.routes;
}

describe("route de l'interface web (#400)", () => {
  test.skipIf(skip)("le HASH de l'URL porte la route", async () => {
    expect(await routeFromUrl(`${INDEX}#/grades`)).toBe("/grades");
    expect(await routeFromUrl(`${INDEX}#/pairing`)).toBe("/pairing");
    expect(await routeFromUrl(`${INDEX}#/`)).toBe("/");
  });

  test.skipIf(skip)("une URL sans hash n'est pas une route : c'est l'accueil", async () => {
    expect(await routeFromUrl(INDEX)).toBeNull();
    expect(await routeFromUrl(null)).toBeNull();
  });

  test.skipIf(skip)("un hash qui n'est pas un chemin n'est pas une route", async () => {
    expect(await routeFromUrl(`${INDEX}#grades`)).toBeNull();
    expect(await routeFromUrl(`${INDEX}#`)).toBeNull();
  });

  test.skipIf(skip)("les paramètres du fragment sont ignorés : c'est le CHEMIN", async () => {
    expect(await routeFromUrl(`${INDEX}#/grades?tab=1`)).toBe("/grades");
  });

  test.skipIf(skip)("une route hors contrat n'est jamais servie", async () => {
    // Le contrat est la liste des routes : la WebView ne sert pas d'écran
    // qui n'existe pas, et la restauration ne ramène pas l'utilisateur
    // dans un décor.
    expect(await routeFromUrl(`${INDEX}#/secret`)).toBeNull();
    expect(await routeFromUrl(`${INDEX}#/../etc/passwd`)).toBeNull();
  });

  // LE point de l'issue : le chemin de la route est CONSERVÉ dans l'état
  // sauvegardé, puis RELU tel quel.
  test.skipIf(skip)("le chemin survit à l'aller-retour par l'état sauvegardé", async () => {
    const path = await routeFromUrl(`${INDEX}#/attendance`);
    expect(path).toBe("/attendance");
    // Ce qui est écrit dans l'état de l'activité…
    expect(await routeFromState(path)).toBe("/attendance");
    // …et relu à l'identique, pour toutes les routes servies.
    for (const route of await servedRoutes()) {
      expect(await routeFromState(route)).toBe(route);
    }
  });

  test.skipIf(skip)("un chemin hors contrat relu de l'état est REFUSÉ", async () => {
    expect(await routeFromState("/secret")).toBeNull();
    expect(await routeFromState(null)).toBeNull();
  });

  test.skipIf(skip)("la liste des routes est celle de l'interface web", async () => {
    // L'interface React déclare ses routes dans `web/src/App.tsx` : la liste
    // native doit être la MÊME, sinon le repli renverrait l'utilisateur sur
    // l'accueil alors que son écran existe.
    const app = readFileSync(join(ROOT, "web", "src", "App.tsx"), "utf8");
    // La route « * » est le filet de sécurité du routeur (elle renvoie sur
    // l'accueil) : ce n'est pas une route servie.
    const web = [...app.matchAll(/<Route path="([^"]+)"/g)]
      .map((m) => m[1]!)
      .filter((route) => route !== "*")
      .sort();
    expect(web.length).toBeGreaterThanOrEqual(14);
    expect(await servedRoutes()).toEqual(web);
  });

  test.skipIf(skip)("l'accueil est une route, et l'état sauvegardé a une clé", async () => {
    const meta = JSON.parse(await link!.ask({ op: "meta" })) as { home: string; key: string };
    expect(meta.home).toBe("/");
    // La clé est STABLE : elle relie l'état sauvegardé à la route relue.
    expect(meta.key).toBe("fr.veryslopnynotes.app.route");
    expect(await routeFromState(meta.home)).toBe("/");
  });

  // La source de production est PUBLIQUE dans le module `app` : la logique
  // de route y est lue par l'activité ET par la WebView.
  test("la route vit dans un fichier PUR, lu par l'activité et la WebView", () => {
    const source = readFileSync(join(ROOT_APP, "WebRouteState.kt"), "utf8");
    expect(source).not.toMatch(/^import\s+android\./m);
    expect(source).toContain("fun routePathFromUrl");
    expect(source).toContain("fun routePathFromState");
    const activity = readFileSync(join(ROOT_APP, "MainActivity.kt"), "utf8");
    const shell = readFileSync(join(ROOT_APP, "WebApp.kt"), "utf8");
    expect(activity).toContain("routePathFromUrl");
    expect(activity).toContain("routePathFromState");
    expect(shell).toContain("WEB_ROUTES");
  });
});
