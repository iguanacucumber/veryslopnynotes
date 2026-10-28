// #399 : le clavier logiciel ne masque plus un champ de saisie.
//
// L'activité est edge-to-edge (#135) et immersive (#303) : la fenêtre ne se
// redimensionne PAS quand le clavier s'ouvre. Sans traitement de l'inset IME,
// le clavier recouvre le champ « Code PIN du QR » — l'utilisateur tape un PIN
// qu'il ne voit pas — et la barre d'onglets disparaît sous le clavier.
//
// Ce test garde le CONTRAT du manifeste (déclaration explicite du clavier).
// L'application de l'inset dans l'activité n'est plus épinglée au texte des
// appels : un refactor à comportement identique doit passer. Ce câblage reste
// une convention de relecture.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const MANIFEST = join(ROOT, "android/app/src/main/AndroidManifest.xml");

/** Attributs `android:` de l'élément `<activity>` de MainActivity. */
function mainActivityAttrs(xml: string): Map<string, string> {
  // L'ordre des attributs est libre : on cherche la BALISE qui porte le nom,
  // pas une suite d'attributs figée.
  const tag = /<activity\b[^>]*android:name="\.MainActivity"[^>]*>/.exec(xml)?.[0] ?? "";
  const attrs = new Map<string, string>();
  for (const m of tag.matchAll(/android:([A-Za-z]+)="([^"]*)"/g)) attrs.set(m[1]!, m[2]!);
  return attrs;
}

describe("clavier logiciel et zone de saisie (#399)", () => {
  test("le manifeste déclare un windowSoftInputMode compatible clavier", () => {
    const attrs = mainActivityAttrs(readFileSync(MANIFEST, "utf8"));
    // `adjustResize` : la fenêtre se réduit pour le clavier. Sur les versions
    // récentes (edge-to-edge, targetSdk ≥ 35) la fenêtre ne se redimensionne
    // plus : c'est alors l'inset IME qui fait le travail. Le manifeste reste
    // la déclaration EXPLICITE du contrat clavier.
    expect(attrs.get("windowSoftInputMode")).toBe("adjustResize");
  });
});
