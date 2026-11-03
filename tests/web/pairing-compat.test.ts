// La compatibilité est une promesse visible : l'écran d'appairage annonce la
// limite avant le scan, et la matrice garde les refus explicites (mot de passe,
// MFA) au lieu de les découvrir en production.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const SCREEN = readFileSync(join(ROOT, "web", "src", "features", "pairing", "PairingScreen.tsx"), "utf8");
const MATRIX = readFileSync(join(ROOT, "docs", "COMPATIBILITY.md"), "utf8");

describe("compatibilité annoncée", () => {
  test("l'écran d'appairage dit QR + PIN et l'absence de double authentification", () => {
    expect(SCREEN).toContain("QR + PIN uniquement");
    expect(SCREEN).toContain("double authentification");
  });

  test("la matrice couvre les limites qui font refuser un compte", () => {
    for (const limite of ["Android 8.0+", "mot de passe", "MFA", "aucune version n'est épinglée", "scraper", "assistant"]) {
      expect({ limite, documentée: MATRIX.includes(limite) }).toEqual({ limite, documentée: true });
    }
  });
});
