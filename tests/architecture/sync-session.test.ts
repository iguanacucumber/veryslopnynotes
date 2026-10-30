// #406 : le job de fond doit RESTAURER la session avant toute lecture.
//
// La session vit en RAM (`PronoteSession`) ; un job WorkManager démarre un
// process NEUF, sans interface : la session n'y est donc pas. Le worker
// lisait `PronoteSession.client` (nul) et renvoyait `Result.success()` : le
// sync de fond devenait un no-op, sans réessai.
//
// Ce test lit le VRAI source du worker (jamais une copie) : il échoue dès
// qu'on remet la lecture avant la restauration, ou un `success()` à la place du
// réessai. L'ORDRE est le point : restaurer, PUIS lire.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readBridgeSource } from "../unit/fixtures/bridge-source";

const ROOT = join(import.meta.dir, "..", "..");
const DATA = join(ROOT, "android/data/src/main/java/fr/veryslopnynotes/data");
const WORKER = join(DATA, "PeriodicSyncWorker.kt");
const PAIRING = join(DATA, "PairingRepository.kt");

/** Corps de `doWork()` (jusqu'à la fonction suivante). */
function doWorkBody(src: string): string {
  const start = src.indexOf("override fun doWork()");
  if (start === -1) return "";
  const end = src.indexOf("private fun", start);
  return src.slice(start, end === -1 ? src.length : end);
}

describe("session du job de fond (#406)", () => {
  test("le worker restaure la session AVANT toute lecture", () => {
    const worker = readFileSync(WORKER, "utf8");
    const body = doWorkBody(worker);
    const iRestore = body.indexOf("restoreClient()");
    const iRead = body.indexOf("refresh(");
    expect(iRestore).toBeGreaterThan(-1);
    expect(iRead).toBeGreaterThan(-1);
    // La restauration vient AVANT la lecture : sans session, le job ne lit pas.
    expect(iRestore).toBeLessThan(iRead);
    // La lecture reçoit la session RESTAURÉE (pas un client lu sur le vif).
    expect(body).toContain("syncJobOutcome(restoreClient())");
    expect(worker).toContain("private fun refresh(client: Client): Result");
  });

  test("sans session, le job RÉESSAIE (jamais un succès sans rien faire)", () => {
    const worker = readFileSync(WORKER, "utf8");
    const body = doWorkBody(worker);
    expect(body).toContain("is SyncJobOutcome.Retry -> Result.retry()");
    // Le vieux bug : un client absent = `Result.success()`.
    expect(worker).not.toMatch(/PronoteSession\.client\s*\?:/);
  });

  test("même chemin de restauration que le pont (store chiffré -> tokenLogin)", () => {
    const worker = readFileSync(WORKER, "utf8");
    const bridge = readBridgeSource();
    // Le worker : le MÊME chemin que le pont, pas une session lue sur le vif.
    expect(worker).toContain("val sessions = SessionStores.get(applicationContext)");
    // (#407 : le dépôt reçoit aussi le store de cache — il purge le cache si
    // la session est morte, dans le process NEUF du job comme dans l'app.)
    expect(worker).toMatch(/PairingRepository\(sessions.*\)\.restoreBlocking\(\)/);
    // Le pont : la référence du chemin (store chiffré -> `restoreBlocking`).
    expect(bridge).toContain("SessionStores.get(ctx)");
    expect(bridge).toMatch(/PairingRepository\(sessions.*\)/);
    expect(bridge).toContain("restoreBlocking()");
  });

  test("une SEULE restauration à la fois dans le process (pas d'erreur 25)", () => {
    const pairing = readFileSync(PAIRING, "utf8");
    // Le pont ET le job de fond restaurent la session : en parallèle, deux
    // `tokenLogin` sur le même compte → « Exceeded max authorization
    // requests » → l'établissement LIMITE le compte.
    expect(pairing).toContain("synchronized(restoreLock)");
    // Un verrou de COMPAGNON (partagé par toutes les instances), pas un
    // verrou d'instance : le worker et le pont n'ont pas le même dépôt.
    expect(pairing).toMatch(/companion object \{[\s\S]*private val restoreLock = Any\(\)/);
  });

  // #507 : l'appairage ouvre une session comme la restauration — il devait
  // donc prendre le MÊME verrou. Sans cela, un appairage (pont) et une
  // restauration (job de fond) pouvaient courir en parallèle : deux
  // authentifications sur le même compte (erreur 25), et le client en RAM
  // pouvait être celui d'un compte pendant que la session persistée était
  // celle de l'autre.
  test("l'appairage prend le MÊME verrou de restauration", () => {
    const pairing = readFileSync(PAIRING, "utf8");
    const start = pairing.indexOf("fun pairBlocking(");
    const end = pairing.indexOf("fun restoreBlocking()", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = pairing.slice(start, end);
    // Le verrou partagé du dépôt (pas un verrou d'instance, pas celui du
    // pont : le pont a le sien pour `sessionReady`).
    expect(body).toContain("synchronized(restoreLock)");
  });
});
