// #406 : le job de fond ne faisait RIEN quand la session n'était pas en RAM.
//
// WorkManager démarre le process SANS interface : la session vit en RAM
// (`PronoteSession`), donc le worker lisait un client nul et renvoyait
// `Result.success()` — un succès sans rien avoir fait, et sans réessai. Le
// sync de fond était un no-op dès que l'app était fermée depuis plus d'un
// cycle de job.
//
// VRAI Kotlin compilé : `SyncJobOutcome` (android/data, logique pure : aucun
// import Android) est compilé par le harnais puis piloté par `SyncJobMain` —
// ce n'est pas un miroir TS, c'est le code de production EXÉCUTÉ.
//
// Outillage `kotlinc`/`java` absent = SKIP BRUYANT du harnais (jamais un faux
// vert) ; un échec de compilation, lui, est un défaut (le test rougit).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const WORKER = join(DATA, "PeriodicSyncWorker.kt");
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "SyncJobMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

async function ask(op: unknown): Promise<any> {
  return JSON.parse(await link!.ask(op));
}

describe("job de fond : session absente = RÉESSAI (#406)", () => {
  test.skipIf(skip)("sans session, le job réessaie (retry) au lieu de déclarer un succès", async () => {
    const sans = await ask({ op: "outcome", hasSession: false });
    expect(sans.outcome).toBe("retry");
    // ... et AVEC session, il LIT : le job n'est pas un no-op.
    const avec = await ask({ op: "outcome", hasSession: true });
    expect(avec.outcome).toBe("refresh");
  });

  test("câblage : le worker réessaie sans session, et ne déclare JAMAIS un succès", () => {
    const worker = readFileSync(WORKER, "utf8");
    // La branche « pas de session » est un RÉESSAI (backoff WorkManager).
    expect(worker).toContain("is SyncJobOutcome.Retry -> Result.retry()");
    // Le vieux bug : un client absent renvoyait `Result.success()` (rien n'était
    // fait, et le job ne réessayait jamais).
    expect(worker).not.toMatch(/PronoteSession\.client\s*\?:/);
    // La session du job vient de la RESTAURATION, pas d'une lecture directe.
    expect(worker).toContain("syncJobOutcome(restoreClient())");
  });
});
