// La déconnexion doit être SÉRIALISÉE avec appairage/restauration : sans le
// verrou de session, une restauration encore en vol republie l'ancien client
// APRÈS la purge. Le test exécute la COURSE sur le vrai `SessionGate` et la
// vraie purge ; le câblage du dépôt est épinglé par lecture des sources.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";
import { readBridgeSource } from "./fixtures/bridge-source";

const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
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

describe("logout sérialisé avec restore/pair (#785)", () => {
  test.skipIf(skip)("un logout concurrent d'une restauration ne laisse pas l'ancien client", async () => {
    const store = await ask({ op: "newStore" });
    const race = await ask({ op: "race", sid: store.sid });
    // Le logout a ATTENDU la fin de la restauration…
    expect(race.ranDuringRestore).toBe(false);
    // …puis a purgé : l'ancien client ne survit pas à la déconnexion.
    expect(race.client).toBe(false);
    expect(race.restoreAlive).toBe(false);
    expect(race.logoutAlive).toBe(false);
  });

  test("appairage, restauration et déconnexion prennent le MÊME verrou", () => {
    const pairing = readFileSync(join(DATA, "PairingRepository.kt"), "utf8");
    const gate = readFileSync(join(DATA, "SessionGate.kt"), "utf8");
    // UN verrou d'objet pour tout le process (pont et job ont des dépôts distincts).
    expect(gate).toMatch(/object SessionGate/);
    expect(gate).toMatch(/synchronized\(restoreLock, block\)/);
    expect(pairing.match(/SessionGate\.serialized/g)?.length).toBeGreaterThanOrEqual(3);
    // Le logout purge DANS la section critique, jamais à côté.
    const start = pairing.indexOf("fun logoutBlocking(");
    expect(start).toBeGreaterThan(-1);
    const body = pairing.slice(start, pairing.indexOf("private fun failure(", start));
    expect(body).toContain("AccountPurgeMode.LOGOUT");
    expect(body).toContain("purge.purge(");
    // Le pont n'appelle plus une purge hors verrou.
    const bridge = readBridgeSource();
    expect(bridge).toContain("pairing.logoutBlocking");
    expect(bridge).not.toContain("accounts.logout()");
  });

  test("le job purge une session morte même sans abonné (process neuf)", () => {
    const worker = readFileSync(join(DATA, "PeriodicSyncWorker.kt"), "utf8");
    expect(worker).toContain("if (!DeviceAuth.reject())");
    expect(worker).toMatch(/logoutBlocking\(\)[\s\S]*AccountPurgeFactory\.runner/);
    expect(worker).toContain("Result.success()");
  });
});
