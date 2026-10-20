// #364 : la purge de déconnexion est annulée par une lecture en vol.
//
// VRAI Kotlin compilé : `SessionEpoch` et `FileCacheStore` (android/data,
// logique pure : `java.io` seul, aucun import Android) sont compilés par le
// harnais puis pilotés par `CacheEpochParityMain` — ce n'est pas un miroir TS,
// c'est le code de production exécuté. Les trois critères du ticket portent
// dessus :
//   1. une déconnexion pendant une lecture en vol → le cache reste VIDE sur le
//      disque et l'entrée n'est pas re-servie ;
//   2. deux écrivains concurrents sur le même dossier → le fichier relu est
//      TOUJOURS parsable (jamais tronqué, jamais entrelacé) ;
//   3. une lecture normale (sans déconnexion) → le cache est bien écrit.
// Outillage `kotlinc`/`java` absent = SKIP BRUYANT du harnais (jamais un faux
// vert) ; un échec de compilation, lui, est un défaut (le test rougit).
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const CACHE = join(DATA, "OfflineCache.kt");
const POLICY = join(DATA, "CachePolicy.kt");
const REPO = join(DATA, "SyncedRepository.kt");
const ACCOUNT = join(DATA, "AccountStore.kt");
const WORKER = join(DATA, "PeriodicSyncWorker.kt");
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "CacheEpochParityMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

afterAll(async () => {
  if (!link) return;
  // Les dossiers temporaires du pilote sont supprimés (le processus est tué
  // juste après, le hook de fermeture n'aurait pas tourné).
  try {
    await link.ask({ op: "cleanup" });
  } catch {
    // le pilote est déjà mort : rien à nettoyer.
  }
});

async function ask(op: unknown): Promise<any> {
  return JSON.parse(await link!.ask(op));
}

