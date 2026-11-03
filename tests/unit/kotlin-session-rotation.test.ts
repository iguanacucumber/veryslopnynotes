// #867 : le jeton mobile TOURNE au login (`refresh` / restauration). Sans
// écriture, le prochain démarrage rouvre avec l'ancien et la session meurt.
//
// Ce fichier prouve trois choses :
//   1. le DÉMARRAGE À FROID : l'ancien jeton est semé, la rotation l'écrit, puis
//      un store NEUF relit les octets persistés — il voit le nouveau jeton ;
//   2. l'ÉCHEC EST RENDU : un `commit()` refusé n'est jamais « écrit », le
//      disque garde l'ancien jeton et l'appelant reçoit `failed` ;
//   3. le CÂBLAGE : restauration et refresh passent par la même garde, et le
//      pont publie `tokenSaved`.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const CLIENT = join(ROOT, "android", "pronote", "src", "main", "java", "fr", "veryslopnynotes", "pronote", "Client.kt");
const BRIDGE = join(ROOT, "android", "app", "src", "main", "java", "fr", "veryslopnynotes", "app", "VsnBridge.kt");
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "SessionRotationMain.kt");

const OLD = "jeton-ancien";
const NEW = "jeton-tourne";
const ENDPOINT = "https://etab.exemple/eleve";
const USER = "eleve.a";

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

async function seeded(): Promise<number> {
  const { sid } = await ask({ op: "newStore" });
  expect(await ask({ op: "seed", sid, password: OLD })).toEqual({ result: "written" });
  return sid as number;
}

function source(file: string): string {
  return codeOnly(readFileSync(file, "utf8"));
}

describe("jeton tourné : le disque suit (#867)", () => {
  test.skipIf(skip)("démarrage à froid : le nouveau jeton est relu", async () => {
    const sid = await seeded();
    expect(
      await ask({ op: "rotate", sid, endpointUrl: ENDPOINT, username: USER, token: NEW }),
    ).toEqual({ result: "written" });
    // Process neuf : un store neuf ne reçoit QUE les octets persistés.
    const { sid: cold } = await ask({ op: "coldStart", sid });
    expect(await ask({ op: "load", sid: cold })).toEqual({
      found: true,
      username: USER,
      token: NEW,
    });
  });

  test.skipIf(skip)("un commit refusé est RENDU et laisse l'ancien jeton", async () => {
    const sid = await seeded();
    await ask({ op: "setFail", sid, commit: true });
    const failed = await ask({ op: "rotate", sid, endpointUrl: ENDPOINT, username: USER, token: NEW });
    expect(failed.result).toBe("failed");
    expect(failed.reason).toBe("session non enregistrée");
    // Le disque n'a pas menti : le démarrage à froid relit l'ancien jeton.
    const { sid: cold } = await ask({ op: "coldStart", sid });
    expect((await ask({ op: "load", sid: cold })).token).toBe(OLD);
  });

  test.skipIf(skip)("un autre compte ne réécrit pas la session qui l'a remplacé", async () => {
    const sid = await seeded();
    expect(
      await ask({ op: "rotate", sid, endpointUrl: ENDPOINT, username: "autre.eleve", token: NEW }),
    ).toEqual({ result: "epoch_refused" });
    expect((await ask({ op: "load", sid })).token).toBe(OLD);
  });

  test.skipIf(skip)("sans session ou sans jeton, rien n'est écrit", async () => {
    const { sid } = await ask({ op: "newStore" });
    expect(await ask({ op: "rotate", sid, endpointUrl: ENDPOINT, username: USER, token: NEW })).toEqual({
      result: "refused",
      reason: "session absente",
    });
    const seededSid = await seeded();
    expect(
      await ask({ op: "rotate", sid: seededSid, endpointUrl: ENDPOINT, username: USER, token: "" }),
    ).toEqual({ result: "refused", reason: "jeton invalide" });
  });

  test.skipIf(skip)("l'échec est un ÉTAT publié, pas un silence", async () => {
    expect(await ask({ op: "report", result: "failed" })).toEqual({ failed: true });
    expect(await ask({ op: "report", result: "written" })).toEqual({ failed: false });
    expect(await ask({ op: "report", result: "failed" })).toEqual({ failed: true });
    expect(await ask({ op: "reset" })).toEqual({ failed: false });
  });
});

describe("câblage : restauration et refresh utilisent la même garde (#867)", () => {
  test("le client notifie le jeton tourné APRÈS l'avoir remplacé", () => {
    const client = source(CLIENT);
    const login = client.slice(client.indexOf("private fun login()"), client.indexOf("private fun do2fa"));
    const assign = login.indexOf('password = strOf(authData.fields["jetonConnexionAppliMobile"])');
    const info = login.indexOf("info = ClientInfo(this, ressource)");
    const notify = login.indexOf("onTokenRotated?.invoke(it)");
    expect(assign).toBeGreaterThan(-1);
    // #870 : le disque n'est prévenu qu'après `info` (session complète).
    expect(info).toBeGreaterThan(assign);
    expect(notify).toBeGreaterThan(info);
  });

  test("la restauration écrit AVANT de publier, et rend l'issue", () => {
    const repo = source(join(DATA, "PairingRepository.kt"));
    const restore = repo.slice(repo.indexOf("private fun restoreLocked()"), repo.indexOf("private fun rotationSink("));
    const auth = restore.indexOf("clientMissing(client, stored)");
    const save = restore.indexOf("saveRotatedToken(sessions, expected, rotated)");
    const publish = restore.indexOf("PronoteSession.set(client)");
    expect(auth).toBeGreaterThan(-1);
    expect(save).toBeGreaterThan(auth);
    expect(publish).toBeGreaterThan(save);
    expect(restore).toContain("RestoreResult.Restored(tokenSaved = saved.ok)");
    // Le client publié écrit aussi les rotations du refresh.
    expect(restore).toContain("client.onTokenRotated = rotationSink(client)");
    const publishBlock = repo.slice(repo.indexOf("private fun publish("), repo.indexOf("fun restoreBlocking()"));
    expect(publishBlock).toContain("client.onTokenRotated = rotationSink(client)");
  });

  test("le pont publie `tokenSaved` au statut ET à la restauration", () => {
    const bridge = source(BRIDGE);
    expect(bridge).toContain('put("tokenSaved", !RotatedTokenWrite.failed())');
    expect(bridge).toMatch(/is RestoreResult\.Restored[\s\S]*?put\("tokenSaved", result\.tokenSaved\)/);
  });
});
