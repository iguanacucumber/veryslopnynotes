// #872 : encoche, barres système et gestes ne doivent jamais recouvrir le
// contenu. Test de SOURCE (pas d'appareil en CI) : les insets lus, le chemin
// clavier (padding du conteneur), la publication CSS et la fenêtre libre.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";

const ROOT = join(import.meta.dir, "..", "..");
const APP = join(ROOT, "android/app/src/main/java/fr/veryslopnynotes/app");
const read = (p: string) => readFileSync(p, "utf8");
const activity = codeOnly(read(join(APP, "MainActivity.kt")));
const shell = codeOnly(read(join(APP, "WebApp.kt")));
const manifest = read(join(ROOT, "android/app/src/main/AndroidManifest.xml"));
const design = read(join(ROOT, "DESIGN.md"));

describe("unit android insets et encoches (#872)", () => {
  test("les quatre sources d'insets sont lues, pas seulement le clavier", () => {
    expect(activity).toContain("WindowInsetsCompat.Type.displayCutout()");
    expect(activity).toContain("WindowInsetsCompat.Type.systemBars()");
    expect(activity).toContain("WindowInsetsCompat.Type.systemGestures()");
    expect(activity).toContain("WindowInsetsCompat.Type.ime()");
  });

  test("chaque côté prend le maximum : une zone sûre ne s'additionne pas", () => {
    expect(activity).toMatch(/left\s*=\s*maxOf\(cutout\.left, bars\.left\)/);
    expect(activity).toMatch(/top\s*=\s*maxOf\(cutout\.top, bars\.top\)/);
    expect(activity).toMatch(/right\s*=\s*maxOf\(cutout\.right, bars\.right\)/);
    expect(activity).toMatch(
      /bottom\s*=\s*maxOf\(cutout\.bottom, bars\.bottom, gestures\.bottom\)/,
    );
  });

  test("le clavier rétrécit le conteneur, les zones sûres partent au CSS", () => {
    // L'IME est un layout : padding natif, jamais une variable CSS qui
    // ferait aussi rétrécir la coquille une seconde fois.
    expect(activity).toContain("updatePadding(bottom = ime.bottom)");
    expect(activity).toContain("publishSafeArea(safeArea(insets))");
    expect(shell).toContain("data class SafeArea");
    for (const côté of ["left", "top", "right", "bottom"]) {
      expect(shell).toContain(`--native-safe-${côté}`);
    }
    expect(shell).toContain("setProperty");
  });

  test("les zones sûres sont rejouées après un chargement ou un rechargement", () => {
    // L'écran de secours recharge la page : un document neuf perd les variables.
    expect(shell).toMatch(
      /override fun onPageFinished\([\s\S]*?applySafeArea\(\)[\s\S]*?onFirstPaint\(\)/,
    );
    expect(shell).toMatch(/private fun onFirstPaint\([\s\S]*?applySafeArea\(\)/);
  });

  test("fenêtres libres et grands écrans : redimensionnable, clavier en adjustResize", () => {
    expect(manifest).toContain('android:resizeableActivity="true"');
    expect(manifest).toContain('android:windowSoftInputMode="adjustResize"');
    expect(design).toContain("fenêtres libres");
    expect(design).toContain("--native-safe-*");
    expect(design).toContain("700 px");
  });
});
