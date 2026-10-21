// #407 : le cache ne doit JAMAIS servir les données d'un autre compte.
//
// Le problème : les clés de cache sont GLOBALES (`cache_grades.txt`, sans
// compte) et le TTL va jusqu'à 24 h (capacités). L'établissement fait tourner
// le jeton -> la session est « morte » -> la session est purgée mais PAS le
// cache -> l'utilisateur ré-apparie le compte B -> les écrans Notes, EDT,
// Cantine et Capacités servent le payload du compte A, hors ligne.
//
// Ce test rejoue le VRAI code de production (`CacheScope`, `AccountIdentity`,
// `FileCacheStore` — purs, sans Android) compilé par le harnais et piloté par
// `agents/runtime/kotlin-parity/CacheScopeParityMain.kt` : les assertions
// portent sur du code EXÉCUTÉ, pas sur un miroir TS.
//
// La DÉCISION (purge ou pas) est une fonction pure : elle est donc testée
// exécutée. Le CÂBLAGE (l'appairage purge AVANT d'enregistrer la session, la
// session morte purge, le pont et le job de fond passent le store) est épinglé
// par lecture des sources : `PairingRepository` fait un `tokenLogin` RÉEL, il
// n'est donc pas rejouable hors ligne — même limite que le miroir
// `android-pairing`.
//
// #529 : l'ORDRE de la bascule (purge du cache précédent AVANT la publication
// du nouveau client) est lui aussi EXÉCUTÉ : `CacheScope.switchAccount` est
// compilé et rejoué, et le pilote observe ce que voit un lecteur au moment
// exact de la publication (l'époque ET le cache).
//
// Outillage `kotlinc`/`java` absent = SKIP BRUYANT du harnais (jamais un faux
// vert) ; un échec de compilation, lui, est un défaut (le test rougit).
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const APP = join(ROOT, "android", "app", "src", "main", "java", "fr", "veryslopnynotes", "app");
const SCOPE = join(DATA, "CacheScope.kt");
const REPAIR = join(DATA, "SessionRepair.kt");
const PAIRING = join(DATA, "PairingRepository.kt");
const ACCOUNT = join(DATA, "AccountStore.kt");
const WORKER = join(DATA, "PeriodicSyncWorker.kt");
const BRIDGE = join(APP, "VsnBridge.kt");
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
    // Le payload du compte A n'est PLUS servi…
    expect((await ask({ op: "load", sid, resource: "grades" })).found).toBe(false);
    // …et il n'est plus sur le disque non plus.
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

    // Aucun compte précédent connu : on ne peut pas prouver que c'est le même
    // compte -> on ne sert rien.
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
    // Le disque est vide : plus aucune donnée du compte précédent.
    expect((await ask({ op: "files", sid })).files).toEqual([]);
    expect((await ask({ op: "load", sid, resource: "grades" })).found).toBe(false);
  });
});

