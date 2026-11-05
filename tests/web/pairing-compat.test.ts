// La compatibilité est une promesse visible : l'écran d'appairage annonce la
// limite avant le scan.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const SCREEN = readFileSync(join(ROOT, "web", "src", "features", "pairing", "PairingScreen.tsx"), "utf8");

describe("compatibilité annoncée", () => {
  test("l'écran d'appairage dit QR + PIN et l'absence de double authentification", () => {
    expect(SCREEN).toContain("QR + PIN uniquement");
    expect(SCREEN).toContain("double authentification");
  });
});
