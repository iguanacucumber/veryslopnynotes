// Le clavier logiciel ne doit pas masquer un champ de saisie : l'activité est
// edge-to-edge et immersive, donc la fenêtre ne se redimensionne PAS et le
// clavier recouvrirait le champ « Code PIN du QR » sans traitement de l'inset IME.
//
// Ce test garde le CONTRAT du manifeste ; l'application de l'inset dans
// l'activité reste une convention de relecture, pour qu'un refactor passe.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const MANIFEST = join(ROOT, "android/app/src/main/AndroidManifest.xml");

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
    // `adjustResize` : sur edge-to-edge (targetSdk ≥ 35) la fenêtre ne se
    // redimensionne plus, c'est l'inset IME qui fait le travail ; le manifeste
    // reste la déclaration EXPLICITE du contrat.
    expect(attrs.get("windowSoftInputMode")).toBe("adjustResize");
  });
});
