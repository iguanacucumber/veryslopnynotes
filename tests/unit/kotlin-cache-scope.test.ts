// Le cache ne doit JAMAIS servir les données d'un autre compte : les clés
// sont globales, donc toute bascule ou session morte doit purger.
// La décision est EXÉCUTÉE (`CacheScope` compilé par le harnais) ; le câblage
// est épinglé par lecture des sources (`PairingRepository` n'est pas rejouable).
// Outillage absent = SKIP BRUYANT, jamais un faux vert.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";
import { readBridgeSource } from "./fixtures/bridge-source";

const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const SCOPE = join(DATA, "CacheScope.kt");
const REPAIR = join(DATA, "SessionRepair.kt");
const PAIRING = join(DATA, "PairingRepository.kt");
const ACCOUNT = join(DATA, "AccountStore.kt");
const WORKER = join(DATA, "PeriodicSyncWorker.kt");
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "CacheScopeParityMain.kt");

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

/** Un compte de test : l'IDENTITÉ suffit, aucun secret (aucun jeton, aucun PIN). */
const compteA = { endpoint: "https://etab.exemple/pronote", username: "eleve.a" };
const compteB = { endpoint: "https://etab.exemple/pronote", username: "eleve.b" };

/** Index du caractère qui referme le bloc ouvert à [open] (parens ou accolades). */
function matching(src: string, open: number, openChar: string, closeChar: string): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === openChar) depth++;
    else if (src[i] === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

describe("le cache n'est jamais servi à un autre compte (#407)", () => {
  test.skipIf(skip)("appairage d'un AUTRE compte : le cache du compte précédent n'est plus servi", async () => {
    const store = await ask({ op: "newStore" });
    const sid = store.sid as number;
    // Le compte A a laissé un cache (notes, EDT, cantine…).
    await ask({ op: "write", sid, resource: "grades", payload: '{"grades":[{"moyenne":15}]}', fetchedAt: 1000 });
    expect((await ask({ op: "load", sid, resource: "grades" })).found).toBe(true);

    // L'utilisateur appaire le compte B.
    const paired = await ask({ op: "switch", sid, previous: compteA, current: compteB });
    expect(paired.purged).toBe(true);
    expect((await ask({ op: "load", sid, resource: "grades" })).found).toBe(false);
    expect((await ask({ op: "files", sid })).files).toEqual([]);
  });

  test.skipIf(skip)("appairage du MÊME compte : le cache est conservé (pas de purge inutile)", async () => {
    const store = await ask({ op: "newStore" });
    const sid = store.sid as number;
    await ask({ op: "write", sid, resource: "grades", payload: '{"grades":[{"moyenne":15}]}', fetchedAt: 1000 });

    const paired = await ask({ op: "switch", sid, previous: compteA, current: compteA });
    expect(paired.purged).toBe(false);
    // Le cache du MÊME compte survit : il est encore frais et encore le sien.
    const loaded = await ask({ op: "load", sid, resource: "grades" });
    expect(loaded.found).toBe(true);
    expect(loaded.payload).toBe('{"grades":[{"moyenne":15}]}');
  });

  test.skipIf(skip)("identité INCONNUE : le cache est purgé (fail-closed, rien n'est supposé)", async () => {
    const store = await ask({ op: "newStore" });
    const sid = store.sid as number;
    await ask({ op: "write", sid, resource: "grades", payload: '{"grades":[{"moyenne":15}]}', fetchedAt: 1000 });

    // Aucun compte précédent : impossible de prouver que c'est le même, donc rien n'est servi.
    const paired = await ask({ op: "switch", sid, previous: null, current: compteA });
    expect(paired.purged).toBe(true);
    expect((await ask({ op: "load", sid, resource: "grades" })).found).toBe(false);
  });

  test.skipIf(skip)("session MORTE : le cache est purgé avec elle", async () => {
    const store = await ask({ op: "newStore" });
    const sid = store.sid as number;
    await ask({ op: "write", sid, resource: "capabilities", payload: '{"tabs":["grades"]}', fetchedAt: 1000 });
    await ask({ op: "write", sid, resource: "grades", payload: '{"grades":[]}', fetchedAt: 1000 });
    expect((await ask({ op: "load", sid, resource: "capabilities" })).found).toBe(true);

    // Le jeton est tourné : la session est déclarée morte.
    await ask({ op: "dead", sid });
    expect((await ask({ op: "load", sid, resource: "capabilities" })).found).toBe(false);
    expect((await ask({ op: "load", sid, resource: "grades" })).found).toBe(false);
    expect((await ask({ op: "files", sid })).files).toEqual([]);
  });

  test.skipIf(skip)("une lecture EN VOL ne ressuscite pas le cache purgé (garde d'époque)", async () => {
    const store = await ask({ op: "newStore" });
    const sid = store.sid as number;
    // La lecture part : elle capture l'époque AVANT de lire le client local.
    const begin = await ask({ op: "readBegin" });
    expect(typeof begin.epoch).toBe("number");

    // ... le compte change (purge) pendant la lecture ...
    await ask({ op: "switch", sid, previous: compteA, current: compteB });

    // ... et la lecture se termine : son écriture doit être REFUSÉE.
    const end = await ask({
      op: "readEnd",
      epoch: begin.epoch,
      sid,
      resource: "grades",
      payload: '{"grades":[{"moyenne":18}]}',
      fetchedAt: 2000,
    });
    expect(end.written).toBe(false);
    expect((await ask({ op: "files", sid })).files).toEqual([]);
    expect((await ask({ op: "load", sid, resource: "grades" })).found).toBe(false);
  });
});

// L'ordre (purge AVANT publication) est vérifié sur `CacheScope.switchAccount` exécuté.
describe("la bascule de compte est atomique (#529)", () => {
  test.skipIf(skip)("la purge est faite AVANT la publication du nouveau client", async () => {
    const store = await ask({ op: "newStore" });
    const sid = store.sid as number;
    // Le compte A a laissé un cache.
    await ask({ op: "write", sid, resource: "grades", payload: '{"grades":[{"moyenne":15}]}', fetchedAt: 1000 });

    const sw = await ask({ op: "switch", sid, previous: compteA, current: compteB });
    expect(sw.purged).toBe(true);
    // À la publication, le payload du compte précédent n'est déjà plus là.
    expect(sw.payloadAtPublish).toBe("");
    // L'époque est invalidée avant la publication : une lecture en cours n'écrit pas.
    expect(sw.epochAtPublish).toBeGreaterThan(sw.epochBefore);
    expect((await ask({ op: "files", sid })).files).toEqual([]);
  });

  test.skipIf(skip)("une lecture partie AVANT la bascule n'écrit rien du compte précédent", async () => {
    const store = await ask({ op: "newStore" });
    const sid = store.sid as number;
    await ask({ op: "write", sid, resource: "grades", payload: '{"grades":[{"moyenne":15}]}', fetchedAt: 1000 });

    // La lecture part (époque capturée)…
    const begin = await ask({ op: "readBegin" });
    // … la bascule purge et publie…
    await ask({ op: "switch", sid, previous: compteA, current: compteB });
    // … la lecture se termine : son écriture est refusée (l'époque a changé).
    const end = await ask({
      op: "readEnd",
      epoch: begin.epoch,
      sid,
      resource: "grades",
      payload: '{"grades":[{"moyenne":18}]}',
      fetchedAt: 2000,
    });
    expect(end.written).toBe(false);
    expect((await ask({ op: "files", sid })).files).toEqual([]);
  });

  test.skipIf(skip)("une lecture partie APRÈS la bascule écrit le cache du nouveau compte", async () => {
    const store = await ask({ op: "newStore" });
    const sid = store.sid as number;
    await ask({ op: "write", sid, resource: "grades", payload: '{"grades":[{"moyenne":15}]}', fetchedAt: 1000 });

    await ask({ op: "switch", sid, previous: compteA, current: compteB });

    // Le cache du nouveau compte repart de zéro : il se remplit normalement.
    const begin = await ask({ op: "readBegin" });
    const end = await ask({
      op: "readEnd",
      epoch: begin.epoch,
      sid,
      resource: "grades",
      payload: '{"grades":[{"moyenne":18}]}',
      fetchedAt: 2000,
    });
    expect(end.written).toBe(true);
    const loaded = await ask({ op: "load", sid, resource: "grades" });
    expect(loaded.payload).toBe('{"grades":[{"moyenne":18}]}');
  });
});

describe("câblage du scopage du cache (#407)", () => {
  const pairing = readFileSync(PAIRING, "utf8");
  const account = readFileSync(ACCOUNT, "utf8");
  const worker = readFileSync(WORKER, "utf8");
  const bridge = readBridgeSource();
  const scope = readFileSync(SCOPE, "utf8");
  const repair = readFileSync(REPAIR, "utf8");

  test("la purge est UN SEUL endroit, sous la garde d'époque", () => {
    // Invalidation et purge partagent la même section critique : une écriture en vol est abandonnée.
    expect(scope).toMatch(/SessionEpoch\.invalidate \{[\s\S]*?store\.clearAll\(\)/);
    // UN SEUL effacement dans l'objet : purge et bascule passent par la même garde.
    expect(scope.match(/store\.clearAll\(\)/g)?.length).toBe(1);
    // Déconnexion ET session morte partagent `SessionRepair.purge`.
    expect(repair).toContain("CacheScope.purge(cacheStore)");
    expect(account).toContain("SessionRepair.purge(");
    expect(account).not.toContain("SessionEpoch.invalidate");
  });

  test("l'appairage purge le cache du compte précédent AVANT d'enregistrer la session", () => {
    const iScope = pairing.indexOf("CacheScope.switchAccount(");
    const iSave = pairing.indexOf("sessions.save(");
    expect(iScope).toBeGreaterThan(-1);
    expect(iSave).toBeGreaterThan(-1);
    // AVANT `sessions.save` : si le process meurt, la session restaurée est l'ancienne.
    expect(iScope).toBeLessThan(iSave);
    // L'identité vient de la session PERSISTÉE, jamais d'`AccountStore`.
    expect(pairing).toContain("AccountIdentity.of(it.endpointUrl, it.username)");
    expect(pairing).toContain("AccountIdentity.of(endpoint, username)");
    // Le code ne s'appuie sur AUCUNE identité de compte non garantie.
    expect(codeOnly(pairing)).not.toContain("AccountStore");
  });

  test("l'appairage purge le cache AVANT de publier le nouveau client (#529)", () => {
    const start = pairing.indexOf("fun pairBlocking(");
    const end = pairing.indexOf("fun restoreBlocking()", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = pairing.slice(start, end);

    const iSwitch = body.indexOf("CacheScope.switchAccount(");
    const iPublish = body.indexOf("PronoteSession.set(client)");
    expect(iSwitch).toBeGreaterThan(-1);
    expect(iPublish).toBeGreaterThan(-1);
    // La publication est la lambda de la bascule : elle ne peut pas précéder la purge.
    const openParen = iSwitch + "CacheScope.switchAccount(".length - 1;
    const closeParen = matching(body, openParen, "(", ")");
    expect(closeParen).toBeGreaterThan(iSwitch);
    const after = body.slice(closeParen + 1);
    const trimmed = after.trimStart();
    expect(trimmed.startsWith("{")).toBe(true);
    const openBrace = closeParen + 1 + (after.length - trimmed.length);
    const closeBrace = matching(body, openBrace, "{", "}");
    expect(iPublish).toBeGreaterThan(openBrace);
    expect(iPublish).toBeLessThan(closeBrace);
    // UNE SEULE publication dans l'appairage.
    expect(body.split("PronoteSession.set(client)").length - 1).toBe(1);
  });

  test("la session MORTE purge le cache (store vidé ET cache purgé)", () => {
    const iClear = pairing.indexOf("sessions.clear()");
    const iDead = pairing.indexOf("CacheScope.onSessionDead(cacheStore)");
    const iResult = pairing.indexOf("RestoreResult.Dead(");
    expect(iClear).toBeGreaterThan(-1);
    expect(iDead).toBeGreaterThan(-1);
    expect(iResult).toBeGreaterThan(-1);
    expect(iDead).toBeGreaterThan(iClear);
    expect(iDead).toBeLessThan(iResult);
  });

  test("le pont ET le job de fond passent le store de cache au dépôt d'appairage", () => {
    // Sans store, le job de fond (process neuf) laisserait le cache intact.
    expect(bridge).toContain("PairingRepository(sessions, cacheStore)");
    expect(worker).toContain("PairingRepository(sessions, cacheStore())");
    // Le job purge le MÊME dossier que l'app (verrou partagé, purge commune).
    expect(worker).toContain('FileCacheStore(File(applicationContext.filesDir, "offline"))');
  });

  // Le pont capture l'époque à l'arrivée : une entrée purgée depuis vient d'un AUTRE compte.
  test("le pont ne sert pas une entrée d'un autre compte", () => {
    expect(bridge).toContain("resourceCached(p, epoch)");
    expect(bridge).toMatch(/if \(SessionEpoch\.current\(\) != epoch\) return emptyCached\(\)/);
  });

  test("le login ne sort jamais (ni log, ni rapport de crash)", () => {
    // `AccountIdentity` n'est PAS une data class : son `toString()` est rédigé.
    expect(scope).toContain('override fun toString(): String = "AccountIdentity(***)"');
    expect(scope).not.toContain("data class AccountIdentity");
  });
});
