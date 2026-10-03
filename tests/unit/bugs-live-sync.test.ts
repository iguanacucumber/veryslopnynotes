// Revue adversariale de server/infrastructure/live-sync.ts (#87).
// Un test = UN bug démontré, reader/stores injectés : ZÉRO réseau, ZÉRO secret,
// données 100 % synthétiques. Aucune horloge réelle : les fakes sont résolus par
// microtâches (`flush`) ou par une porte (`deferred`) que le test ouvre lui-même.
// Les minuteurs ne sont observés QUE pendant le refresh concerné (filtre sur le
// délai `timeoutMs`, propre à chaque test), donc aucun faux positif.
import { describe, expect, test } from "bun:test";
import { createLiveSync } from "../../server/infrastructure/live-sync";
import type { LiveReader } from "../../server/infrastructure/live-sync";
import { SnapshotStore } from "../../server/infrastructure/snapshot-store";
import { PronoteReadError } from "../../server/domain/ports";
import { handleSyncRefresh } from "../../server/api/sync-refresh";
import { createHandler } from "../../server/api/router";
import { isGrade } from "../../shared/contracts/models";
import type { Capabilities, Grade, TimetableEntry } from "../../shared/contracts/models";
import type { ContractEvent } from "../../shared/contracts/events";

const ACCOUNT = "acc-bug-live-sync";
const AT = "2026-10-02T07:00:00.000Z";

const CAPS: Capabilities = { accountId: ACCOUNT, tabs: ["grades", "homework"], fetchedAt: AT };

/** Page Pronote : la valeur est wrappée `Untrusted` par le reader réel. */
function pageOf<T>(value: T[]): { items: { __untrusted: true; value: T[] }; nextCursor: string | null } {
  return { items: { __untrusted: true, value }, nextCursor: null };
}

function gradeFor(accountId: string, id: string, value = 14): Grade {
  return {
    id,
    accountId,
    subject: "Maths-Fake",
    value,
    scale: 20,
    date: "2026-09-20T10:00:00.000Z",
  };
}

function entryFor(accountId: string, id: string): TimetableEntry {
  return {
    id,
    accountId,
    subject: "Histoire-Fake",
    start: "2026-10-06T08:00:00.000Z",
    end: "2026-10-06T09:00:00.000Z",
  };
}

/** Reader fake : cœur présent (listes vides), secondaires simulables une à une. */
function readerOf(overrides: Partial<LiveReader> = {}): LiveReader {
  return {
    getGrades: async () => pageOf([]),
    getAssignments: async () => pageOf([]),
    getTimetable: async () => pageOf([]),
    ...overrides,
  };
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Fait s'écouler les microtâches : les fakes résolutionnels n'attendent rien d'autre. */
async function flush(rounds = 25): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
    await Promise.resolve();
  }
}

function types(events: ContractEvent[]): string[] {
  return events.map((e) => e.type);
}

/**
 * Espion des minuteurs, filtré sur le délai exact `delay` : tout minuteur créé
 * par le refresh (donc par live-sync) et jamais annulé est compté. Les timers
 * internes au runner ont un délai différent, donc aucun faux positif.
 */
function spyTimers(delay: number): { restant: () => number; restore: () => void } {
  const vraiSet = globalThis.setTimeout;
  const vraiClear = globalThis.clearTimeout;
  const armes = new Map<unknown, number>();
  globalThis.setTimeout = ((fn: () => void, ms?: number, ...rest: unknown[]) => {
    const handle = (vraiSet as (...a: unknown[]) => unknown)(fn, ms, ...rest);
    if (ms === delay) armes.set(handle, ms);
    return handle;
  }) as unknown as typeof globalThis.setTimeout;
  globalThis.clearTimeout = ((handle?: unknown) => {
    if (handle !== undefined) armes.delete(handle);
    (vraiClear as (h: unknown) => void)(handle);
  }) as unknown as typeof globalThis.clearTimeout;
  return {
    restant: () => armes.size,
    restore: () => {
      globalThis.setTimeout = vraiSet;
      globalThis.clearTimeout = vraiClear;
    },
  };
}

