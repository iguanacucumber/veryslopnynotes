// #889 : toutes les requêtes scolaires passent par UNE file cadencée.
// Le seau à jetons, la gigue, le cooldown persistant et `Retry-After` sont
// EXÉCUTÉS (VRAI Kotlin), pas relus. La concurrence est prouvée sur la file.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "PacingParityMain.kt");
const LIMIT_DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "RateLimitParityMain.kt");
const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
let limit: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
  limit = await parityToolchain.openParityLink(LIMIT_DRIVER);
}

async function ask(op: unknown): Promise<any> {
  return JSON.parse(await link!.ask(op));
}

async function askLimit(op: unknown): Promise<any> {
  return JSON.parse(await limit!.ask(op));
}

// Les dépôts qui parlent au client mutable. Le job de fond a déjà sa propre
// preuve (`kotlin-local-queue.test.ts`) : ici, tout le reste.
const REPOS = [
  "SyncedRepository.kt",
  "AssignmentsRepository.kt",
  "DiscussionsRepository.kt",
  "ProfileRepository.kt",
  "PairingRepository.kt",
];

describe("une seule file pour tous les accès scolaires (#889)", () => {
  test("les dépôts passent par `ClientQueue`, plus par un fil à eux", () => {
    for (const file of REPOS) {
      const src = codeOnly(readFileSync(join(DATA, file), "utf8"));
      expect({ file, queued: /ClientQueue\.(submit|submitUnit|submitAndAwait)[<(]/.test(src) }).toEqual({
        file,
        queued: true,
      });
      // Un `Thread { ... }` par lecture contournait la file ET le seau.
      if (file !== "PairingRepository.kt") {
        expect({ file, thread: /Thread\s*\{/.test(src) }).toEqual({ file, thread: false });
      }
    }
    const queue = codeOnly(readFileSync(join(DATA, "ClientQueue.kt"), "utf8"));
    expect(queue).toContain("object ClientQueue");
    // UNE seule instanciation de la file, avec le seau unique.
    expect(queue.match(/LocalRequestQueue<[^>]*>\s*\(/g)?.length).toBe(1);
    expect(queue).toContain("LocalRequestQueue<Any>().also { it.attachPacer(pacer) }");
    const files = readdirSync(DATA).filter((f) => f.endsWith(".kt") && f !== "ClientQueue.kt");
    for (const file of files) {
      expect({ file, own: /LocalRequestQueue<[^>]*>\s*\(/.test(codeOnly(readFileSync(join(DATA, file), "utf8"))) }).toEqual({
        file,
        own: false,
      });
    }
  });

  test("le cooldown persistant est branché au pont ET au job de fond", () => {
    const bridge = readFileSync(join(ROOT, "android/app/src/main/java/fr/veryslopnynotes/app/VsnBridge.kt"), "utf8");
    const worker = readFileSync(join(DATA, "PeriodicSyncWorker.kt"), "utf8");
    expect(bridge).toContain('ClientQueue.attachCooldown(FileCooldownStore(File(ctx.filesDir, "school-cooldown")))');
    expect(worker).toContain('ClientQueue.attachCooldown(FileCooldownStore(File(applicationContext.filesDir, "school-cooldown")))');
  });
});

describe("seau à jetons et gigue (#889)", () => {
  test.skipIf(skip)("un jeton par intervalle : les départs sont espacés", async () => {
    const r = await ask({ op: "bucket" });
    expect(r.starts).toEqual([0, 1000, 2000]);
    expect(r.sleeps).toEqual([1000, 1000]);
  });

  test.skipIf(skip)("la gigue ne retarde pas la PREMIÈRE requête, mais décale les suivantes", async () => {
    const r = await ask({ op: "jitter" });
    expect(r.starts).toEqual([0, 1100, 2100]);
    expect(r.sleeps).toEqual([1000, 100, 900, 100]);
  });

  test.skipIf(skip)("la file appelle le seau UNE fois par travail, sans jamais chevaucher", async () => {
    const r = await ask({ op: "queue" });
    expect(r.turns).toBe(20);
    expect(r.workCalls).toBe(20);
    expect(r.callbacks).toBe(20);
    expect(r.maxConcurrent).toBe(1);
  });

  // Preuve de cadence : 6 travaux soumis en rafale ne partent jamais ensemble.
  test.skipIf(skip)("file + seau réel : départs espacés et concurrence 1", async () => {
    const r = await ask({ op: "pacedQueue" });
    expect(r.served).toBe(6);
    expect(r.maxConcurrent).toBe(1);
    const gaps: number[] = r.gaps;
    expect(gaps.length).toBe(5);
    // Marge : un ordonnanceur lent ne fait qu'ALLONGER l'écart.
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(25);
  }, 20000);
});

describe("cooldown persistant et `Retry-After` (#889)", () => {
  test.skipIf(skip)("un second refus ne raccourcit jamais la fenêtre", async () => {
    const r = await ask({ op: "cooldown" });
    expect(r.first).toBe(5000);
    expect(r.kept).toBe(5000);
    expect(r.waited).toEqual([5000]);
  });

  test.skipIf(skip)("`Retry-After` est un plancher, la fenêtre par défaut un repli", async () => {
    const r = await ask({ op: "onFailure" });
    expect(r.retryAfter).toBe(300_000);
    expect(r.fallback).toBe(120_000);
  });

  test.skipIf(skip)("le cooldown survit à un redémarrage (fichier), un fichier corrompu vaut 0", async () => {
    const r = await ask({ op: "persist" });
    expect(r.remaining).toBe(12_000);
    expect(r.corrupt).toBe(0);
  });

  test.skipIf(skip)("delta-seconds ET date HTTP sont acceptés ; le reste vaut null", async () => {
    const now = 1_700_000_000_000;
    const date = new Date(now + 90_000).toUTCString();
    const r = await askLimit({ op: "retryAfter", date });
    expect(r.seconds).toBe(120_000);
    expect(r.zero).toBe(0);
    expect(r.negative).toBe(0);
    expect(r.date).toBe(90_000);
    expect(r.bad).toBeNull();
    expect(r.header).toBe(30_000);
  });

  test.skipIf(skip)("la porte du client honore un `Retry-After` plus long que 2 min", async () => {
    const r = await askLimit({ op: "gateRetryAfter" });
    expect(r.remaining).toBe(300_000);
    // À 2 min (l'ancienne fenêtre), on attend TOUJOURS.
    expect(r.stillCooling).toBe(true);
    expect(r.after).toBeNull();
  });

  test("la réponse 429 transporte l'en-tête, jamais un mot du message", () => {
    const http = codeOnly(
      readFileSync(join(ROOT, "android/pronote/src/main/java/fr/veryslopnynotes/pronote/HttpSession.kt"), "utf8"),
    );
    const comm = codeOnly(
      readFileSync(join(ROOT, "android/pronote/src/main/java/fr/veryslopnynotes/pronote/Communication.kt"), "utf8"),
    );
    const client = codeOnly(
      readFileSync(join(ROOT, "android/pronote/src/main/java/fr/veryslopnynotes/pronote/Client.kt"), "utf8"),
    );
    expect(http).toContain("retryAfterMs(response.headers)");
    expect(comm).toContain("retryAfterMs(res.headers)");
    expect(comm).toContain("retryAfterMs(response.headers)");
    expect(client).toContain("rateLimitGate.trip(e.retryAfterMs)");
    expect(client).toContain("rateLimitGate.trip(rate.retryAfterMs)");
  });
});
