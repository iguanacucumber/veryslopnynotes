// Plein écran immersif : les barres SYSTÈME sont masquées au profit de la WebView.
// Test de SOURCE (pas d'émulateur en CI) : `systemBars()`, révélation transitoire,
// et `WindowCompat` plutôt que `systemUiVisibility` déprécié.
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
    // `Type.systemBars()` = status + navigation : pas de variante « haut seulement ».
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
    // La plateforme réinitialise les barres à la reprise du focus : le masquage est rejoué.
    expect(activity).toMatch(/override fun onWindowFocusChanged\(hasFocus: Boolean\)[\s\S]*?if \(hasFocus\) hideSystemBars\(\)/);
  });

  test("chemin compatible minSdk 26 : WindowCompat, pas l'API dépréciée", () => {
    expect(activity).toContain("WindowCompat.getInsetsController(window, window.decorView)");
    // `systemUiVisibility` ne règle pas la révélation transitoire : seul le chemin compatible est écrit.
    expect({ deprecated: activity.includes("systemUiVisibility") }).toEqual({ deprecated: false });
  });

  test("la WebView est le contenu unique, sans navigation Compose", () => {
    // La WebView vit dans un conteneur, mais reste le contenu : aucune navigation Compose.
    expect(activity).toContain("setContentView(container)");
    expect(activity).toMatch(/addView\(\s*shell\.view/);
    expect(activity).not.toContain("setContent {");
    expect(activity).not.toContain("AppNav");
  });
});
