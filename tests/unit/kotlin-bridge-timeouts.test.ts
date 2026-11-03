// #905 : le contrat des délais du pont est EXÉCUTÉ, pas relu.
//
// Les constantes Kotlin (`BridgeTimeouts`) sont comparées à leur miroir TS ;
// l'attente native rend la main sur l'échéance ET sur l'abandon de l'appelant,
// donc un `bridge.cancel` ne laisse pas un fil orphelin jusqu'au plafond.
// Outillage absent = SKIP BRUYANT.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BRIDGE_TIMEOUTS,
  DEFAULT_TIMEOUT_MS,
  MAX_NATIVE_WAIT_MS,
  MAX_RESOURCE_DEADLINE_MS,
  MAX_RESOURCE_REQUESTS,
  NATIVE_WAIT_MS,
  REQUEST_DEADLINE_MS,
  RESOURCE_DEADLINE_MS,
  RESOURCE_TIMEOUT_MARGIN_MS,
  resourceTimeoutMs,
} from "../../web/src/bridge/types";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "BridgeTimeoutsMain.kt");
const HTTP = join(ROOT, "android/pronote/src/main/java/fr/veryslopnynotes/pronote/HttpSession.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

interface WaitAnswer {
  outcome: "done" | "timed_out" | "cancelled";
  elapsedMs: number;
  done: boolean;
}

async function wait(op: Record<string, number>): Promise<WaitAnswer> {
  return JSON.parse(await link!.ask({ op: "wait", ...op })) as WaitAnswer;
}

describe("contrat des délais du pont (#905)", () => {
  test.skipIf(skip)("les constantes Kotlin exécutées sont le miroir exact du TS", async () => {
    const kotlin = JSON.parse(await link!.ask({ op: "timeouts" })) as {
      REQUEST_DEADLINE_MS: number;
      AWAIT_DEFAULT_MS: number;
      AWAIT_MANUAL_MS: number;
      ATTACHMENT_BUDGET_MS: number;
      AWAIT_LLM_MS: number;
      HOMEWORK_LLM_TIMEOUT_MS: number;
      AWAIT_PHOTO_MS: number;
      MAX_NATIVE_WAIT_MS: number;
      MAX_RESOURCE_REQUESTS: number;
      MAX_RESOURCE_DEADLINE_MS: number;
      resources: Record<string, number>;
    };
    expect(kotlin.AWAIT_DEFAULT_MS).toBe(NATIVE_WAIT_MS.default);
    expect(kotlin.AWAIT_MANUAL_MS).toBe(NATIVE_WAIT_MS.manual);
    expect(kotlin.ATTACHMENT_BUDGET_MS).toBe(NATIVE_WAIT_MS.attachment);
    expect(kotlin.AWAIT_LLM_MS).toBe(NATIVE_WAIT_MS.llm);
    expect(kotlin.MAX_NATIVE_WAIT_MS).toBe(MAX_NATIVE_WAIT_MS);
    // La table par ressource entière : une clé ajoutée d'un seul côté échoue.
    expect(kotlin.resources).toEqual(RESOURCE_DEADLINE_MS);
    expect(kotlin.MAX_RESOURCE_REQUESTS).toBe(MAX_RESOURCE_REQUESTS);
    expect(kotlin.MAX_RESOURCE_DEADLINE_MS).toBe(MAX_RESOURCE_DEADLINE_MS);
    // Le budget HTTP de #868 est la brique de l'échéance par ressource.
    expect(kotlin.REQUEST_DEADLINE_MS).toBe(REQUEST_DEADLINE_MS);
    const source = readFileSync(HTTP, "utf8");
    const httpBudget = Number(
      /DEFAULT_REQUEST_DEADLINE_MS\s*=\s*([\d_]+)/.exec(source)?.[1]?.replace(/_/g, ""),
    );
    expect(httpBudget).toBe(REQUEST_DEADLINE_MS);
  });

  test.skipIf(skip)("le budget JS d'une lecture dépasse toujours son échéance native", () => {
    for (const [key, native] of Object.entries(RESOURCE_DEADLINE_MS)) {
      const js = resourceTimeoutMs(key as keyof typeof RESOURCE_DEADLINE_MS);
      expect(js).toBe(native + RESOURCE_TIMEOUT_MARGIN_MS);
      expect(js).toBeGreaterThan(native);
      // Le natif rend son résultat partiel AVANT que le JS n'abandonne.
      expect(js).toBeLessThanOrEqual(DEFAULT_TIMEOUT_MS);
    }
    expect(DEFAULT_TIMEOUT_MS).toBeGreaterThan(MAX_NATIVE_WAIT_MS);
    expect(DEFAULT_TIMEOUT_MS).toBeGreaterThan(MAX_RESOURCE_DEADLINE_MS);
    // Aucun délai par méthode ne passe sous le plafond natif (règle #371).
    for (const [method, timeout] of Object.entries(BRIDGE_TIMEOUTS)) {
      if (timeout === 0) continue;
      expect(timeout).toBeGreaterThanOrEqual(MAX_NATIVE_WAIT_MS);
      expect(method.length).toBeGreaterThan(0);
    }
  });

  test.skipIf(skip)("l'attente native rend la main à l'échéance", async () => {
    const answer = await wait({ timeoutMs: 200 });
    expect(answer.outcome).toBe("timed_out");
    expect(answer.done).toBe(false);
    expect(answer.elapsedMs).toBeGreaterThanOrEqual(150);
    expect(answer.elapsedMs).toBeLessThan(2000);
  });

  test.skipIf(skip)("l'attente native rend la main sur l'abandon, sans attendre le plafond", async () => {
    const answer = await wait({ timeoutMs: 5000, cancelAfterMs: 100 });
    expect(answer.outcome).toBe("cancelled");
    expect(answer.done).toBe(false);
    // Un `CountDownLatch.await` nu aurait attendu 5 s : c'est le fil orphelin.
    expect(answer.elapsedMs).toBeLessThan(1500);
  });

  test.skipIf(skip)("le résultat déjà livré n'est pas perdu", async () => {
    const answer = await wait({ timeoutMs: 5000, countDownAfterMs: 50 });
    expect(answer.outcome).toBe("done");
    expect(answer.done).toBe(true);
    expect(answer.elapsedMs).toBeLessThan(1500);
  });

  test.skipIf(skip)("le pont attend par tranches et annule son travail", () => {
    const bridge = readFileSync(
      join(ROOT, "android/app/src/main/java/fr/veryslopnynotes/app/VsnBridge.kt"),
      "utf8",
    );
    const start = bridge.indexOf("internal fun <T> await(");
    expect(start).toBeGreaterThan(-1);
    const body = bridge.slice(start, bridge.indexOf("internal fun emitProgress", start));
    expect(body).toContain("BridgeWait.await(latch, timeoutMs, cancellation)");
    expect(body).toContain("cancellation?.cancel()");
    // Une ressource lit son échéance, pas le défaut d'un appel court.
    const resources = readFileSync(
      join(ROOT, "android/app/src/main/java/fr/veryslopnynotes/app/VsnBridgeResources.kt"),
      "utf8",
    );
    expect(resources).toContain("BridgeTimeouts.resourceDeadlineMs(key)");
    expect(resources).toContain("deadlineOutcome(resource, query");
  });
});
