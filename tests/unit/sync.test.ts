import { describe, expect, test } from "bun:test";
import { isContractEvent } from "../../shared/contracts/events";
import type { Assignment, Grade, TimetableEntry } from "../../shared/contracts/models";
import { runSync, startSyncLoop } from "../../server/jobs/sync";
import type { SyncSink, SyncSnapshot, SyncSource } from "../../server/jobs/sync";

const grade = (id: string): Grade => ({
  id,
  accountId: "acc",
  subject: "Maths",
  value: 14,
  scale: 20,
  date: "2026-09-20T10:00:00.000Z",
});

function harness(grades: Grade[] = [grade("g1")], assignments: Assignment[] = [], entries: TimetableEntry[] = []) {
  let snapshot: SyncSnapshot | null = null;
  const source: SyncSource = {
    grades: async () => grades,
    assignments: async () => assignments,
    entries: async () => entries,
  };
  const sink: SyncSink = {
    loadSnapshot: async () => snapshot,
    saveSnapshot: async (s) => {
      snapshot = s;
    },
  };
  return { source, sink, saved: () => snapshot };
}

describe("unit sync", () => {
  test("premier sync = zéro alerte, snapshot v1", async () => {
    const { source, sink, saved } = harness();
    const res = await runSync(source, sink);
    expect(res.firstRun).toBe(true);
    expect(res.events).toEqual([]);
    expect(saved()?.version).toBe(1);
  });

  test("idempotent : mêmes données rejouées → zéro événement", async () => {
    const { source, sink } = harness();
    await runSync(source, sink);
    const second = await runSync(source, sink);
    expect(second.firstRun).toBe(false);
    expect(second.events).toEqual([]);
  });

  test("nouvelle note → événement GradeCreated valide", async () => {
    const grades = [grade("g1")];
    const h = harness(grades);
    await runSync(h.source, h.sink);
    grades.push(grade("g2"));
    const res = await runSync(h.source, h.sink);
    expect(res.events.length).toBe(1);
    expect(isContractEvent(res.events[0])).toBe(true);
    expect(res.events[0].type).toBe("GradeCreated");
  });

  test("donnée invalide écartée, boucle n'explose pas", async () => {
    const h = harness([{ ...grade("bad"), value: -3 }]);
    const res = await runSync(h.source, h.sink);
    expect(res.firstRun).toBe(true);
    expect(res.events).toEqual([]);

    const throwing: SyncSource = {
      grades: async () => {
        throw new Error("down");
      },
      assignments: async () => [],
      entries: async () => [],
    };
    let runs = 0;
    const stop = startSyncLoop(throwing, h.sink, 5, () => {
      runs += 1;
    });
    await new Promise((r) => setTimeout(r, 40));
    stop();
    expect(runs).toBeGreaterThanOrEqual(2);
  });
});
