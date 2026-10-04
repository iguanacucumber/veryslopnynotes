import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// agents/runtime/shot.sh + deep links de debug (issue #133). La capture
// déterministe repose sur TROIS listes de routes qui doivent rester d'accord :
//   1. les `composable(...)` + `navDeepLink` de AppNav.kt (le graphe de nav),
//   2. les `<data android:host>` du manifest DEBUG (qui rend l'URL ouvrable),
//   3. les marqueurs d'écran de shot.sh (qui prouvent l'arrivée sur la route).
// Un oubli dans l'une des trois ne plante rien : la capture revient SANS
// l'écran demandé, ou pire avec l'écran de départ. Ces tests sont donc la
// seule chose qui(attrape la dérive) — sans téléphone, sans adb.
const ROOT = join(import.meta.dir, "..", "..");
const APP_NAV = readFileSync(
  join(ROOT, "android/ui/src/main/java/fr/veryslopnynotes/ui/AppNav.kt"),
  "utf8",
);
const DEBUG_MANIFEST = readFileSync(
  join(ROOT, "android/app/src/debug/AndroidManifest.xml"),
  "utf8",
);
const MAIN_MANIFEST = readFileSync(
  join(ROOT, "android/app/src/main/AndroidManifest.xml"),
  "utf8",
);
const SHOT = readFileSync(join(ROOT, "agents/runtime/shot.sh"), "utf8");

/** Valeur des `const val ROUTE_X = "x"` (les onglets sont nommés, pas en dur). */
function routeConst(name: string): string {
  const m = new RegExp(`const val ${name} = "([^"]+)"`).exec(APP_NAV);
  if (!m) throw new Error(`const ${name} introuvable dans AppNav.kt`);
  return m[1]!;
}

/** Toutes les destinations déclarées, résolues : `composable(ROUTE_X)` ou `composable("litéral")`. */
function allRoutes(): string[] {
  const out: string[] = [];
  const re = /composable\(\s*(ROUTE_[A-Z]+|"([a-z]+)")\s*,/g;
  for (const m of APP_NAV.matchAll(re)) {
    out.push(m[1]!.startsWith('"') ? m[2]! : routeConst(m[1]!));
  }
  return out;
}

const ROUTES = allRoutes();

describe("deep links de debug (#133)", () => {
  test("chaque composable de AppNav.kt déclare un navDeepLink sur sa route", () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(14);
    // Sans `deepLinks`, l'URL est reconnue par le manifest mais ignorée par le
    // graphe : l'app s'ouvre sur son écran de départ, en silence.
    const sansDeepLink = [...APP_NAV.matchAll(/composable\(\s*(ROUTE_[A-Z]+|"[a-z]+")\s*,(?![^)]*deepLinks)/g)]
      .map(m => m[1]!.startsWith('"') ? m[1].slice(1, -1) : routeConst(m[1]!));
    expect(sansDeepLink).toEqual([]);
  });

  test("chaque route est un hôte du manifest DEBUG (sinon am start échoue)", () => {
    for (const route of ROUTES) {
      expect(DEBUG_MANIFEST).toContain(`<data android:host="${route}" />`);
    }
    // Un hôte de trop ouvrirait un écran qui n'existe pas : l'URL est alors
    // muette et l'app s'ouvre sur son écran de départ.
    const hosts = [...DEBUG_MANIFEST.matchAll(/android:host="([a-z]+)"/g)].map(m => m[1]!);
    expect(hosts.sort()).toEqual([...ROUTES].sort());
  });

  test("le manifest DEBUG force singleTask et déclare VIEW/BROWSABLE", () => {
    // standard + URL = nouvelle instance au-dessus de la tâche courante :
    // deux écrans superposés, la capture montre l'ancien.
    expect(DEBUG_MANIFEST).toContain('android:launchMode="singleTask"');
    expect(DEBUG_MANIFEST).toContain('android:scheme="veryslopnynotes"');
    expect(DEBUG_MANIFEST).toContain("android.intent.action.VIEW");
    expect(DEBUG_MANIFEST).toContain("android.intent.category.BROWSABLE");
  });

  test("le manifeste MAIN (donc la release) n'a AUCUN deep link", () => {
    // L'invariant derrière tout le reste : l'APK publiable ne répond à aucune
    // URL extérieure. Un intent-filter VIEW ici ouvrirait l'app depuis un site.
    expect(MAIN_MANIFEST).not.toContain("android.intent.action.VIEW");
    expect(MAIN_MANIFEST).not.toContain("veryslopnynotes://");
    expect(MAIN_MANIFEST).not.toContain('android:launchMode="singleTask"');
    // Seul le filtre LAUNCHER reste, comme avant #133.
    expect(MAIN_MANIFEST).toContain("android.intent.category.LAUNCHER");
    expect((MAIN_MANIFEST.match(/<intent-filter>/g) ?? []).length).toBe(1);
  });
});