// #529 : la purge du cache précédent précède la PUBLICATION du nouveau client.
//
// Le test rejoue le VRAI code de production (`CacheScope.switchAccount`) : le
// pilote observe ce que voit un LECTEUR au moment EXACT de la publication
// (l'époque ET le contenu du cache). L'ordre est donc vérifié sur du code
// EXÉCUTÉ, pas sur une intention.
describe("la bascule de compte est atomique (#529)", () => {
  test.skipIf(skip)("la purge est faite AVANT la publication du nouveau client", async () => {
    const store = await ask({ op: "newStore" });
    const sid = store.sid as number;
    // Le compte A a laissé un cache.
    await ask({ op: "write", sid, resource: "grades", payload: '{"grades":[{"moyenne":15}]}', fetchedAt: 1000 });

    const sw = await ask({ op: "switch", sid, previous: compteA, current: compteB });
    expect(sw.purged).toBe(true);
    // Au moment EXACT de la publication, le payload du compte précédent n'est
    // PLUS là : un lecteur concurrent ne peut pas le servir au nouveau compte.
    expect(sw.payloadAtPublish).toBe("");
    // L'époque était DÉJÀ invalidée quand le client a été publié : un lecteur
    // qui démarre pendant la bascule ne peut pas écrire avec l'ancienne
    // époque (son payload est abandonné).
    expect(sw.epochAtPublish).toBeGreaterThan(sw.epochBefore);
    // Le disque est vide : plus rien du compte précédent.
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
  const bridge = readFileSync(BRIDGE, "utf8");
  const scope = readFileSync(SCOPE, "utf8");
  const repair = readFileSync(REPAIR, "utf8");

  test("la purge est UN SEUL endroit, sous la garde d'époque", () => {
    // La purge passe par l'époque de session (#364) : l'invalidation ET la
    // purge sont dans la même section critique, donc une écriture en vol
    // abandonne son payload (le cache purgé ne ressuscite pas).
    expect(scope).toMatch(/SessionEpoch\.invalidate \{[\s\S]*?store\.clearAll\(\)/);
    // UN SEUL effacement dans l'objet : la purge ET la bascule de compte
    // passent par le même endroit (donc la même garde).
    expect(scope.match(/store\.clearAll\(\)/g)?.length).toBe(1);
    // La déconnexion passe par le MÊME endroit (une seule implémentation).
    // #397 : la déconnexion ET la session morte partagent `SessionRepair.purge`
    // (la session persistée + la session en mémoire + le cache).
    expect(repair).toContain("CacheScope.purge(cacheStore)");
    expect(account).toContain("SessionRepair.purge(");
    expect(account).not.toContain("SessionEpoch.invalidate");
  });

  test("l'appairage purge le cache du compte précédent AVANT d'enregistrer la session", () => {
    const iScope = pairing.indexOf("CacheScope.switchAccount(");
    const iSave = pairing.indexOf("sessions.save(");
    expect(iScope).toBeGreaterThan(-1);
    expect(iSave).toBeGreaterThan(-1);
    // AVANT `sessions.save` : si le process meurt entre les deux, la session
    // restaurée est l'ANCIENNE (dont le cache vient d'être purgé), jamais le
    // nouveau compte avec le cache de l'ancien.
    expect(iScope).toBeLessThan(iSave);
    // L'identité comparée vient de la session PERSISTÉE (pas de
    // `AccountStore.current()`, qui vaut `null` : #397 reste ouvert).
    expect(pairing).toContain("AccountIdentity.of(it.endpointUrl, it.username)");
    expect(pairing).toContain("AccountIdentity.of(endpoint, username)");
    // Le code ne s'appuie sur AUCUNE identité de compte non garantie.
    expect(codeOnly(pairing)).not.toContain("AccountStore");
  });

  // #529 : la purge du cache précédent précède la PUBLICATION du nouveau
  // client. L'ordre est fixé par le code EXÉCUTÉ (`CacheScope.switchAccount`),
  // mais le CÂBLAGE de `pairBlocking` est épinglé ici : la publication passe
  // par la bascule, elle n'est jamais faite en dehors.
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
    // La publication est la LAMBDA de la bascule : elle ne peut donc pas
    // précéder la purge (c'est le code exécuté qui fixe l'ordre).
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
    // UNE SEULE publication dans l'appairage (pas de client publié en dehors
    // de la bascule).
    expect(body.split("PronoteSession.set(client)").length - 1).toBe(1);
  });

  test("la session MORTE purge le cache (store vidé ET cache purgé)", () => {
    const iClear = pairing.indexOf("sessions.clear()");
    const iDead = pairing.indexOf("CacheScope.onSessionDead(cacheStore)");
    const iResult = pairing.indexOf("RestoreResult.Dead(");
    expect(iClear).toBeGreaterThan(-1);
    expect(iDead).toBeGreaterThan(-1);
    expect(iResult).toBeGreaterThan(-1);
    // La purge est dans la branche « morte », avant le retour.
    expect(iDead).toBeGreaterThan(iClear);
    expect(iDead).toBeLessThan(iResult);
  });

  test("le pont ET le job de fond passent le store de cache au dépôt d'appairage", () => {
    // Sans store, la purge n'a rien à purger : le job de fond (process neuf)
    // laisserait le cache de l'app intact après une session morte.
    expect(bridge).toContain("PairingRepository(sessions, cacheStore)");
    expect(worker).toContain("PairingRepository(sessions, cacheStore())");
    // Le job purge le MÊME dossier que l'app (verrou partagé, purge commune).
    expect(worker).toContain('FileCacheStore(File(applicationContext.filesDir, "offline"))');
  });

  // #529 : le pont sert le cache à l'ARRIVÉE de l'appel (l'époque est
  // capturée à ce moment-là) : si le cache a été purgé depuis — donc si le
  // compte a changé — l'entrée servie serait celle d'un AUTRE compte.
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
