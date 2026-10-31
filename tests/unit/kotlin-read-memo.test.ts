// Les lectures identiques ne sont plus redemandées à l'établissement : le VRAI
// `ClientBase.post` est rejoué avec un stub qui compte les requêtes.
// Outillage absent = SKIP BRUYANT.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "ReadMemoParityMain.kt");
const CLIENT = join(ROOT, "android/pronote/src/main/java/fr/veryslopnynotes/pronote/Client.kt");
const PAIRING = join(ROOT, "android/data/src/main/java/fr/veryslopnynotes/data/PairingRepository.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

interface Request {
  function: string;
  onglet?: number;
  payload?: Record<string, unknown>;
  now?: number;
  fail?: boolean;
}

interface RunResult {
  sends: number;
  functions: string[];
  memoSize: number;
}

async function run(memoize: boolean, requests: Request[]): Promise<RunResult> {
  const line = await link!.ask({ op: "run", memoize, requests });
  return JSON.parse(line) as RunResult;
}

const NOTES: Request = {
  function: "DernieresNotes",
  onglet: 198,
  payload: { Periode: { N: "1", L: "Trimestre 1" } },
};

describe("la mémo des lectures identiques (#473)", () => {
  test.skipIf(skip)("la mémo est désactivée par DÉFAUT", async () => {
    const line = await link!.ask({ op: "default" });
    const res = JSON.parse(line) as { memoEnabled: boolean };
    expect(res.memoEnabled).toBe(false);
  });

  test.skipIf(skip)("deux lectures identiques = une seule requête", async () => {
    const res = await run(true, [NOTES, NOTES]);
    expect(res.sends).toBe(1);
    expect(res.memoSize).toBe(1);
  });

  test.skipIf(skip)("trois lectures identiques (notes + moyennes + moyenne générale) = une requête", async () => {
    // Cas d'écran : `grades()`, `averages()` et `overallAverage()` postent la MÊME chose.
    const res = await run(true, [NOTES, NOTES, NOTES]);
    expect(res.sends).toBe(1);
  });

  test.skipIf(skip)("deux charges utiles différentes = deux requêtes", async () => {
    const res = await run(true, [
      NOTES,
      { ...NOTES, payload: { Periode: { N: "2", L: "Trimestre 2" } } },
    ]);
    expect(res.sends).toBe(2);
    expect(res.memoSize).toBe(2);
  });

  test.skipIf(skip)("un onglet différent = une autre requête", async () => {
    const res = await run(true, [NOTES, { ...NOTES, onglet: 19 }]);
    expect(res.sends).toBe(2);
  });

  test.skipIf(skip)("une écriture VIDE la mémo", async () => {
    const res = await run(true, [
      NOTES,
      { function: "SaisieTAFFaitEleve", onglet: 88, payload: { listeTAF: [] } },
      NOTES,
    ]);
    // L'écriture a vidé la mémo : la seconde lecture repart.
    expect(res.sends).toBe(3);
    expect(res.functions).toEqual(["DernieresNotes", "SaisieTAFFaitEleve", "DernieresNotes"]);
  });

  test.skipIf(skip)("une erreur n'est jamais mémoïsée", async () => {
    const res = await run(true, [{ ...NOTES, fail: true }, NOTES]);
    // L'échec n'a rien laissé dans la mémo : la lecture suivante repart.
    expect(res.sends).toBe(2);
    expect(res.memoSize).toBe(1);
  });

  test.skipIf(skip)("le TTL expire : au-delà d'une minute, on redemande", async () => {
    const res = await run(true, [
      { ...NOTES, now: 1_000 },
      { ...NOTES, now: 1_000 + 59_000 },
    ]);
    expect(res.sends).toBe(1);
    const after = await run(true, [
      { ...NOTES, now: 1_000 },
      { ...NOTES, now: 1_000 + 60_001 },
    ]);
    expect(after.sends).toBe(2);
  });

  test.skipIf(skip)("sans mémo, chaque lecture repart", async () => {
    const res = await run(false, [NOTES, NOTES]);
    expect(res.sends).toBe(2);
    expect(res.memoSize).toBe(0);
  });

  test("la session renouvelée vide la mémo", () => {
    // `refresh()` rejoue l'authentification : les lectures mémorisées repartent.
    const client = readFileSync(CLIENT, "utf8");
    const refresh = client.slice(client.indexOf("fun refresh("), client.indexOf("fun refresh(") + 2000);
    expect(refresh).toContain("readMemo?.clear()");
  });

  test("l'app active la mémo, le harnais de parité non", () => {
    // L'app veut la mémo ; la référence TS compare le FIL, mémo désactivée par défaut.
    const pairing = readFileSync(PAIRING, "utf8");
    expect(pairing).toContain("memoizeReads = true");
    const client = readFileSync(CLIENT, "utf8");
    expect(client).toContain("val memoizeReads: Boolean = false");
  });
});
