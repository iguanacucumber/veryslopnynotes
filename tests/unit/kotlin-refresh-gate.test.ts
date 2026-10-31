// Le rafraîchissement de session est ATOMIQUE : deux threads lisaient `false` et
// déclenchaient deux `Communication` (cookies, compteurs, clé AES mélangée → G=25).
// La VRAIE source est compilée et pilotée ; outillage absent = SKIP BRUYANT.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "RefreshGateParityMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

interface Race {
  winners: number;
  losers: number;
  held: boolean;
}

interface Sequence {
  first: boolean;
  second: boolean;
  heldDuring: boolean;
  third: boolean;
  heldAfter: boolean;
  caught: boolean;
  reentered: boolean;
}

async function race(threads: number): Promise<Race> {
  return JSON.parse(await link!.ask({ op: "race", threads })) as Race;
}

async function sequence(): Promise<Sequence> {
  return JSON.parse(await link!.ask({ op: "sequence" })) as Sequence;
}

describe("porte de rafraîchissement (#405)", () => {
  test.skipIf(skip)("N threads en même temps : UN SEUL rafraîchissement", async () => {
    // Job de fond + interface en erreur en même temps : un seul doit rafraîchir.
    for (const threads of [2, 4, 8]) {
      const r = await race(threads);
      // UN gagnant (le CAS `compareAndSet`), les autres perdants.
      expect({ threads, winners: r.winners }).toEqual({ threads, winners: 1 });
      expect({ threads, losers: r.losers }).toEqual({ threads, losers: threads - 1 });
      // La porte est rendue à la fin (le `finally` du client).
      expect(r.held).toBe(false);
    }
  });

  test.skipIf(skip)("la porte se rend : un refresh raté ne bloque pas les suivants", async () => {
    const s = await sequence();
    // Prise : `true` ; une seconde tentative pendant le refresh : `false`.
    expect(s.first).toBe(true);
    expect(s.second).toBe(false);
    expect(s.heldDuring).toBe(true);
    // Rendue : on peut la reprendre.
    expect(s.third).toBe(true);
    expect(s.heldAfter).toBe(true);
    // Une EXCEPTION rend la porte malgré tout : le refresh suivant peut repartir.
    expect(s.caught).toBe(true);
    expect(s.reentered).toBe(true);
  });
});
