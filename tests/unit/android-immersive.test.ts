// Plein écran immersif #303 : les barres SYSTÈME (statut en haut, navigation
// en bas) sont masquées au profit du contenu ; les barres de l'APP (barre du
// haut, barre d'onglets) restent, sinon on perdrait le titre et les onglets.
//
// Pourquoi un test de SOURCE ici : `make check` ne lance ni émulateur ni
// instrumentation, donc la seule preuve automatique disponible est cette
// lecture du Kotlin. Elle vise exactement ce qu'une régression casserait :
//   - `systemBars()` et non `statusBars()` seuls : masquer le haut sans le bas
//     (ou l'inverse) laissait une barre système à l'écran ;
//   - la RÉVÉLATION TRANSITOIRE : sans
//     `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`, la barre révélée par un geste de
//     bord restait affichée pour de bon ;
//   - `WindowCompat` et non `systemUiVisibility` : minSdk 26, et l'API
//     dépréciée ne règle pas la révélation transitoire ;
//   - l'encoche : barre de statut masquée + `SHORT_EDGES` (posé par
//     `enableEdgeToEdge`) = la fenêtre se peint SOUS le découpage. Les CÔTÉS
//     sont consommés (découpe en paysage) ; le haut ne l'est pas : une découpe
//     haute est au centre de la barre, où il n'y a rien ;
//   - la HAUTEUR : la barre garde les 64 dp de M3. Son contenu est donc centré
//     à 32 dp du bord, la ligne du poinçon (#323) — pas de bande vide au-dessus
//     et pas de barre rallongée sous l'encoche (#305).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";

const ROOT = join(import.meta.dir, "..", "..");
const APP = join(ROOT, "android/app/src/main/java/fr/veryslopnynotes/app");
const UI = join(ROOT, "android/ui/src/main/java/fr/veryslopnynotes/ui");
const read = (p: string) => codeOnly(readFileSync(p, "utf8"));
const activity = read(join(APP, "MainActivity.kt"));
const shell = read(join(UI, "AppShell.kt"));

describe("unit android plein écran immersif (#303)", () => {
  test("barres système masquées : statut ET navigation, jamais une seule", () => {
    // `Type.systemBars()` = statusBars + navigationBars : une seule porte, donc
    // pas de variante « haut seulement » possible.
    expect(activity).toContain("hide(WindowInsetsCompat.Type.systemBars())");
    // La fenêtre reste edge-to-edge (bandes transparentes, découpage SHORT_EDGES).
    expect(activity).toContain("enableEdgeToEdge()");
  });

  test("la barre révélée par un geste de bord est transitoire", () => {
    expect(activity).toContain(
      "systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE",
    );
  });

  test("re-masquage à chaque reprise de focus (retour de scan, fermeture de dialogue)", () => {
    // La plateforme réinitialise la visibilité des barres quand la fenêtre
    // reprend le focus : le masquage doit être rejoué là, pas seulement au
    // démarrage.
    expect(activity).toMatch(/override fun onWindowFocusChanged\(hasFocus: Boolean\)[\s\S]*?if \(hasFocus\) hideSystemBars\(\)/);
  });

  test("chemin compatible minSdk 26 : WindowCompat, pas l'API dépréciée", () => {
    expect(activity).toContain("WindowCompat.getInsetsController(window, window.decorView)");
    // `systemUiVisibility` ne règle pas la révélation transitoire et disparaît
    // au fil des versions : le chemin compatible est le seul écrit.
    expect({ deprecated: activity.includes("systemUiVisibility") }).toEqual({ deprecated: false });
  });

  test("la barre du haut ne passe pas sous une encoche latérale (côtés consommés)", () => {
    // #323 : la coquille ne monte plus la `TopAppBar` de M3 (cf. #303 plus bas),
    // donc c'est SA rangée qui consomme le découpage. Seuls les CÔTÉS sont
    // consommés : une découpe haute (poinçon) est au centre de la barre, où il
    // n'y a rien, et son inset vaut la barre de statut entière.
    expect(shell).toContain("WindowInsets.displayCutout.only(WindowInsetsSides.Horizontal)");
    expect(shell).toContain(".windowInsetsPadding(cutout)");
  });

  test("les barres de l'app ne sont PAS touchées (titre et onglets conservés)", () => {
    // Le masquage vise `WindowInsetsCompat.Type.systemBars()`, pas les
    // composables de la coquille : les deux barres de l'app sont toujours
    // montées par `AppNav`.
    const nav = read(join(UI, "AppNav.kt"));
    for (const bar of ["AppTopBar(", "AppTabBar("]) {
      expect({ bar, mounted: nav.includes(bar) }).toEqual({ bar, mounted: true });
    }
  });
});

// #323 : la barre du haut garde la hauteur de M3 (64 dp) et n'y ajoute RIEN.
// #305 l'avait rallongée de la barre de statut masquée, ce qui la faisait
// déborder sous le poinçon ; centré dans 64 dp, le contenu tombe sur la ligne
// de la caméra (mesuré sur l'appareil : centre du poinçon à 32,7 dp).
describe("unit barre du haut à hauteur M3 (#323)", () => {
  test("hauteur de contenu = 64 dp M3, sans espace repris", () => {
    expect(shell).toContain("private val TopBarContentHeight = 64.dp");
    expect(shell).toContain("with(density) { TopBarContentHeight.toPx() }");
    // Plus aucune hauteur empruntée à la barre de statut, dans aucun module.
    for (const [name, src] of [
      ["shell", shell],
      ["nav", read(join(UI, "AppNav.kt"))],
      ["activity", activity],
    ] as const) {
      expect({ name, reclaimed: src.includes("reclaimedTop") }).toEqual({ name, reclaimed: false });
    }
  });

  test("aucune marge verticale d'encoche : le contenu est centré dans les 64 dp", () => {
    // Une marge haute (même la moitié de l'inset) poussait le titre sous le
    // poinçon et rallongeait la barre — c'est ce que #305/#307 avaient fait.
    expect(shell).toContain("only(WindowInsetsSides.Horizontal)");
    expect({ vertical: shell.includes("calculateTopPadding") }).toEqual({ vertical: false });
    expect({ vertical: shell.includes("calculateBottomPadding") }).toEqual({ vertical: false });
  });

  test("la limite de repli suit la hauteur RÉELLE de la barre", () => {
    expect(shell).toMatch(
      /state\.heightOffsetLimit != -contentHeightPx[\s\S]{0,120}state\.heightOffsetLimit = -contentHeightPx/,
    );
  });

  test("la barre libère sa place au lieu de la recouvrir (repli et geste)", () => {
    // La hauteur de la rangée suit le repli : c'est ce que le `Scaffold` mesure
    // pour remonter l'écran.
    expect(shell).toContain("(contentHeightPx + state.heightOffset).coerceAtLeast(0f).toDp()");
    expect(shell).toContain("state = rememberDraggableState { delta -> state.heightOffset += delta }");
  });

  test("le module ui ne lit aucun inset de fenêtre hors découpage", () => {
    // Les insets de fenêtre (barre de statut) ne concernent pas `ui` : elle ne
    // lit que le découpage, dont les côtés sont consommés.
    expect({ core: shell.includes("WindowInsetsCompat") }).toEqual({ core: false });
  });
});
