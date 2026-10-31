// Le job de fond ne doit pas être un no-op quand la session n'est pas en RAM :
// sans session il RÉESSAIE, et il passe par la file PARTAGÉE (le `Client` est
// mutable : deux logins parallèles = erreur 25).
// VRAI Kotlin compilé par le harnais ; outillage absent = SKIP BRUYANT.
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
    // Un client absent renvoyait `Result.success()` : rien fait, aucun réessai.
    expect(worker).not.toMatch(/PronoteSession\.client\s*\?:/);
    // La session du job vient de la RESTAURATION, pas d'une lecture directe.
    expect(worker).toContain("syncJobOutcome(restoreClient())");
  });
});

// Le job passe par la file PARTAGÉE ; la sémantique de résultat ne change pas.
describe("job de fond : lecture par la file partagée (#403)", () => {
  test("câblage : le worker passe par la file, il ne lit plus le client en direct", () => {
    const worker = readFileSync(WORKER, "utf8");
    // La lecture passe par LA file partagée (celle des écrans).
    expect(worker).toContain("ClientQueue.submitAndAwait(");
    // Aucune lecture directe du client : ni payload, ni appel de méthode.
    expect(worker).not.toMatch(/Payload\(/);
    expect(worker).not.toMatch(/\bclient\./);
    // La porte unique des lectures, avec une clé namespacée (jamais celle d'un écran).
    expect(worker).toContain("cachedRead(client, resource,");
    expect(worker).toContain('"job|$resource|"');
    // L'attente est BORNÉE : le job ne bloque jamais WorkManager indéfiniment.
    expect(worker).toContain("READ_TIMEOUT_MS");
  });

  test.skipIf(skip)("la sémantique de résultat est PRÉSERVÉE : session morte = appairage, sinon réessai", async () => {
    // Session morte = l'erreur RÉELLE de l'établissement (G=10), pas un mot du message.
    const dead = await ask({ op: "decision", kind: "deadSession" });
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

// G=22 n'est PAS une session morte : le message contient « session », et la
// détection par motif purgeait à tort le cache hors ligne.
describe("session morte : G=22 n'en est PAS une", () => {
  test.skipIf(skip)("G=22 -> réessai, jamais « session morte »", async () => {
    const r = await ask({ op: "decision", kind: "expiredObject" });
    expect(r.decision).toBe("retry");
  });

  test("le VRAI message G=22 contient bien « session » (l'exclusion par type est donc nécessaire)", () => {
    // Le message est lu dans la source de production : si PRONOTE change de
    // formulation, le test suit — il ne fige pas une recopie.
    const comm = readFileSync(
      join(ROOT, "android", "pronote", "src", "main", "java", "fr", "veryslopnynotes", "pronote", "Communication.kt"),
      "utf8",
    );
    const m = comm.match(/22 to "([^"]+)"/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/session/i);
    // La décision tranche par TYPE : `ExpiredObject` est exclu, pas son message.
    const failure = readFileSync(join(DATA, "SessionFailure.kt"), "utf8");
    expect(failure).toContain("e is ExpiredObject");
  });
});

// La décision « session morte » ne se fie pas à un MOT du message, en partie
// écrit par l'établissement : un mot détruisait la session et tout le cache hors ligne.
describe("session morte : la décision tranche par TYPE et par code G (#520)", () => {
  test.skipIf(skip)("un message d'ÉTABLISSEMENT (« Confirmation de connexion ») = RÉESSAI, pas « session morte »", async () => {
    const r = await ask({ op: "decision", kind: "establishmentError" });
    expect(r.decision).toBe("retry");
  });

  test.skipIf(skip)("une VRAIE session morte (G=10) reste détectée", async () => {
    const r = await ask({ op: "decision", kind: "deadSession" });
    expect(r.decision).toBe("sessionDead");
  });

  test("la décision ne cherche plus de MOT dans le message (le code `G` tranche)", () => {
    const failure = readFileSync(join(DATA, "SessionFailure.kt"), "utf8");
    // Plus aucun motif : ni regex, ni recherche de sous-chaîne.
    expect(failure).not.toMatch(/Regex\(/);
    expect(failure).not.toMatch(/containsMatchIn/);
    expect(failure).not.toMatch(/\.contains\(/);
    // L'information vient du TYPE de l'exception et du code `G`.
    expect(failure).toContain("pronoteErrorCode");
    expect(failure).toContain("is PronoteAPIError");
  });

  test("le statut HTTP d'un refus est un CHAMP de l'erreur (401 = session morte)", () => {
    // Le port jette l'erreur avec son statut : la décision ne relit jamais le message.
    const comm = readFileSync(
      join(ROOT, "android", "pronote", "src", "main", "java", "fr", "veryslopnynotes", "pronote", "Communication.kt"),
      "utf8",
    );
    expect(comm).toContain("httpStatus = response.status");
    const errors = readFileSync(
      join(ROOT, "android", "pronote", "src", "main", "java", "fr", "veryslopnynotes", "pronote", "Errors.kt"),
      "utf8",
    );
    expect(errors).toContain("val httpStatus: Int? = null");
  });
});
