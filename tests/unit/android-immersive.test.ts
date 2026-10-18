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
//     `enableEdgeToEdge`) = la fenêtre se peint SOUS le découpage, donc la
//     barre du haut doit consommer `displayCutout` ou son titre passe dessous ;
//   - l'ESPACE LIBÉRÉ : masquer la barre de statut libère sa hauteur, que la
//     barre du haut reprend (elle mesure la place, la garde et y recentre son
//     titre) au lieu de la laisser en bande vide.
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

  test("la barre du haut reste sous l'encoche (displayCutout consommé)", () => {
    // La coquille ne monte plus la `TopAppBar` de M3 (cf. #303 plus bas), donc
    // c'est SA rangée qui consomme le découpage — sur toute la barre, pas
    // seulement sous le titre. La marge vient de `displayCutout`, donc elle est
    // mesurée à l'exécution et pas devinée (#305 la répartit moitié au-dessus,
    // moitié au-dessous : cf. le test de centrage).
    expect(shell).toContain("WindowInsets.displayCutout.asPaddingValues(density)");
    expect(shell).toContain(".windowInsetsPadding(cutoutPadding)");
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

// #303 (suite) : la barre du haut reprend l'espace que la barre de statut
// occupait — 64 dp de contenu M3 + la hauteur mesurée, titre recentré dessous.
// Le masquage seul laissait une bande plus haute que son contenu : la barre
// grandissait sans que son titre en profite.
describe("unit barre du haut rehaussée (#303)", () => {
  test("hauteur de contenu = 64 dp M3 + l'espace repris", () => {
    expect(shell).toContain("private val TopBarContentHeight = 64.dp");
    expect(shell).toContain("(TopBarContentHeight + reclaimedTop).toPx()");
    expect(shell).toMatch(/reclaimedTop: Dp = 0\.dp,/);
  });

  test("la limite de repli suit la hauteur RÉELLE, pas les 64 dp de M3", () => {
    // Sans ça la rétraction s'arrêterait à -64 dp et laisserait l'espace repris
    // en bande de barre au défilement.
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

  test("l'espace repris est MESURÉ, pas inventé", () => {
    // `getInsetsIgnoringVisibility` : la hauteur de la barre de statut MÊME
    // MASQUÉE, la seule valeur qui reste vraie en plein écran.
    expect(activity).toContain(
      "insets.getInsetsIgnoringVisibility(WindowInsetsCompat.Type.statusBars()).top",
    );
    expect(activity).toContain("reclaimedTop.value = (");
    expect(activity).toContain("AppNav(baseUrlSeed = baseUrlSeed, reclaimedTop = reclaimedTop.value)");
  });

  test("la hauteur traverse la coquille jusqu'à la barre", () => {
    const nav = read(join(UI, "AppNav.kt"));
    expect(nav).toMatch(/reclaimedTop: Dp = 0\.dp,/);
    expect(nav).toContain("reclaimedTop = reclaimedTop,");
  });

  test("le module ui ne lit aucun inset de fenêtre hors découpage", () => {
    // La hauteur vient de l'activité (module `app`, qui a androidx.core) : `ui`
    // n'a pas à connaître les insets de fenêtre.
    expect({ core: shell.includes("WindowInsetsCompat") }).toEqual({ core: false });
  });

  // #305 : sans ça le contenu était centré dans la SEULE zone sous l'encoche et
  // tombait aux deux tiers de la barre (mesuré sur l'appareil : titre à 118 dp
  // sur 179 dp, au lieu des ~90 dp d'avant #303 et de la référence).
  test("le contenu est centré dans la barre ENTIÈRE, encoche comprise", () => {
    // Encoche posée en marges ÉGALES haut/bas : `windowInsetsPadding` centre le
    // contenu entre ses marges, donc des marges égales le centrent dans toute
    // la barre.
    expect(shell).toMatch(/top = cutout\.calculateTopPadding\(\) \/ 2,/);
    expect(shell).toMatch(/bottom = cutout\.calculateBottomPadding\(\) \/ 2,/);
    // Gauche et droite : l'encoche ENTIÈRE — en paysage elle est sur le côté,
    // la moitié y laisserait le contenu dessous.
    expect(shell).toMatch(/left = cutout\.calculateLeftPadding\(layoutDirection\),/);
    expect(shell).toMatch(/right = cutout\.calculateRightPadding\(layoutDirection\),/);
  });
});
