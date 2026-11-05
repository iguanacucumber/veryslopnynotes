// #890 — les écritures de session/comptes/serveur rendent une issue TYPÉE :
// succès, refus, panne de commit, ou époque de session changée. Une panne
// injectée ne doit jamais ressembler à un succès, ni détruire la valeur d'avant.
// Le VRAI Kotlin compilé est piloté ici ; outillage absent = SKIP BRUYANT.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "StoreCommitParityMain.kt");

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

async function newStore(): Promise<number> {
  return (await ask({ op: "newStore" })).sid as number;
}

const SESSION_A = {
  endpointUrl: "https://etab.exemple/eleve",
  username: "eleve.a",
  password: "jeton-a",
  uuid: "uuid-a",
  schoolUrl: "https://etab.exemple",
};

describe("comptes : un commit refusé n'est plus un faux succès (#890)", () => {
  test.skipIf(skip)("record écrit la liste ET le compte courant, ou rien", async () => {
    const sid = await newStore();
    expect(await ask({ op: "accountRecord", sid, id: "compte.a" })).toEqual({ result: "written" });
    expect((await ask({ op: "accountCurrent", sid })).current).toBe("compte.a");
    expect((await ask({ op: "accountCount", sid })).count).toBe(1);

    await ask({ op: "setFail", sid, target: "accounts", commit: true });
    expect(await ask({ op: "accountRecord", sid, id: "compte.b" })).toEqual({
      result: "failed",
      reason: "comptes non enregistrés",
    });
    // Rien n'a bougé : ni liste, ni compte courant.
    expect((await ask({ op: "accountCurrent", sid })).current).toBe("compte.a");
    expect((await ask({ op: "accountCount", sid })).count).toBe(1);
  });

  test.skipIf(skip)("doublon, identifiant invalide et plafond sont REFUSÉS, pas « false » muet", async () => {
    const sid = await newStore();
    await ask({ op: "accountRecord", sid, id: "a" });
    expect(await ask({ op: "accountAdd", sid, id: "a" })).toEqual({
      result: "refused",
      reason: "compte déjà enregistré",
    });
    expect(await ask({ op: "accountAdd", sid, id: " " })).toEqual({
      result: "refused",
      reason: "identifiant de compte invalide",
    });
    expect(await ask({ op: "accountSelect", sid, id: "inconnu" })).toEqual({
      result: "refused",
      reason: "compte inconnu",
    });
    for (let i = 1; i < 8; i += 1) {
      expect((await ask({ op: "accountAdd", sid, id: `a${i}` })).result).toBe("written");
    }
    expect(await ask({ op: "accountRecord", sid, id: "trop" })).toEqual({
      result: "refused",
      reason: "nombre maximal de comptes atteint",
    });
  });

  test.skipIf(skip)("un effacement raté est DIT et ne vide pas la liste en mémoire", async () => {
    const sid = await newStore();
    await ask({ op: "accountRecord", sid, id: "a" });
    await ask({ op: "setFail", sid, target: "accounts", clear: true });
    expect(await ask({ op: "accountClear", sid })).toEqual({
      result: "failed",
      reason: "comptes non effacés",
    });
    expect((await ask({ op: "accountCurrent", sid })).current).toBe("a");
  });
});

