// Le rejet d'une session MORTE purge la session ET le cache : `DeviceAuth.reject()`
// était un no-op sans abonné, et l'app servait des données périmées comme fraîches.
// VRAI code compilé et piloté ; le câblage est épinglé par lecture des sources.
// Outillage absent = SKIP BRUYANT.
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

// La détection de session morte ne se fie pas à un MOT du message, en partie écrit
// par l'établissement : un mot purgeait tout le cache et renvoyait à l'appairage.
// Le chemin RÉEL est rejoué : échec → isSessionFailure → reject → purge.
describe("session morte : un message d'établissement ne purge pas le cache (#520)", () => {
  test.skipIf(skip)("un `Titre` d'établissement (« Confirmation de connexion ») : la session SURVIT", async () => {
    const store = await ask({ op: "newStore" });
    const sid = store.sid as number;
    await ask({ op: "openSession" });
    await ask({ op: "write", sid, resource: "grades", payload: '{"grades":[{"moyenne":15}]}', fetchedAt: 1000 });

    // Le message contient un mot de session : ce n'est PAS une session morte.
    const r = await ask({ op: "readFailure", sid, kind: "establishment" });
    expect(r.dead).toBe(false);
    // La session n'est pas invalidée…
    expect(r.sessionCleared).toBe(false);
    expect(r.client).toBe(true);
    // …et le cache SURVIT (les notes de l'élève sont encore là).
    expect((await ask({ op: "load", sid, resource: "grades" })).found).toBe(true);
    expect((await ask({ op: "files", sid })).files.length).toBeGreaterThan(0);
  });

  test.skipIf(skip)("une VRAIE session morte (G=10) purge TOUJOURS (la détection n'est pas supprimée)", async () => {
    const store = await ask({ op: "newStore" });
    const sid = store.sid as number;
    await ask({ op: "openSession" });
    await ask({ op: "write", sid, resource: "grades", payload: '{"grades":[]}', fetchedAt: 1000 });

    const r = await ask({ op: "readFailure", sid, kind: "deadSession" });
    expect(r.dead).toBe(true);
    expect(r.sessionCleared).toBe(true);
    expect(r.client).toBe(false);
    expect((await ask({ op: "load", sid, resource: "grades" })).found).toBe(false);
  });

  test.skipIf(skip)("un jeton refusé (HTTP 401) est DÉTOCTÉ : le statut HTTP tranche", async () => {
    const store = await ask({ op: "newStore" });
    const sid = store.sid as number;
    await ask({ op: "openSession" });
    await ask({ op: "write", sid, resource: "grades", payload: '{"grades":[]}', fetchedAt: 1000 });

    const r = await ask({ op: "readFailure", sid, kind: "http401" });
    expect(r.dead).toBe(true);
    expect(r.sessionCleared).toBe(true);
    expect((await ask({ op: "load", sid, resource: "grades" })).found).toBe(false);
  });
});
