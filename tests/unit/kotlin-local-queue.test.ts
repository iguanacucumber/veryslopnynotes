// File d'attente unique du client local, VRAI Kotlin compilé par le harnais
// (aucun miroir TS) : au plus 1 exécution concurrente, dédoublonnage par clé,
// attente bornée du job de fond, et un travail qui jette livre son échec.
// Outillage absent = SKIP BRUYANT, jamais un faux vert.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const QUEUE = join(DATA, "LocalRequestQueue.kt");
const SHARED = join(DATA, "ClientQueue.kt");
const REPO = join(DATA, "SyncedRepository.kt");
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "LocalQueueParityMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

interface QueueStats {
  workCalls: number;
  maxConcurrent: number;
  executed: string[];
  callbacks: string[];
  thread: string;
  daemon: boolean;
}

interface SharedStats {
  workCalls: number;
  maxConcurrent: number;
  inflight: number;
  executed: string[];
  callbacks: string[];
}

async function ask(op: unknown): Promise<string> {
  return link!.ask(op);
}

async function newQueue(): Promise<number> {
  return (JSON.parse(await ask({ op: "queueNew" })) as { qid: number }).qid;
}

/** Libère les travaux gated : ils s'exécutent alors (un par un). */
async function release(qid: number): Promise<void> {
  await ask({ op: "queueRelease", qid });
}

async function waitCallbacks(qid: number, callbacks: number, timeoutMs = 8000): Promise<{ served: number; timedOut: boolean }> {
  return JSON.parse(await ask({ op: "queueWait", qid, callbacks, timeoutMs })) as { served: number; timedOut: boolean };
}

async function stats(qid: number): Promise<QueueStats> {
  return JSON.parse(await ask({ op: "queueStats", qid })) as QueueStats;
}

/** File PARTAGÉE : état neuf (verrou fermé, compteurs à zéro). */
async function newShared(): Promise<void> {
  await ask({ op: "sharedNew" });
}

/** Une lecture posée dans la file partagée (elle attend le verrou du pilote). */
async function sharedSubmit(
  key: string,
  workMs = 0,
  extra: { fail?: string; type?: string } = {},
): Promise<void> {
  await ask({ op: "sharedSubmit", key, workMs, ...extra });
}

/** L'attente BLOQUANTE du job de fond (elle part dans un fil à part). */
async function sharedAwait(key: string, timeoutMs: number, extra: { fail?: string } = {}): Promise<number> {
  return (JSON.parse(await ask({ op: "sharedAwait", key, timeoutMs, ...extra })) as { id: number }).id;
}

async function sharedAwaitResult(id: number, timeoutMs = 8000): Promise<{ timedOut: boolean; value?: string }> {
  return JSON.parse(await ask({ op: "sharedAwaitResult", id, timeoutMs })) as { timedOut: boolean; value?: string };
}

async function sharedRelease(): Promise<void> {
  await ask({ op: "sharedRelease" });
}

async function sharedStats(): Promise<SharedStats> {
  return JSON.parse(await ask({ op: "sharedStats" })) as SharedStats;
}

