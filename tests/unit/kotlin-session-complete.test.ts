// Une session n'est valide que COMPLÈTE (#870) : le VRAI `SessionRecordStore`
// est piloté par le harnais ; une clé manquante est purgée et rendue typée,
// jamais relue comme une session. Le client `logged_in`/`info` est vérifié par
// la même décision pure, et le câblage interdit toute publication avant elle.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "StoreCommitParityMain.kt");
const BRIDGE = join(ROOT, "android", "app", "src", "main", "java", "fr", "veryslopnynotes", "app", "VsnBridge.kt");

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
    // pilote déjà mort : rien à nettoyer.
  }
});

async function ask(op: unknown): Promise<any> {
  return JSON.parse(await link!.ask(op));
}

const SESSION = {
  endpointUrl: "https://etab.exemple/eleve",
  username: "eleve.a",
  password: "jeton-a",
  uuid: "uuid-a",
  schoolUrl: "https://etab.exemple",
  mode: "jeton",
};

async function newStore(): Promise<number> {
  return (await ask({ op: "newStore" })).sid as number;
}

async function saved(): Promise<number> {
  const sid = await newStore();
  expect(await ask({ op: "sessionSave", sid, ...SESSION })).toEqual({ result: "written" });
  return sid;
}

describe("session persistée : complète ou purgée (#870)", () => {
  test.skipIf(skip)("une session complète se lit sans perte", async () => {
    const sid = await saved();
    expect(await ask({ op: "sessionLoadOutcome", sid })).toEqual({
      status: "complete",
      username: "eleve.a",
    });
  });

  // Chaque champ requis manquant : la lecture rend `Incomplete` (typée), purge
  // les clés restantes, et `load()` ne rend JAMAIS la moitié.
  for (const [field, missing] of [
    ["endpoint_url", "endpoint_url"],
    ["username", "username"],
    ["jeton", "token"],
    ["uuid", "uuid"],
  ] as const) {
    test.skipIf(skip)(`${field} manquant : refus typé + purge, aucune lecture partielle`, async () => {
      const sid = await saved();
      await ask({ op: "sessionRemove", sid, key: field });
      const outcome = await ask({ op: "sessionLoadOutcome", sid });
      expect(outcome.status).toBe("incomplete");
      expect(outcome.missing).toContain(missing);
      expect(outcome.cleared).toBe(true);
      // Aucune clé ne survit : la moitié ne peut pas être relue plus tard.
      expect((await ask({ op: "sessionKeys", sid })).keys).toEqual([]);
      expect((await ask({ op: "sessionLoad", sid })).found).toBe(false);
    });
  }

  test.skipIf(skip)("une URL vide (clé présente) est aussi une session partielle", async () => {
    const sid = await saved();
    await ask({ op: "sessionBlank", sid, key: "endpoint_url" });
    const outcome = await ask({ op: "sessionLoadOutcome", sid });
    expect(outcome.status).toBe("incomplete");
    expect(outcome.missing).toEqual(["endpoint_url"]);
    expect(outcome.cleared).toBe(true);
    expect((await ask({ op: "sessionLoadOutcome", sid })).status).toBe("absent");
  });

  test.skipIf(skip)("une purge ratée est DITE, même si la lecture reste refusée", async () => {
    const sid = await saved();
    await ask({ op: "sessionRemove", sid, key: "uuid" });
    await ask({ op: "setFail", sid, target: "session", clear: true });
    const outcome = await ask({ op: "sessionLoadOutcome", sid });
    expect(outcome.status).toBe("incomplete");
    expect(outcome.cleared).toBe(false);
    // La moitié n'est jamais rendue comme session, même quand le disque garde
    // les clés (l'appelant doit repurger).
    expect((await ask({ op: "sessionLoad", sid })).found).toBe(false);
  });

  test.skipIf(skip)("les champs optionnels ne rendent pas la session incomplète", async () => {
    const sid = await saved();
    await ask({ op: "sessionRemove", sid, key: "client_identifier" });
    await ask({ op: "sessionRemove", sid, key: "school_url" });
    expect((await ask({ op: "sessionLoadOutcome", sid })).status).toBe("complete");
  });
});

describe("client : `logged_in` ET `info` requis (#870)", () => {
  const cases: Array<[boolean, boolean, string[]]> = [
    [true, true, []],
    [false, true, ["logged_in"]],
    [true, false, ["info"]],
    [false, false, ["logged_in", "info"]],
  ];
  for (const [loggedIn, infoReady, missing] of cases) {
    test.skipIf(skip)(`logged_in=${loggedIn}, info=${infoReady}`, async () => {
      expect(await ask({ op: "authGaps", loggedIn, infoReady })).toEqual({ missing });
    });
  }
});

describe("câblage : aucune publication avant la prédicat (#870)", () => {
  test("l'appairage vérifie le client ET la session AVANT de purger/publier", () => {
    const pairing = readFileSync(join(DATA, "PairingRepository.kt"), "utf8");
    const publish = pairing.slice(
      pairing.indexOf("private fun publish("),
      pairing.indexOf("fun restoreBlocking()", pairing.indexOf("private fun publish(")),
    );
    const iAuth = publish.indexOf("SessionAuthentication.missing(client.logged_in, client.infoReady)");
    const iStored = publish.indexOf("SessionCompleteness.missing(candidate)");
    const iPurge = publish.indexOf("purge.purge(");
    const iSet = publish.indexOf("PronoteSession.set(client)");
    // #861 a centralisé la purge : le prédicat doit précéder la purge ET la
    // publication, quel que soit le chemin (même compte ou bascule).
    const iMutation = Math.min(iPurge, iSet);
    expect(iAuth).toBeGreaterThan(-1);
    expect(iStored).toBeGreaterThan(iAuth);
    expect(iMutation).toBeGreaterThan(iStored);
  });

  test("la restauration publie sous la garde d'époque, après la prédicat", () => {
    const pairing = readFileSync(join(DATA, "PairingRepository.kt"), "utf8");
    const restore = pairing.slice(
      pairing.indexOf("private fun restoreLocked()"),
      pairing.indexOf("private fun clientMissing("),
    );
    const iAuth = restore.indexOf("clientMissing(client, stored)");
    const iEpoch = restore.indexOf("SessionEpoch.writeIfCurrent(epoch)");
    const iSet = restore.indexOf("PronoteSession.set(client)");
    expect(iAuth).toBeGreaterThan(-1);
    expect(iEpoch).toBeGreaterThan(iAuth);
    expect(iSet).toBeGreaterThan(iEpoch);
    expect(restore).toContain("is SessionLoad.Incomplete -> return rejectIncomplete(");
  });

  test("le pont ne dit jamais « restauré » pour une session incomplète", () => {
    const bridge = readFileSync(BRIDGE, "utf8");
    const start = bridge.indexOf("private fun restoreSession()");
    const body = bridge.slice(start, bridge.indexOf("private fun storageState()", start));
    const incomplete = body.indexOf("is RestoreResult.Incomplete");
    expect(incomplete).toBeGreaterThan(-1);
    const branch = body.slice(incomplete, body.indexOf("is RestoreResult.Dead", incomplete));
    expect(branch).toContain("sessionReady = false");
    expect(branch).not.toContain('"state", "restored"');
    expect(branch).not.toContain('"state", "offline"');
  });
});
