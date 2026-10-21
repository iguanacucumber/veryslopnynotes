// Le mode d'ouverture d'une session persistée.
//
// AVANT : la session se rouvrait TOUJOURS par son jeton (`Client.tokenLogin`).
// L'établissement de démonstration n'a pas de jeton — c'est un couple
// identifiant / mot de passe public — donc sa session devait être rouverte
// autrement.
//
// CE QUE CE TEST PROUVE (deux niveaux) :
//   1. la DÉCISION, sur le VRAI Kotlin exécuté (`data/SessionMode.kt` est
//      compilé par le port de parité) : une session de démonstration se rouvre
//      par identifiant, une session d'appairage par jeton, et une valeur
//      absente ou INCONNUE reste « jeton » (une session enregistrée avant
//      l'existence de la démonstration ne doit pas changer de mode) ;
//   2. le CÂBLAGE : le dépôt publie le mode de la session de démonstration et
//      la restauration s'en sert — sans quoi la décision pure serait orpheline.
//
// Outillage `kotlinc`/`java` absent = SKIP BRUYANT du harnais (jamais un faux
// vert) ; un échec de compilation est un défaut (le test rougit).
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
    // Session enregistrée avant l'existence de la démonstration : elle se
    // rouvre par son jeton, comme toujours.
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
