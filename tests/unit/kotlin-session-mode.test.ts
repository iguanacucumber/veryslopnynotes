// Le mode d'ouverture d'une session persistée : démonstration → identifiant,
// appairage → jeton, valeur absente ou inconnue → jeton (comme avant).
// La DÉCISION est EXÉCUTÉE (`SessionMode.kt`) ; le CÂBLAGE est lu en source.
// Outillage absent = SKIP BRUYANT.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "SessionModeMain.kt");
const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

/** Le mode de réouverture, tel que le VRAI Kotlin le décide. */
async function mode(stored: string | null): Promise<string> {
  const res = JSON.parse(await link!.ask({ op: "mode", stored })) as { mode: string };
  return res.mode;
}

describe("mode d'ouverture d'une session persistée", () => {
  test.skipIf(skip)("démonstration = identifiant, appairage = jeton (Kotlin)", async () => {
    expect(await mode("identifiant")).toBe("identifiant");
    expect(await mode("jeton")).toBe("jeton");
  });

  test.skipIf(skip)("une valeur absente ou inconnue reste « jeton » (Kotlin)", async () => {
    // Session enregistrée avant la démonstration : elle se rouvre par son jeton.
    expect(await mode(null)).toBe("jeton");
    // Valeur corrompue : le mode par défaut, jamais un mode au hasard.
    expect(await mode("n'importe quoi")).toBe("jeton");
    expect(await mode("")).toBe("jeton");
  });

  test("le dépôt PUBLIE le mode et la restauration s'en sert", () => {
    const repo = codeOnly(readFileSync(join(DATA, "PairingRepository.kt"), "utf8"));
    // La session de démonstration est publiée en mode « identifiant ».
    expect(repo).toContain("SessionMode.IDENTIFIANT");
    // L'appairage QR reste en mode « jeton ».
    expect(repo).toContain("SessionMode.JETON");
    // La restauration choisit la réouverture selon le mode persisté.
    expect(repo).toContain("SessionMode.of(stored.mode)");
    expect(repo).toContain("Client.login(");
    expect(repo).toContain("Client.tokenLogin(");
  });

  test("le store PERSISTE le mode de la session", () => {
    const store = codeOnly(readFileSync(join(DATA, "SessionStore.kt"), "utf8"));
    expect(store).toContain("KEY_MODE");
    expect(store).toContain("SessionMode.of(");
  });
});
