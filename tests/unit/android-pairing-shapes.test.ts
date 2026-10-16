import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Formes d'appairage (#258) : faits de la référence, pas des goûts.
const UI = join(import.meta.dir, "..", "..", "android/ui/src/main/java/fr/veryslopnynotes/ui");
const pairing = () => readFileSync(join(UI, "PairingScreen.kt"), "utf8");

describe("appairage formes (#258)", () => {
  test("champs en 16 dp (TextInput de référence), boutons en 50 dp (Button de référence)", () => {
    const src = pairing();
    // Les deux champs (URL, PIN) : 16 dp, pas le 8 dp par défaut.
    expect((src.match(/shape = MaterialTheme\.shapes\.medium,/g) ?? []).length).toBe(2);
    // Les trois boutons (Continuer, Scanner, Terminer) : 50 dp de haut.
    expect((src.match(/\.height\(50\.dp\)/g) ?? []).length).toBe(3);
  });
});