describe("shot.sh (#133)", () => {
  test("chaque route a un marqueur d'écran, sinon la capture n'est pas prouvée", () => {
    // route_marker() sert aussi de liste blanche : une route sans marqueur est
    // refusée AVANT toute écriture, sinon shot.sh capturerait l'écran de
    // départ en annonçant une réussite.
    // `printf '…'` (littéral) ou `printf "$PROFILE_MARKER"` (marcateur commun).
    const sansMarqueur = ROUTES.filter(r => !new RegExp(`^\\s+${r}\\) printf ['"]`, "m").test(SHOT));
    expect(sansMarqueur).toEqual([]);
    expect(SHOT).toContain('printf \'\' ;;');
  });

  test("lance par deep link, force-stop d'abord, et échoue bruyamment", () => {
    expect(SHOT).toContain("set -euo pipefail");
    // Sans arrêt forcé, onNewIntent est ignoré (le NavController ne se
    // reconstruit pas) : la capture montre l'écran précédent, en silence.
    expect(SHOT).toContain("am force-stop");
    expect(SHOT).toContain('"$SCHEME://$ROUTE"');
    // Chaque refus nomme ce qui N'A PAS été fait, et sort non nul.
    for (const refusal of [
      "aucun appareil prêt", // pas d'appareil
      "route inconnue", // route fantôme
      "n'est pas installé", // référence absente
      "capture NOIRE", // écran éteint
      "VERROUILLÉ", // code d'appareil
      "APPAIRAGE", // session absente
      "N'EST PAS atteinte", // mauvais écran
      "instal", // refus d'installation
    ]) {
      expect({ refus: refusal, present: SHOT.includes(refusal) }).toEqual({
        refus: refusal,
        present: true,
      });
    }
  });

  test("détecte l'image noire et réveille l'écran avant de conclure", () => {
    // Une capture non contrôlée ne vaut rien : trois outils essayés dans
    // l'ordre, et échec si aucun n'est là.
    // Trois outils, un seul import : ImageMagick d'abord (lit le PNG), puis
    // ffmpeg et enfin bun/node sur le tampon BRUT (ce ffmpeg ne décode pas le
    // PNG). Aucun disponible = la capture est REFUSÉE, pas acceptée.
    const corps = SHOT.slice(SHOT.indexOf("blank_verdict()"));
    expect(corps.indexOf("command -v identify")).toBeLessThan(corps.indexOf("command -v ffmpeg"));
    expect(corps.indexOf("command -v ffmpeg")).toBeLessThan(corps.indexOf("for rt in bun node"));
    expect(corps).toContain("die ");
    // Éteint = réveil + UNE nouvelle tentative, jamais une capture acceptée.
    expect(corps).toContain("KEYCODE_WAKEUP");
    expect(SHOT).toContain("svc power stayon true");
  });

  test("ne désinstalle jamais l'app (la session appairée vaut un QR)", () => {
    // Une désinstallation effacerait la session appairée (QR à rescaner) : le
    // script doit échouer et laisser l'utilisateur trancher.
    expect(SHOT).not.toMatch(/^\s*(adb|a)\s+(shell\s+)?pm\s+(uninstall|clear)/m);
    expect(SHOT).not.toMatch(/^\s*(adb|a)\s+uninstall/m);
  });

  test("les captures et les frames de référence ne sont jamais commitées", () => {
    const gitignore = readFileSync(join(ROOT, ".gitignore"), "utf8");
    // L'écran d'accueil de l'appareil affiche le vrai nom, l'établissement,
    // les devoirs et les notes : jamais dans le dépôt.
    expect(gitignore).toContain("/shots/");
    expect(gitignore).toContain("/ref-papillon/");
  });

  test("la cible make shot passe par la découverte partagée et exige ROUTE", () => {
    const makefile = readFileSync(join(ROOT, "Makefile"), "utf8");
    expect(makefile).toContain("shot:");
    expect(makefile).toContain("agents/runtime/shot.sh $(ROUTE)");
    expect(makefile).toMatch(/if \[ -z "\$\(ROUTE\)" \]/);
    expect(makefile).toContain("android_toolchain_hint");
  });
});