describe("session : commit synchrone, l'ancienne valeur survit à une panne (#890)", () => {
  test.skipIf(skip)("une sauvegarde refusée n'écrase pas la session précédente", async () => {
    const sid = await newStore();
    expect(await ask({ op: "sessionSave", sid, ...SESSION_A })).toEqual({ result: "written" });
    await ask({ op: "setFail", sid, target: "session", commit: true });
    expect(
      await ask({ op: "sessionSave", sid, ...SESSION_A, username: "eleve.b", uuid: "uuid-b" }),
    ).toEqual({ result: "failed", reason: "session non enregistrée" });
    const found = await ask({ op: "sessionLoad", sid });
    expect(found.found).toBe(true);
    expect(found.username).toBe("eleve.a");
    expect(found.uuid).toBe("uuid-a");
  });

  test.skipIf(skip)("un effacement refusé laisse le jeton lisible (donc l'échec remonte)", async () => {
    const sid = await newStore();
    await ask({ op: "sessionSave", sid, ...SESSION_A });
    await ask({ op: "setFail", sid, target: "session", clear: true });
    expect(await ask({ op: "sessionClear", sid })).toEqual({
      result: "failed",
      reason: "session non effacée",
    });
    expect((await ask({ op: "sessionLoad", sid })).found).toBe(true);
  });

  test.skipIf(skip)("une session inutilisable est REFUSÉE avant toute écriture", async () => {
    const sid = await newStore();
    expect(await ask({ op: "sessionSave", sid, ...SESSION_A, endpointUrl: "ftp://etab" })).toEqual({
      result: "refused",
      reason: "session invalide",
    });
    expect((await ask({ op: "sessionLoad", sid })).found).toBe(false);
  });
});

describe("bascule de compte : session + comptes dans la même transaction (#890)", () => {
  async function seeded(): Promise<number> {
    const sid = await newStore();
    expect(await ask({ op: "seed", sid, ...SESSION_A, accountId: "compte.a" })).toEqual({
      result: "written",
      current: "compte.a",
    });
    return sid;
  }

  test.skipIf(skip)("une panne de la session annule la bascule, l'ancien compte reste appairé", async () => {
    const sid = await seeded();
    await ask({ op: "setFail", sid, target: "session", commit: true });
    expect(await ask({ op: "switch", sid, ...SESSION_A, username: "eleve.b", uuid: "uuid-b", accountId: "compte.b" })).toEqual({
      result: "failed",
      reason: "session non enregistrée",
      current: "compte.a",
      username: "eleve.a",
    });
  });

  test.skipIf(skip)("un compte refusé APRÈS la session RESTAURE la session précédente", async () => {
    const sid = await seeded();
    await ask({ op: "setFail", sid, target: "accounts", commit: true });
    // La session neuve a été écrite, le compte a échoué : la session d'AVANT
    // doit revenir, sinon le nouveau compte resterait à moitié installé.
    expect(await ask({ op: "switch", sid, ...SESSION_A, username: "eleve.b", uuid: "uuid-b", accountId: "compte.b" })).toEqual({
      result: "failed",
      reason: "comptes non enregistrés",
      current: "compte.a",
      username: "eleve.a",
    });
  });

  test.skipIf(skip)("une restauration RATÉE efface la session neuve et garde l'échec", async () => {
    const sid = await seeded();
    // Premier commit (session neuve) réussi, second (restauration) en échec.
    await ask({ op: "setFail", sid, target: "session", commitAfter: 1 });
    await ask({ op: "setFail", sid, target: "accounts", commit: true });
    expect(await ask({ op: "switch", sid, ...SESSION_A, username: "eleve.b", uuid: "uuid-b", accountId: "compte.b" })).toEqual({
      result: "failed",
      reason: "bascule incomplète : session non restaurée",
      current: "compte.a",
      // La session neuve a été EFFACÉE, pas laissée sous un échec annoncé.
      username: "",
    });
    expect((await ask({ op: "sessionLoad", sid })).found).toBe(false);
  });

  test.skipIf(skip)("une époque périmée REFUSE la bascule sans rien écrire", async () => {
    const sid = await seeded();
    await ask({ op: "invalidateEpoch" });
    expect(
      await ask({ op: "switch", sid, ...SESSION_A, username: "eleve.b", uuid: "uuid-b", accountId: "compte.b", epoch: 0 }),
    ).toEqual({ result: "epoch_refused", current: "compte.a", username: "eleve.a" });
  });

  test.skipIf(skip)("succès : session neuve ET compte courant changent ensemble", async () => {
    const sid = await seeded();
    expect(await ask({ op: "switch", sid, ...SESSION_A, username: "eleve.b", uuid: "uuid-b", accountId: "compte.b" })).toEqual({
      result: "written",
      current: "compte.b",
      username: "eleve.b",
    });
  });
});

