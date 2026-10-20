// #393 : le pont ne sature plus — VRAI Kotlin compilé.
//
// `BridgeExecutors` (android/app, logique pure : `java.util.concurrent` seul,
// aucun import Android) est compilée par le harnais puis pilotée par
// `BridgeExecutorsMain` : ce n'est pas un miroir TS, c'est le code de
// production exécuté. Les deux critères du #393 portent dessus :
//   1. le pont ne fait PAS la queue : un appel court (`app.back`) répond
//      pendant que cinq appels longs sont en vol ;
//   2. les opérations LLM ont leur PROPRE file, bornée à deux fils.
// Outillage `kotlinc`/`java` absent = SKIP BRUYANT du harnais (jamais un faux
// vert) ; un échec de compilation, lui, est un défaut (le test rougit).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const APP = join(ROOT, "android", "app", "src", "main", "java", "fr", "veryslopnynotes", "app");
const EXECUTORS = join(APP, "BridgeExecutors.kt");
const BRIDGE = join(APP, "VsnBridge.kt");
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "BridgeExecutorsMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

interface ShortResult {
  delayMs: number;
  thread: string;
  daemon: boolean;
  timedOut: boolean;
}

interface Stats {
  started: number;
  callsMax: number;
  llmMax: number;
  threads: string[];
}

async function ask(op: unknown): Promise<string> {
  return link!.ask(op);
}

async function newExecutors(): Promise<number> {
  return (JSON.parse(await ask({ op: "execNew" })) as { qid: number }).qid;
}

/** Attend que `want` travaux lents soient DÉMARRÉS (ils restent bloqués). */
async function waitStarted(qid: number, want: number, timeoutMs = 8000): Promise<number> {
  const r = JSON.parse(await ask({ op: "execWaitStarted", qid, want, timeoutMs })) as {
    started: number;
    timedOut: boolean;
  };
  expect(r.timedOut).toBe(false);
  return r.started;
}

/** Soumet un appel court et attend son DÉBUT d'exécution. */
async function shortCall(qid: number, method = "app.back"): Promise<ShortResult> {
  await ask({ op: "execShort", qid, method });
  return JSON.parse(await ask({ op: "execWaitShort", qid, timeoutMs: 8000 })) as ShortResult;
}

async function stats(qid: number): Promise<Stats> {
  return JSON.parse(await ask({ op: "execStats", qid })) as Stats;
}

describe("exécuteurs du pont (#393)", () => {
  test("câblage : le pont n'a plus de pool fixe de deux fils, le LLM a sa file", () => {
    const bridge = readFileSync(BRIDGE, "utf8");
    // L'ancien pool : deux fils fixes, IMMOBILISÉS par l'attente de chaque
    // lecture (le bouton retour était mort 20 s).
    expect(bridge).not.toContain("newFixedThreadPool(2)");
    expect(bridge).not.toContain("newFixedThreadPool");
    // Les deux files viennent de `BridgeExecutors`, et la méthode choisit sa
    // file (le LLM à part).
    expect(bridge).toContain("BridgeExecutors()");
    expect(bridge).toContain("executors.workerFor(method).execute");
    expect(bridge).toContain("executors.shutdown()");
    // La logique pure ne connaît ni Android ni le reste du paquet app : elle
    // compile seule dans le harnais de parité JVM.
    const executors = readFileSync(EXECUTORS, "utf8");
    expect(executors).not.toContain("import android.");
    expect(executors).not.toContain("android.os");
  });

  test.skipIf(skip)("cinq appels longs en vol n'immobilisent pas un appel court", async () => {
    const qid = await newExecutors();
    try {
      // Cinq lectures longues, toutes DÉMARRÉES et bloquées.
      await ask({ op: "execSlow", qid, count: 5, method: "resources.load" });
      expect(await waitStarted(qid, 5)).toBe(5);
      // Le bouton retour part TOUT DE SUITE : le pont ne fait pas la queue.
      const court = await shortCall(qid);
      expect(court.timedOut).toBe(false);
      expect(court.delayMs).toBeLessThan(3000);
      // Les cinq tournent EN MÊME TEMPS : un pool de deux fils n'aurait pu en
      // faire tourner que deux à la fois.
      const s = await stats(qid);
      expect(s.callsMax).toBe(5);
      // Fils daemon : la file ne retient jamais le process.
      expect(court.daemon).toBe(true);
    } finally {
      await ask({ op: "execRelease", qid });
      await ask({ op: "execShutdown", qid });
    }
  });

  test.skipIf(skip)("les opérations LLM ont leur PROPRE file, bornée à deux fils", async () => {
    const qid = await newExecutors();
    try {
      // Deux appels LLM bloqués : ils occupent les deux fils de la file LLM.
      await ask({ op: "execSlow", qid, count: 2, method: "llm.askHomework" });
      expect(await waitStarted(qid, 2)).toBe(2);
      // Le TROISIÈME appel LLM attend un fil libre : la file LLM est bornée.
      await ask({ op: "execSlow", qid, count: 1, method: "llm.generateRevision" });
      // Le délai n'est PAS le contrat : ce qui l'est, c'est que le troisième
      // appel ne DÉMARRE PAS pendant que les deux autres bloquent les deux
      // fils. 150 ms suffisent à le montrer (les deux premiers sont déjà
      // démarrés et bloqués : le troisième ne peut pas obtenir de fil).
      const troisieme = JSON.parse(
        await ask({ op: "execWaitStarted", qid, want: 3, timeoutMs: 150 }),
      ) as { started: number; timedOut: boolean };
      expect(troisieme.timedOut).toBe(true);
      expect(troisieme.started).toBe(2);
      // Un appel court n'attend PAS : la file LLM ne bloque pas le pont.
      const court = await shortCall(qid);
      expect(court.timedOut).toBe(false);
      expect(court.delayMs).toBeLessThan(3000);
      // Le court est sur un fil d'APPEL, pas sur un fil LLM.
      expect(court.thread).toContain("vsn-bridge");
      expect(court.thread).not.toContain("vsn-bridge-llm");
      // Les fils LLM sont bien les leurs.
      const s = await stats(qid);
      expect(s.llmMax).toBe(2);
      expect(s.threads.filter((t) => t.includes("vsn-bridge-llm"))).toHaveLength(2);
    } finally {
      await ask({ op: "execRelease", qid });
      await ask({ op: "execShutdown", qid });
    }
  });
});