describe("purge de déconnexion (#364)", () => {
  test("câblage : l'époque est capturée AVANT la lecture, revérifiée AVANT l'écriture", () => {
    const repo = readFileSync(REPO, "utf8");
    const iEpoch = repo.indexOf("SessionEpoch.current()");
    const iRead = repo.indexOf("readLocal(resource, query)");
    const iGuard = repo.indexOf("SessionEpoch.writeIfCurrent");
    const iSave = repo.indexOf("store.save(");
    expect(iEpoch).toBeGreaterThan(-1);
    expect(iRead).toBeGreaterThan(-1);
    expect(iGuard).toBeGreaterThan(-1);
    expect(iSave).toBeGreaterThan(-1);
    // Capturée avant la lecture locale (le client peut mettre des secondes).
    expect(iEpoch).toBeLessThan(iRead);
    // Revérifiée juste avant l'écriture du cache.
    expect(iGuard).toBeLessThan(iSave);
    // L'écriture passe par la garde, pas par un `store.save` nu.
    expect(repo.match(/store\.save\(/g)?.length).toBe(1);
  });

  test("câblage : la déconnexion invalide l'époque ET purge dans la même section critique", () => {
    const acc = readFileSync(ACCOUNT, "utf8");
    const iLogout = acc.indexOf("fun logout(");
    expect(iLogout).toBeGreaterThan(-1);
    // #407 : la purge est UN SEUL endroit (`CacheScope.purge`) — la
    // déconnexion, l'appairage d'un autre compte et la session morte y
    // passent tous, donc sous la même garde d'époque.
    // #397 : la déconnexion ET la session morte partagent le même code de
    // purge (`SessionRepair.purge`) — l'UNIQUE appel de `CacheScope.purge`
    // hors `CacheScope` lui-même.
    expect(acc).toContain("SessionRepair.purge(");
    expect(acc).not.toContain("SessionEpoch.invalidate");
    const repair = readFileSync(join(DATA, "SessionRepair.kt"), "utf8");
    expect(repair).toContain("CacheScope.purge(cacheStore)");
    expect(repair).not.toContain("SessionEpoch.invalidate");
    // La purge est DANS la garde (une seule section critique) : l'invalidation
    // de l'époque et l'effacement du cache sont dans le même bloc.
    const scope = readFileSync(join(DATA, "CacheScope.kt"), "utf8");
    expect(scope).toContain("SessionEpoch.invalidate { store.clearAll() }");
    // La purge brute ne subsiste pas (elle passerait hors section critique).
    expect(scope.match(/store\.clearAll\(\)/g)?.length).toBe(1);
  });

  test("câblage : le worker de fond écrit sous la même garde", () => {
    const worker = readFileSync(WORKER, "utf8");
    expect(worker).toContain("SessionEpoch.current()");
    expect(worker).toContain("SessionEpoch.writeIfCurrent");
    // Plus aucune écriture nue du cache.
    expect(worker.match(/store\.save\(/g)?.length).toBe(1);
  });

  test("câblage : le contrat du cache ne bouge pas (ressources, TTL, clé, format disque)", () => {
    const policy = readFileSync(POLICY, "utf8");
    // TTL et ressources cachables : inchangés (#365 traite la clé de requête,
    // pas ce fichier).
    expect(policy).toContain("const val TTL_GRADES_MS = 15L * 60L * 1000L");
    expect(policy).toContain("const val TTL_ASSIGNMENTS_MS = 15L * 60L * 1000L");
    expect(policy).toContain("const val TTL_TIMETABLE_MS = 60L * 60L * 1000L");
    expect(policy).toContain("const val GRADES = \"grades\"");
    // Format sur disque : un fichier par ressource, en-tête (horodatage +
    // requête, #365) puis payload.
    const cache = readFileSync(CACHE, "utf8");
    expect(cache).toContain("\"cache_$resource.txt\"");
    expect(cache).toContain("val head = \"$fetchedAt\\t${CachePolicy.normalizeQuery(query)}\"");
    expect(cache).toContain("\"$head\\n$payload\"");
  });

  test.skipIf(skip)("déconnexion pendant une lecture en vol : le cache reste vide, l'entrée n'est pas re-servie", async () => {
    const store = await ask({ op: "newStore" });
    const sid = store.sid as number;
    // Une lecture précédente a bien écrit le cache.
    await ask({ op: "write", sid, resource: "grades", payload: '{"grades":[{"moyenne":15}]}', fetchedAt: 1000 });
    expect((await ask({ op: "load", sid, resource: "grades" })).found).toBe(true);

    // Une lecture EN VOL part : elle capture l'époque avant de lire.
    const begin = await ask({ op: "readBegin" });
    expect(typeof begin.epoch).toBe("number");

    // ... la déconnexion passe (purge + invalidation) ...
    const after = await ask({ op: "logout", sid });
    expect(after.epoch).toBeGreaterThan(begin.epoch);

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

    // Le disque est vide : plus aucune donnée du compte déconnecté.
    expect((await ask({ op: "files", sid })).files).toEqual([]);
    // L'entrée n'est pas re-servie (pas de cache « frais » pour le compte suivant).
    const loaded = await ask({ op: "load", sid, resource: "grades" });
    expect(loaded.found).toBe(false);
  });

  test.skipIf(skip)("lecture normale (sans déconnexion) : le cache est bien écrit", async () => {
    const store = await ask({ op: "newStore" });
    const sid = store.sid as number;
    const begin = await ask({ op: "readBegin" });
    const end = await ask({
      op: "readEnd",
      epoch: begin.epoch,
      sid,
      resource: "grades",
      payload: '{"grades":[{"moyenne":12}]}',
      fetchedAt: 4242,
    });
    expect(end.written).toBe(true);
    const loaded = await ask({ op: "load", sid, resource: "grades" });
    expect(loaded.found).toBe(true);
    expect(loaded.payload).toBe('{"grades":[{"moyenne":12}]}');
    expect(loaded.fetchedAt).toBe(4242);
    // Format sur disque inchangé : une ligne d'en-tête (horodatage + requête,
    // #365), puis le payload brut.
    const raw = await ask({ op: "raw", sid, resource: "grades" });
    expect(raw.exists).toBe(true);
    expect(raw.content).toBe('4242\t\n{"grades":[{"moyenne":12}]}');
  });

  test.skipIf(skip)("deux écrivains concurrents (deux instances, un dossier) : le fichier reste parsable", async () => {
    const a = await ask({ op: "newStore" });
    // Le worker de fond a sa PROPRE instance sur le même dossier.
    const b = await ask({ op: "newStoreSameDir", sid: a.sid });
    const res = await ask({
      op: "concurrent",
      a: a.sid,
      b: b.sid,
      resource: "grades",
      rounds: 20,
      size: 32768,
    });
    // Le lecteur a bien observé le fichier pendant les écritures.
    expect(res.reads).toBeGreaterThan(0);
    // Jamais un fichier tronqué (timestamp illisible) ni entrelacé (payload
    // qui n'est pas l'un des payloads écrits).
    expect(res.bad).toBe(0);
    expect(res.mixed).toBe(0);
  });
});