describe("serveur : validation puis commit vérifié (#890)", () => {
  test.skipIf(skip)("un refus de validation n'écrit rien, un commit raté est DIT", async () => {
    const sid = await newStore();
    expect(await ask({ op: "serverSave", sid, raw: "pas-une-adresse" })).toEqual({
      result: "refused",
      message: "Adresse incomplète : le format attendu est https://domaine[:port].",
    });
    await ask({ op: "setFail", sid, target: "server", commit: true });
    expect(await ask({ op: "serverSave", sid, raw: "https://notes.exemple.fr/" })).toEqual({
      result: "failed",
      reason: "serveur non enregistré",
      baseUrl: "https://notes.exemple.fr",
    });
    // Le commit raté n'a pas laissé d'adresse : la graine reste l'autorité.
    expect((await ask({ op: "serverBase", sid, seed: "https://graine.exemple" })).baseUrl).toBe(
      "https://graine.exemple",
    );
  });

  test.skipIf(skip)("un commit réussi est relu tel qu'écrit", async () => {
    const sid = await newStore();
    expect(await ask({ op: "serverSave", sid, raw: "https://notes.exemple.fr/" })).toEqual({
      result: "written",
      baseUrl: "https://notes.exemple.fr",
    });
    expect((await ask({ op: "serverBase", sid, seed: "https://graine.exemple" })).baseUrl).toBe(
      "https://notes.exemple.fr",
    );
  });
});

describe("câblage : commit synchrone et issue propagée (#890)", () => {
  test("plus d'apply() dans les stores, et le Boolean de commit() est lu", () => {
    for (const name of ["AccountStore.kt", "SessionStore.kt", "ServerStore.kt"]) {
      const source = readFileSync(join(DATA, name), "utf8");
      expect({ name, apply: source.includes(".apply()") }).toEqual({ name, apply: false });
    }
    const adapter = readFileSync(join(DATA, "SharedPrefsKeyValue.kt"), "utf8");
    expect(adapter).toContain("editor.commit()");
    expect(adapter).not.toContain(".apply()");
    // L'adaptateur seul touche SharedPreferences ; les registres restent purs.
    expect(readFileSync(join(DATA, "StoreCommit.kt"), "utf8")).not.toContain("import android.");
  });

  test("l'appairage et la déconnexion REFUSENT un succès partiel", () => {
    const pairing = readFileSync(join(DATA, "PairingRepository.kt"), "utf8");
    // Session + compte sous la garde d'époque, pas deux écritures séparées.
    expect(pairing).toContain("AccountSessionCommit(sessions, accountRecorder).switchTo(");
    expect(pairing).toContain("if (!written.ok)");
    expect(pairing).toContain("WriteResult.EpochRefused");
    // Logout : session ET comptes dans le MÊME plan, un échec n'est pas avalé.
    const logout = pairing.slice(
      pairing.indexOf("fun logoutBlocking("),
      pairing.indexOf("private fun failure(", pairing.indexOf("fun logoutBlocking(")),
    );
    expect(logout).toContain("AccountPurgeMode.LOGOUT");
    expect(logout).toContain("if (result.ok)");
    expect(logout).toContain("AccountPurgeResult.Incomplete");
    const factory = readFileSync(join(DATA, "AccountPurgeFactory.kt"), "utf8");
    expect(factory).toContain("AccountDataStore.SESSION");
    expect(factory).toContain("AccountDataStore.ACCOUNTS");
    // Le pont ne réenregistre plus le compte hors section critique.
    const bridge = readFileSync(
      join(ROOT, "android", "app", "src", "main", "java", "fr", "veryslopnynotes", "app", "VsnBridge.kt"),
      "utf8",
    );
    expect(bridge).toContain("accountRecorder = accounts");
    expect(bridge).not.toContain("accounts.add(");
  });
});