describe("file d'attente unique du client local (#310)", () => {
  test("câblage : le dépôt passe par la file PARTAGÉE, plus de Thread par lecture", () => {
    const repo = readFileSync(REPO, "utf8");
    // Une seule file partagée, pas une file par dépôt.
    expect(repo).toContain("ClientQueue.submit(");
    // Quatre lectures passent par la file, dont le CORPS d'une actualité.
    expect(repo.match(/ClientQueue\.submit\(/g)?.length).toBe(4);
    expect(repo).not.toContain("LocalRequestQueue<");
    // Clé = ressource|requête|écriture : une lecture SANS écriture n'avale pas l'autre.
    expect(repo).toContain("CachePolicy.dedupKey(resource, query, save)");
    // Callbacks relayés par le Handler main ; un échec de file règle TOUJOURS la promesse.
    expect(repo).toContain("post(cb, o.orFailed(");
    expect(repo).not.toContain("Thread {");
    expect(repo).not.toContain("Thread(");
    // Logique pure : ni Android ni le reste du paquet data.
    const queue = readFileSync(QUEUE, "utf8");
    expect(queue).not.toContain("import android.");
    expect(queue).not.toContain("android.os");
    const shared = readFileSync(SHARED, "utf8");
    expect(shared).not.toContain("import android.");
    expect(shared).toContain("object ClientQueue");
  });

  test.skipIf(skip)("fil unique : 3 lectures distinctes = 0 chevauchement, ordre d'arrivée", async () => {
    const qid = await newQueue();
    const keys = ["grades|x", "timetable|y", "news|"];
    // Soumises en rafale pendant que le client est gated : ordre d'arrivée.
    for (const key of keys) await ask({ op: "queueSubmit", qid, key, workMs: 30 });
    await release(qid);
    expect(await waitCallbacks(qid, keys.length)).toEqual({ served: 3, timedOut: false });
    const s = await stats(qid);
    expect(s.workCalls).toBe(3);
    // Trois lectures en vol, jamais deux à la fois.
    expect(s.maxConcurrent).toBe(1);
    expect(s.executed).toEqual(keys);
    // Le fil est bien le fil daemon unique de la file.
    expect(s.thread).toBe("local-request-queue");
    expect(s.daemon).toBe(true);
  });

  test.skipIf(skip)("deux requêtes identiques en vol = 1 appel client, 2 callbacks servis", async () => {
    const qid = await newQueue();
    const key = "grades|algorithm=1&periodId=T1";
    await ask({ op: "queueSubmit", qid, key, workMs: 30 });
    await ask({ op: "queueSubmit", qid, key, workMs: 30 });
    await release(qid);
    expect(await waitCallbacks(qid, 2)).toEqual({ served: 2, timedOut: false });
    const s = await stats(qid);
    expect(s.workCalls).toBe(1);
    expect(s.executed).toEqual([key]);
    expect(s.maxConcurrent).toBe(1);
    // …et les DEUX callbacks, servis avec le MÊME résultat (exécution #1 : un
    // rejeu aurait produit `#2` dans le second callback).
    expect(s.callbacks).toEqual([`${key}#1`, `${key}#1`]);
  });

  test.skipIf(skip)("dédoublonnage seulement EN VOL : un appel identique après coup re-démarre", async () => {
    const qid = await newQueue();
    const key = "news|";
    // Pas de blocage : chaque volée se termine immédiatement.
    await release(qid);
    await ask({ op: "queueSubmit", qid, key, workMs: 0 });
    expect(await waitCallbacks(qid, 1)).toEqual({ served: 1, timedOut: false });
    // La clé est libérée par la fin de l'exécution : la même requête repart.
    await ask({ op: "queueSubmit", qid, key, workMs: 0 });
    expect(await waitCallbacks(qid, 2)).toEqual({ served: 2, timedOut: false });
    const s = await stats(qid);
    expect(s.workCalls).toBe(2);
    expect(s.callbacks).toEqual([`${key}#1`, `${key}#2`]);
    expect(s.maxConcurrent).toBe(1);
  });

  test.skipIf(skip)("clés différentes = pas de dédoublonnage (requêtes distinctes re-postées)", async () => {
    const qid = await newQueue();
    // Même ressource, query différente : ce sont deux lectures distinctes.
    const keys = ["timetable|weekStart=2026-10-12", "timetable|weekStart=2026-10-19"];
    for (const key of keys) await ask({ op: "queueSubmit", qid, key, workMs: 5 });
    await release(qid);
    expect(await waitCallbacks(qid, 2)).toEqual({ served: 2, timedOut: false });
    const s = await stats(qid);
    expect(s.workCalls).toBe(2);
    expect(s.executed).toEqual(keys);
    expect(s.callbacks).toEqual([`${keys[0]}#1`, `${keys[1]}#1`]);
  });
});

// Un travail qui jette ne perd pas les callbacks de sa clé : l'échec est un RÉSULTAT.
describe("file locale : un travail qui jette livre un ÉCHEC (#530)", () => {
  test.skipIf(skip)("une exception : TOUS les callbacks de la clé reçoivent l'échec", async () => {
    const qid = await newQueue();
    const key = "grades|boom";
    await ask({ op: "queueSubmit", qid, key, fail: "exception" });
    // Co-demandeur de la MÊME clé : il doit être servi lui aussi.
    await ask({ op: "queueSubmit", qid, key, fail: "exception" });
    await release(qid);
    expect(await waitCallbacks(qid, 2)).toEqual({ served: 2, timedOut: false });
    const s = await stats(qid);
    expect(s.callbacks).toEqual(["failed:IllegalStateException", "failed:IllegalStateException"]);
    // UN seul appel client (déduplonnage) : la clé n'a pas été rejouée.
    expect(s.workCalls).toBe(1);
  });

  test.skipIf(skip)("un `Error` (OOM) est traité comme une exception : l'échec est livré", async () => {
    const qid = await newQueue();
    const key = "news|oom";
    await ask({ op: "queueSubmit", qid, key, fail: "error" });
    await release(qid);
    expect(await waitCallbacks(qid, 1)).toEqual({ served: 1, timedOut: false });
    const s = await stats(qid);
    expect(s.callbacks).toEqual(["failed:OutOfMemoryError"]);
  });

  test.skipIf(skip)("la file PARTAGÉE : le job de fond est RÉVEILLÉ par l'échec (pas de pendance)", async () => {
    await newShared();
    await sharedSubmit("grades|boom", 0, { fail: "exception" });
    // L'attente du job : elle NE DOIT PAS attendre son délai (120 s en prod).
    const id = await sharedAwait("job|grades|boom", 10000, { fail: "exception" });
    await sharedRelease();
    const res = await sharedAwaitResult(id);
    expect(res.timedOut).toBe(false);
    expect(res.value).toBe("failed:IllegalStateException");
  }, 20000);

  test.skipIf(skip)("collision de clés : le cast qui jette est un ÉCHEC livré, pas un silence", async () => {
    await newShared();
    // La MÊME clé, deux types : le cast interne de `ClientQueue` jette.
    await sharedSubmit("grades|collision");
    await sharedSubmit("grades|collision", 0, { type: "int" });
    await sharedRelease();
    const served = JSON.parse(await ask({ op: "sharedWait", callbacks: 2, timeoutMs: 8000 })) as {
      served: number;
      timedOut: boolean;
    };
    expect(served).toEqual({ served: 2, timedOut: false });
    const after = await sharedStats();
    // Le second callback reçoit l'ÉCHEC du cast, pas un silence.
    expect(after.callbacks).toEqual(["grades|collision", "failed:ClassCastException"]);
  }, 20000);
});

// Le job de fond passe par LA MÊME file que l'interface : `Client` est MUTABLE,
// et deux authentifications parallèles déclenchent l'erreur 25 (compte limité).
// Les clés diffèrent d'un test à l'autre : un travail en vol dédoublonnerait la
// soumission suivante.
describe("file PARTAGÉE : l'interface et le job de fond ne se croisent pas (#403)", () => {
  test.skipIf(skip)("la lecture du job ATTEND la lecture de l'interface (un seul appel client à la fois)", async () => {
    await newShared();
    // L'interface lit (la lecture reste bloquée par le verrou du pilote).
    await sharedSubmit("grades|1");
    // Le job pose sa lecture : elle ne peut PAS démarrer, la file est occupée.
    const id = await sharedAwait("job|grades|1", 10000);
    const busy = await sharedStats();
    expect(busy.workCalls).toBe(1);
    expect(busy.inflight).toBe(1);
    // La file se libère : le job reçoit son résultat.
    await sharedRelease();
    const res = await sharedAwaitResult(id);
    expect(res.timedOut).toBe(false);
    expect(res.value).toBe("job|grades|1");
    const after = await sharedStats();
    expect(after.workCalls).toBe(2);
    // JAMAIS deux appels client en même temps (le point de #403).
    expect(after.maxConcurrent).toBe(1);
    // L'ordre d'arrivée : l'interface d'abord, le job ensuite.
    expect(after.executed).toEqual(["grades|1", "job|grades|1"]);
  }, 20000);

  test.skipIf(skip)("l'attente du job est BORNÉE (file occupée = réessai, jamais de blocage infini)", async () => {
    await newShared();
    // Une lecture longue occupe la file.
    await sharedSubmit("grades|2", 200);
    // Délai court : l'attente FINIT (réessai) ; sa valeur ne fait pas partie du contrat.
    const id = await sharedAwait("job|grades|2", 100);
    const res = await sharedAwaitResult(id);
    expect(res.timedOut).toBe(true);
    // La file se libère : le travail orphelin s'exécute, sans conséquence.
    await sharedRelease();
  }, 20000);

  test.skipIf(skip)("UNE instance pour tous : deux producteurs, la même clé = un seul appel client", async () => {
    await newShared();
    await sharedSubmit("grades|3");
    // MÊME clé : la file partagée dédoublonne, deux files ne le feraient pas.
    await sharedSubmit("grades|3");
    const busy = await sharedStats();
    expect(busy.workCalls).toBe(1);
    await sharedRelease();
    const served = JSON.parse(await ask({ op: "sharedWait", callbacks: 2, timeoutMs: 8000 })) as {
      served: number;
      timedOut: boolean;
    };
    expect(served).toEqual({ served: 2, timedOut: false });
    const after = await sharedStats();
    expect(after.workCalls).toBe(1);
    expect(after.callbacks).toEqual(["grades|3", "grades|3"]);
  }, 20000);
});
