// Le job de fond doit RESTAURER la session avant toute lecture : WorkManager
// démarre un process NEUF, sans interface, où `PronoteSession` est vide. Sans
// restauration, le job lisait un client nul et renvoyait `success()` : no-op.
// L'ORDRE est le point : restaurer, PUIS lire.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readBridgeSource } from "../unit/fixtures/bridge-source";

const ROOT = join(import.meta.dir, "..", "..");
const DATA = join(ROOT, "android/data/src/main/java/fr/veryslopnynotes/data");
const WORKER = join(DATA, "PeriodicSyncWorker.kt");
const PAIRING = join(DATA, "PairingRepository.kt");

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
    expect(iRestore).toBeLessThan(iRead);
    expect(body).toContain("syncJobOutcome(restoreClient())");
    expect(worker).toContain("private fun refresh(client: Client): Result");
  });

  test("sans session, le job RÉESSAIE (jamais un succès sans rien faire)", () => {
    const worker = readFileSync(WORKER, "utf8");
    const body = doWorkBody(worker);
    expect(body).toContain("is SyncJobOutcome.Retry -> Result.retry()");
    expect(worker).not.toMatch(/PronoteSession\.client\s*\?:/);
  });

  test("même chemin de restauration que le pont (store chiffré -> tokenLogin)", () => {
    const worker = readFileSync(WORKER, "utf8");
    const bridge = readBridgeSource();
    expect(worker).toContain("val sessions = SessionStores.get(applicationContext)");
    // Le dépôt reçoit aussi le store de cache : il purge si la session est morte,
    // dans le process NEUF du job comme dans l'app.
    expect(worker).toMatch(/PairingRepository\(sessions.*\)\.restoreBlocking\(\)/);
    expect(bridge).toContain("SessionStores.get(ctx)");
    expect(bridge).toMatch(/PairingRepository\(sessions.*\)/);
    expect(bridge).toContain("restoreBlocking()");
  });

  test("une SEULE restauration à la fois dans le process (pas d'erreur 25)", () => {
    const pairing = readFileSync(PAIRING, "utf8");
    // Le pont ET le job restaurent la session : en parallèle, deux `tokenLogin`
    // sur le même compte → erreur 25 → l'établissement LIMITE le compte.
    expect(pairing).toContain("synchronized(restoreLock)");
    // Verrou de COMPAGNON partagé : le worker et le pont n'ont pas le même dépôt.
    expect(pairing).toMatch(/companion object \{[\s\S]*private val restoreLock = Any\(\)/);
  });

  // L'appairage ouvre une session comme la restauration et doit prendre le MÊME
  // verrou : sinon appairage (pont) et restauration (job) courent en parallèle,
  // avec deux authentifications et un client en RAM du mauvais compte.
  test("l'appairage prend le MÊME verrou de restauration", () => {
    const pairing = readFileSync(PAIRING, "utf8");
    const start = pairing.indexOf("fun pairBlocking(");
    const end = pairing.indexOf("fun restoreBlocking()", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = pairing.slice(start, end);
    // Le verrou partagé du dépôt, pas celui du pont (réservé à `sessionReady`).
    expect(body).toContain("synchronized(restoreLock)");
  });
});
