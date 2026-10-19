// #399 : le clavier logiciel ne masque plus un champ de saisie.
//
// L'activité est edge-to-edge (#135) et immersive (#303) : la fenêtre ne se
// redimensionne PAS quand le clavier s'ouvre. Sans traitement de l'inset IME,
// le clavier recouvre le champ « Code PIN du QR » — l'utilisateur tape un PIN
// qu'il ne voit pas — et la barre d'onglets disparaît sous le clavier.
//
// Ce test lit le MANIFESTE et l'ACTIVITÉ réels (jamais une copie) : il échoue
// dès qu'on retire l'un des deux volets du correctif.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";

const ROOT = join(import.meta.dir, "..", "..");
const MANIFEST = join(ROOT, "android/app/src/main/AndroidManifest.xml");
const ACTIVITY = join(ROOT, "android/app/src/main/java/fr/veryslopnynotes/app/MainActivity.kt");

/** Attributs `android:` de l'élément `<activity>` de MainActivity. */
function mainActivityAttrs(xml: string): Map<string, string> {
  const tag = /<activity\s+android:name="\.MainActivity"([^>]*)>/.exec(xml)?.[1] ?? "";
  const attrs = new Map<string, string>();
  for (const m of tag.matchAll(/android:([A-Za-z]+)="([^"]*)"/g)) attrs.set(m[1]!, m[2]!);
  return attrs;
}

describe("clavier logiciel et zone de saisie (#399)", () => {
  test("le manifeste déclare un windowSoftInputMode compatible clavier", () => {
    const attrs = mainActivityAttrs(readFileSync(MANIFEST, "utf8"));
    // `adjustResize` : la fenêtre se réduit pour le clavier. Sur les versions
    // récentes (edge-to-edge, targetSdk ≥ 35) la fenêtre ne se redimensionne
    // plus : c'est alors l'inset IME qui fait le travail (test suivant). Le
    // manifeste reste la déclaration EXPLICITE du contrat clavier.
    expect(attrs.get("windowSoftInputMode")).toBe("adjustResize");
  });

  test("les insets IME sont appliqués au conteneur de la WebView", () => {
    const code = codeOnly(readFileSync(ACTIVITY, "utf8"));
    // L'inset du CLAVIER (`Type.ime()`), pas celui des barres système : ce
    // sont les barres qui changent de taille ici, et l'inset clavier vaut 0
    // quand le clavier est fermé (le padding retombe à 0 tout seul).
    expect(code).toContain("ViewCompat.setOnApplyWindowInsetsListener");
    expect(code).toContain("WindowInsetsCompat.Type.ime()");
    // Il devient le PADDING BAS du conteneur : la zone visible de la WebView
    // s'arrête au-dessus du clavier.
    expect(code).toMatch(/updatePadding\(bottom = ime\.bottom\)/);
  });

  test("le conteneur qui rétrécit est bien celui qui porte la WebView", () => {
    const code = codeOnly(readFileSync(ACTIVITY, "utf8"));
    // C'est la WebView qui doit rétrécir (sa zone visible s'arrête au-dessus
    // du clavier) : le padding est donc sur le conteneur qui la porte, pas
    // sur la fenêtre elle-même.
    expect(code).toContain("setContentView(container)");
    expect(code).toMatch(/addView\(\s*shell\.view/);
    expect(code).toContain("applyImeInsets(container)");
  });
});
