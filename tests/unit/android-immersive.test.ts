// Plein écran immersif #303 : les barres SYSTÈME (statut en haut, navigation
// en bas) sont masquées au profit du contenu de la WebView.
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
//     dépréciée ne règle pas la révélation transitoire.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";

const ROOT = join(import.meta.dir, "..", "..");
const APP = join(ROOT, "android/app/src/main/java/fr/veryslopnynotes/app");
const read = (p: string) => codeOnly(readFileSync(p, "utf8"));
const activity = read(join(APP, "MainActivity.kt"));

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

  test("la WebView est le contenu unique, sans navigation Compose", () => {
    // #399 : la WebView vit dans un CONTENEUR (padding bas = inset du
    // clavier), mais c'est toujours ELLE qui est le contenu : aucune
    // navigation Compose, un seul écran.
    expect(activity).toContain("setContentView(container)");
    expect(activity).toMatch(/addView\(\s*shell\.view/);
    expect(activity).not.toContain("setContent {");
    expect(activity).not.toContain("AppNav");
  });
});