describe("bugs live-sync (revue adversariale)", () => {
  test("BUG: garde in-flight partagée entre comptes — la réponse du compte B contient les événements (donc les notes) du compte A", async () => {
    const accA = "acc-alpha";
    const accB = "acc-beta";
    const notesA: Grade[] = [gradeFor(accA, "g-a")];
    const lus: string[] = [];
    let bloquer = false;
    const porte = deferred();
    const store = new SnapshotStore();
    const sync = createLiveSync({
      store,
      // Mono-compte simulé : chaque compte a sa propre session.
      resolveAccountId: (requested) => requested,
      reader: readerOf({
        getGrades: async (accountId: string) => {
          lus.push(accountId);
          if (bloquer) await porte.promise;
          return pageOf(accountId === accA ? notesA : [gradeFor(accB, "g-b")]);
        },
      }),
    });

    // Référence pour A : le baseline du diff existe déjà (rejeu = aucun GradeCreated).
    await sync.run(accA);
    expect(types(await sync.run(accA)).filter((t) => t === "GradeCreated")).toEqual([]);

    // A part en lecture, puis B demande son refresh pendant ce vol.
    bloquer = true;
    notesA.push(gradeFor(accA, "g-a2"));
    const volA = sync.actions.refresh(accA);
    await flush();
    const volB = sync.actions.refresh(accB);
    porte.resolve();
    const eventsB = await volB;
    await volA;

    // B n'a jamais été lu de son côté : il ne peut pas hériter du vol de A.
    const termine = eventsB.find((e) => e.type === "SyncCompleted");
    expect({
      lus,
      compteAnnonce: (termine?.data as { accountId?: string } | undefined)?.accountId,
      gradeEvents: types(eventsB).filter((t) => t === "GradeCreated").length,
    }).toEqual({ lus: [accA, accA, accB], compteAnnonce: accB, gradeEvents: 0 });
  });

  test("BUG: session expirée avalée — le refresh répond 200 + SyncCompleted « ok » au lieu de signaler l'échec, donc l'app ne se ré-appaire jamais", async () => {
    const store = new SnapshotStore();
    const logs: string[] = [];
    const morte = async (): Promise<never> => {
      throw new PronoteReadError("session expired", "session_expired");
    };
    const sync = createLiveSync({
      store,
      resolveAccountId: () => ACCOUNT,
      logger: (m) => logs.push(m),
      reader: readerOf({ getGrades: morte, getAssignments: morte, getTimetable: morte, getNews: morte }),
    });

    const res = await handleSyncRefresh(
      new Request("http://127.0.0.1/v1/sync/refresh", { method: "POST", body: "{}" }),
      sync.actions,
    );
    const body = res.status === 200 ? ((await res.json()) as { events: ContractEvent[] }).events : [];
    // Le commentaire du fichier promet « le reader la remontera en session_expired
    // (l'app se ré-appaire) » : ici l'échec est avalé par `catch { return null }`.
    expect({ succes: res.ok, types: types(body), logOk: logs.some((m) => m.includes("ok")) }).toEqual({
      succes: false,
      types: [],
      logOk: false,
    });
  });

  test("BUG: lecture de notes en échec traitée comme « zéro note » — le baseline du diff est vidé, puis tout l'historique repart en GradeCreated", async () => {
    let etat: "ok" | "hs" = "ok";
    const store = new SnapshotStore();
    const sync = createLiveSync({
      store,
      resolveAccountId: () => ACCOUNT,
      reader: readerOf({
        getGrades: async () => {
          if (etat === "hs") throw new PronoteReadError("grades network", "network");
          return pageOf([gradeFor(ACCOUNT, "g-1"), gradeFor(ACCOUNT, "g-2")]);
        },
      }),
    });

    await sync.run(ACCOUNT);
    expect(store.grades()).toHaveLength(2);

    // Réseau mort : le store garde les 2 notes (choix « instantané conservé »).
    etat = "hs";
    await sync.run(ACCOUNT);
    expect(store.grades()).toHaveLength(2);

    // Réseau revenu, données inchangées : AUCUN événement, comme après runSync #1.
    etat = "ok";
    const retour = await sync.run(ACCOUNT);
    expect(types(retour).filter((t) => t === "GradeCreated")).toEqual([]);
  });

  test("BUG: nextCursor ignoré — le snapshot garde la seule 1re page, donc l'EDT (et les notes) sont tronqués en silence", async () => {
    const entrees = Array.from({ length: 120 }, (_, i) => entryFor(ACCOUNT, `t-${i}`));
    const cursors: (string | undefined)[] = [];
    const store = new SnapshotStore();
    const sync = createLiveSync({
      store,
      resolveAccountId: () => ACCOUNT,
      reader: readerOf({
        // Pagination réelle du reader : 50 par page, nextCursor = offset.
        getTimetable: async (_accountId: string, page?: { cursor?: string }) => {
          cursors.push(page?.cursor);
          const offset = Number(page?.cursor ?? 0);
          const slice = entrees.slice(offset, offset + 50);
          return {
            items: { __untrusted: true as const, value: slice },
            nextCursor: offset + 50 < entrees.length ? String(offset + 50) : null,
          };
        },
      }),
    });

    await sync.run(ACCOUNT);
    expect({ pagesLues: cursors.length, entrees: store.entries().length }).toEqual({
      pagesLues: 3,
      entrees: 120,
    });
  });

  test("BUG: run() échappe à la garde in-flight — deux chaînes de lectures Pronote partent en parallèle sur la même session", async () => {
    const porte = deferred();
    let enVol = 0;
    let maxEnVol = 0;
    const store = new SnapshotStore();
    const sync = createLiveSync({
      store,
      resolveAccountId: () => ACCOUNT,
      reader: readerOf({
        getGrades: async () => {
          enVol += 1;
          maxEnVol = Math.max(maxEnVol, enVol);
          await porte.promise;
          enVol -= 1;
          return pageOf([gradeFor(ACCOUNT, "g-1")]);
        },
      }),
    });

    // Chemin public (warmup / appairage) + chemin route : l'entête interdit
    // justement les lectures parallèles (session_expired en rafale).
    const viaRun = sync.run(ACCOUNT);
    await flush();
    const viaRefresh = sync.actions.refresh(ACCOUNT);
    await flush();
    const observe = maxEnVol;
    porte.resolve();
    await Promise.all([viaRun, viaRefresh]);

    expect({ lecturesSimultanees: observe }).toEqual({ lecturesSimultanees: 1 });
  });

  test("BUG: instantané écrit AVANT validation — un enregistrement hors contrat brique GET /v1/grades en 500 alors que le diff le filtre", async () => {
    const store = new SnapshotStore();
    const sync = createLiveSync({
      store,
      resolveAccountId: () => ACCOUNT,
      reader: readerOf({
        // isGrade() = false (value < 0) : le lecteur adaptatif n'a pas filtré.
        getGrades: async () => pageOf([{ ...gradeFor(ACCOUNT, "g-1"), value: -3 }]),
      }),
    });

    await sync.run(ACCOUNT);
    // Impact : la route /v1/grades sert le cache -> 500 sur tout l'écran notes.
    const handler = createHandler(store);
    const res = await handler(new Request("http://127.0.0.1/v1/grades"));
    // Cause : `store.apply` reçoit la page brute, sans le filtre `isGrade` que
    // runSync applique sur la même donnée.
    expect({ notesValides: store.grades().every((g) => isGrade(g)), statutGrades: res.status }).toEqual({
      notesValides: true,
      statutGrades: 200,
    });
  });

  test("BUG: le timeout de readCaps n'est jamais annulé — chaque refresh laisse un minuteur armé (processus et tests ne rendent pas la main)", async () => {
    const TIMEOUT = 40;
    const store = new SnapshotStore();
    const sync = createLiveSync({
      store,
      resolveAccountId: () => ACCOUNT,
      timeoutMs: TIMEOUT,
      reader: readerOf({ getCapabilities: async () => CAPS }),
    });

    const espio = spyTimers(TIMEOUT);
    try {
      await sync.run(ACCOUNT);
    } finally {
      espio.restore();
    }
    // `read` annule son minuteur dans `finally`, `readCaps` ne le fait pas.
    expect({ minuteursEncoreArmes: espio.restant() }).toEqual({ minuteursEncoreArmes: 0 });
  });
});