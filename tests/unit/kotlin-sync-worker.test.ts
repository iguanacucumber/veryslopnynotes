// #406 : le job de fond ne faisait RIEN quand la session n'était pas en RAM.
//
// WorkManager démarre le process SANS interface : la session vit en RAM
// (`PronoteSession`), donc le worker lisait un client nul et renvoyait
// `Result.success()` — un succès sans rien avoir fait, et sans réessai. Le
// sync de fond était un no-op dès que l'app était fermée depuis plus d'un
// cycle de job.
//
// #403 : le job passe par la file PARTAGÉE (celle de l'interface) : le
// `Client` est mutable, donc une lecture de l'écran et une du job en
// parallèle = deux logins sur le même compte (erreur 25 côté établissement).
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

// #403 : le job passe par la file PARTAGÉE, et sa SEMANTIQUE de résultat
// reste la même (session morte = appairage, autre échec = réessai).
describe("job de fond : lecture par la file partagée (#403)", () => {
  test("câblage : le worker passe par la file, il ne lit plus le client en direct", () => {
    const worker = readFileSync(WORKER, "utf8");
    // La lecture passe par LA file partagée (celle des écrans).
    expect(worker).toContain("ClientQueue.submitAndAwait(");
    // Aucune lecture directe du client : ni payload, ni appel de méthode.
    expect(worker).not.toMatch(/Payload\(/);
    expect(worker).not.toMatch(/\bclient\./);
    // La porte unique des lectures, et une clé namespacée (jamais celle d'un
    // écran : un résultat étranger ne peut pas être livré au job).
    expect(worker).toContain("cachedRead(client, resource,");
    expect(worker).toContain('"job|$resource|"');
    // L'attente est BORNÉE : le job ne bloque jamais WorkManager indéfiniment.
    expect(worker).toContain("READ_TIMEOUT_MS");
  });

  test.skipIf(skip)("la sémantique de résultat est PRÉSERVÉE : session morte = appairage, sinon réessai", async () => {
    const dead = await ask({ op: "decision", cause: "session expirée" });
    expect(dead.decision).toBe("sessionDead");
    const other = await ask({ op: "decision", cause: "reseau injoignable" });
    expect(other.decision).toBe("retry");
    const loaded = await ask({ op: "decision", cause: null });
    expect(loaded.decision).toBe("loaded");
    expect(loaded.payload).toBe("payload");
  });

  test.skipIf(skip)("une lecture qui jette devient un RÉSULTAT (la file ne perd pas ses callbacks)", async () => {
    const failed = await ask({ op: "safeRead", cause: "reseau injoignable" });
    expect(failed.read).toBe("failed");
    expect(failed.cause).toBe("reseau injoignable");
    const ok = await ask({ op: "safeRead", cause: null });
    expect(ok.read).toBe("ok");
    expect(ok.payload).toBe("payload");
  });
});
