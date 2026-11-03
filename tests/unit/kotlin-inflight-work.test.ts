// #876 : une réponse IA/photo/profil retardée ne doit JAMAIS être livrée après
// une déconnexion, et son fil ne doit pas survivre. Le registre et son
// annulation sont EXÉCUTÉS (Kotlin compilé), pas relus.
// Outillage absent = SKIP BRUYANT, jamais un faux vert.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const APP = join(ROOT, "android", "app", "src", "main", "java", "fr", "veryslopnynotes", "app");
const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "InFlightWorkMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

afterAll(async () => {
  if (!link) return;
  try {
    await link.ask({ op: "reset" });
  } catch {
    // le pilote est déjà mort : rien à nettoyer.
  }
});

interface Snapshot {
  epoch: number;
  currentEpoch: number;
  sendAllowed: boolean;
  deliveryAllowed: boolean;
  delivered: boolean;
  finished: boolean;
  interrupted: boolean;
  alive: boolean;
  cancelActions: number;
  hookActions: number;
  cancelled: boolean;
  active: number;
}

async function ask(op: unknown): Promise<any> {
  return JSON.parse(await link!.ask(op));
}

async function begin(): Promise<{ id: number; epoch: number }> {
  return ask({ op: "begin" });
}

describe("travail IA/photo/profil annulé à la déconnexion (#876)", () => {
  test.skipIf(skip)("une réponse retardée n'est ni envoyée ni livrée après le logout", async () => {
    const { id } = await begin();
    // La réponse est encore à 400 ms : le logout part tout de suite.
    await ask({ op: "delayed", id, delayMs: 400 });
    const logout = await ask({ op: "logout", id });
    expect(logout.cancelled).toBe(1);

    const out = (await ask({ op: "await", id, timeoutMs: 2000 })) as Snapshot;
    // Aucune livraison, aucun envoi depuis la session révolue.
    expect(out.delivered).toBe(false);
    expect(out.deliveryAllowed).toBe(false);
    expect(out.sendAllowed).toBe(false);
    expect(out.currentEpoch).toBeGreaterThan(out.epoch);
    // Le fil est COUPÉ, pas laissé jusqu'à son délai.
    expect(out.interrupted).toBe(true);
    expect(out.alive).toBe(false);
    // Les ressources de l'appel ont été coupées une seule fois et le registre
    // ne garde aucun travail fantôme.
    expect(out.cancelActions).toBe(1);
    expect(out.hookActions).toBe(1);
    expect(out.cancelled).toBe(true);
    expect(out.active).toBe(0);
  });

  test.skipIf(skip)("un fil qui ignore l'interruption ne livre quand même pas", async () => {
    const { id } = await begin();
    await ask({ op: "delayed", id, delayMs: 120, stubborn: true });
    await ask({ op: "logout", id });

    const out = (await ask({ op: "await", id, timeoutMs: 2000 })) as Snapshot;
    // Le fil a bien été interrompu…
    expect(out.interrupted).toBe(true);
    // …mais même s'il va au bout, l'époque et l'annulation refusent le résultat.
    expect(out.sendAllowed).toBe(false);
    expect(out.deliveryAllowed).toBe(false);
    expect(out.delivered).toBe(false);
    expect(out.finished).toBe(true);
    expect(out.active).toBe(0);
  });

  test.skipIf(skip)("une réponse arrivée AVANT le logout est livrée normalement", async () => {
    const { id } = await begin();
    await ask({ op: "delayed", id, delayMs: 30 });
    const out = (await ask({ op: "await", id, timeoutMs: 2000 })) as Snapshot;
    expect(out.sendAllowed).toBe(true);
    expect(out.deliveryAllowed).toBe(true);
    expect(out.delivered).toBe(true);
    expect(out.alive).toBe(false);
    expect(out.active).toBe(0);
  });

  test.skipIf(skip)("un travail démarré APRÈS le logout n'envoie rien", async () => {
    const { id, epoch } = await begin();
    await ask({ op: "logout", id });
    await ask({ op: "delayed", id, delayMs: 20 });
    const out = (await ask({ op: "await", id, timeoutMs: 2000 })) as Snapshot;
    expect(out.epoch).toBe(epoch);
    expect(out.currentEpoch).toBeGreaterThan(epoch);
    expect(out.sendAllowed).toBe(false);
    expect(out.delivered).toBe(false);
  });
});

describe("câblage du pont (#876)", () => {
  const bridge = readFileSync(join(APP, "VsnBridge.kt"), "utf8");
  const executors = readFileSync(join(APP, "BridgeExecutors.kt"), "utf8");
  const lessons = readFileSync(join(APP, "VsnBridgeLessons.kt"), "utf8");
  const homework = readFileSync(join(APP, "VsnBridgeHomeworkAi.kt"), "utf8");
  const teacher = readFileSync(join(APP, "VsnBridgeTeacher.kt"), "utf8");
  const llm = readFileSync(join(DATA, "OpenRouterLlm.kt"), "utf8");

  test("le logout et la bascule coupent les travaux en vol", () => {
    expect(bridge).toContain("InFlight.start(requestId, epoch)");
    expect(bridge).toContain("InFlight.cancelAll(except)");
    expect(bridge).toContain("cancelInFlightWork(except = requestId)");
    expect(bridge).toContain('"session.logout" -> logout(requestId)');
    expect(bridge).toContain('"pairing.pair" -> pair(p, requestId)');
    expect(bridge).toContain('"pairing.pairDemo" -> pairDemo(requestId)');
  });

  test("l'époque est vérifiée avant l'envoi ET avant la livraison", () => {
    expect(bridge).toContain("if (work != null && !work.canSend()) throw StaleSessionRead()");
    expect(bridge).toContain("if (work != null && !work.canDeliver()) throw StaleSessionRead()");
    for (const method of [
      "llm.askHomework",
      "llm.solvePhoto",
      "llm.generateRevision",
      "llm.teacherTurn",
      "lessons.addPhoto",
      "exercises.help",
      "profile.me",
      "profile.photo",
    ]) {
      expect(bridge).toContain(`"${method}"`);
    }
    for (const source of [homework, teacher, lessons]) {
      expect(source).toContain("ensureCurrent(epoch)");
      expect(source).toContain("llmForCall(epoch");
    }
  });

  test("les Futures du pont sont suivis et annulables", () => {
    expect(executors).toContain("ConcurrentHashMap.newKeySet()");
    expect(executors).toContain("FutureTask<Unit>");
    expect(executors).toContain("fun submit(method: String, task: () -> Unit): Future<*>");
    expect(executors).toContain("fun cancelAll()");
    expect(executors).toContain("future.cancel(true)");
    expect(bridge).toContain("executors.submit(method)");
    expect(bridge).toContain("work?.onCancel { future.cancel(true) }");
    expect(bridge).toContain("future.cancel(true)");
  });

  test("le fil brut de la génération est retenu et interrompu", () => {
    expect(llm).toContain("private var worker: Thread?");
    expect(llm).toContain("fun cancel()");
    expect(llm).toContain("synchronized(lock) { worker }?.interrupt()");
    expect(llm).toContain("if (!cancelled) onDone(result)");
    // L'appel du pont enregistre cette coupure sur le jeton de la requête.
    expect(homework).toContain("RequestScope.current()?.onCancel(homework::cancel)");
  });

  test("la photo en attente suit le jeton de l'appel", () => {
    expect(lessons).toContain("BridgeWait.await(latch, AWAIT_PHOTO_MS, RequestScope.current())");
    expect(lessons).toContain("AwaitOutcome.CANCELLED");
    expect(lessons).toContain("photos.cancel(onDone)");
  });
});
