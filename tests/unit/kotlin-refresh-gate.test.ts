// #405 : le rafraîchissement de session est ATOMIQUE.
//
// `ClientBase._refreshing` était un `var Boolean` nu : deux threads (le job de
// fond et la lecture de l'interface) lisaient `false` en même temps et
// déclenchaient DEUX rafraîchissements — donc deux `Communication` (deux
// cookies, deux compteurs de requêtes), le champ finissant sur celle qui avait
// fini la dernière, et les requêtes entrelacées (clé AES mélangée). Le serveur
// répondait alors `G=25` « Exceeded max authorization requests ».
//
// Ce test ne Miroite pas la logique : il COMPILE la VRAIE source de production
// (`android/pronote/.../RefreshGate.kt`, Kotlin pur) et la pilote via
// `agents/runtime/kotlin-parity/RefreshGateParityMain.kt`. Les assertions
// portent donc sur du code EXÉCUTÉ.
//
// Outillage `kotlinc`/`java` absent = SKIP BRUYANT du harnais (jamais un faux
// vert) ; un échec de compilation, lui, est un défaut (le test rougit).
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
    // Le cas du job de fond + la lecture de l'interface : les deux tombent en
    // erreur en MÊME temps. Un seul doit rafraîchir.
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
    // Prise : `true`. Une seconde tentative pendant le refresh : `false`
    // (c'est ce qui empêche le login du refresh de re-déclencher un refresh).
    expect(s.first).toBe(true);
    expect(s.second).toBe(false);
    expect(s.heldDuring).toBe(true);
    // Rendue : on peut la reprendre.
    expect(s.third).toBe(true);
    expect(s.heldAfter).toBe(true);
    // Une EXCEPTION pendant le refresh : la porte est rendue malgré tout, et
    // le refresh suivant peut repartir.
    expect(s.caught).toBe(true);
    expect(s.reentered).toBe(true);
  });
});
