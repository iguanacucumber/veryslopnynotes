// #397 : le rejet d'une session MORTE purge la session ET le cache.
//
// Le problème : `DeviceAuth.reject()` était un NO-OP — le signal n'avait AUCUN
// abonné. Le natif gardait donc le jeton mort ET son cache : l'app affichait
// « session expirée » par-dessus des données périmées servies comme fraîches.
//
// Ce test rejoue le VRAI code de production (`DeviceAuth.reject()`,
// `SessionRepair.purge()`, `FileCacheStore` — purs, sans Android) compilé par
// le harnais et piloté par `agents/runtime/kotlin-parity/SessionRepairParityMain.kt`
// : les assertions portent sur du code EXÉCUTÉ, pas sur un miroir TS.
//
// Le CÂBLAGE (l'app branche l'abonné, la purge passe par `accounts.logout()`)
// est épinglé par lecture des sources : `tests/architecture/session-repair.test.ts`.
//
// Outillage `kotlinc`/`java` absent = SKIP BRUYANT du harnais (jamais un faux
// vert) ; un échec de compilation, lui, est un défaut (le test rougit).
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "SessionRepairParityMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

afterAll(async () => {
  if (!link) return;
  try {
    await link.ask({ op: "cleanup" });
  } catch {
    // le pilote est déjà mort : rien à nettoyer.
  }
});

async function ask(op: unknown): Promise<any> {
  return JSON.parse(await link!.ask(op));
}

describe("le rejet d'une session morte purge la session et le cache (#397)", () => {
  test.skipIf(skip)("un rejet invalide la session ET purge le cache", async () => {
    const store = await ask({ op: "newStore" });
    const sid = store.sid as number;
    // L'appareil est appairé : il y a une session en mémoire et un cache.
    const opened = await ask({ op: "openSession" });
    expect(opened.client).toBe(true);
    await ask({ op: "write", sid, resource: "grades", payload: '{"grades":[{"moyenne":15}]}', fetchedAt: 1000 });
    await ask({ op: "write", sid, resource: "capabilities", payload: '{"tabs":["grades"]}', fetchedAt: 1000 });
    expect((await ask({ op: "load", sid, resource: "grades" })).found).toBe(true);

    // L'établissement a tourné le jeton : un dépôt lève le signal.
    const rejected = await ask({ op: "reject", sid });
    // La session PERSISTÉE est invalidée...
    expect(rejected.sessionCleared).toBe(true);
    // ...la session en mémoire est abandonnée (plus de client)...
    expect(rejected.client).toBe(false);
    // ...et le cache est PURGÉ : plus aucune donnée du compte mort.
    expect((await ask({ op: "load", sid, resource: "grades" })).found).toBe(false);
    expect((await ask({ op: "load", sid, resource: "capabilities" })).found).toBe(false);
    expect((await ask({ op: "files", sid })).files).toEqual([]);
  });

  test.skipIf(skip)("un SECOND rejet ne ressuscite rien (pas de boucle)", async () => {
    const store = await ask({ op: "newStore" });
    const sid = store.sid as number;
    await ask({ op: "openSession" });
    await ask({ op: "write", sid, resource: "grades", payload: '{"grades":[]}', fetchedAt: 1000 });

    await ask({ op: "reject", sid });
    // Un autre dépôt échoue au même moment : la purge est idempotente.
    const again = await ask({ op: "rejectAgain", sid });
    expect(again.sessionCleared).toBe(true);
    expect(again.client).toBe(false);
    expect((await ask({ op: "load", sid, resource: "grades" })).found).toBe(false);
    expect((await ask({ op: "files", sid })).files).toEqual([]);
  });
});
