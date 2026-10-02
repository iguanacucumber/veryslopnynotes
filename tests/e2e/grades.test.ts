import { describe, expect, test } from "bun:test";
import type { Assignment, Device, Grade, TimetableEntry } from "../../shared/contracts/models";
import { runSync } from "../../server/jobs/sync";
import type { SyncSink, SyncSnapshot, SyncSource } from "../../server/jobs/sync";
import { notifySyncResult } from "../../server/jobs/notify";
import type { GradePushSender } from "../../server/jobs/notify";

// e2e grades (sans réseau, sans .env.local) : sync delta phase 5 → push.
// Premier sync silencieux, nouvelle note → push par device, correction → push.
// Aucun LLM sur le chemin (données structurées seules, I7).

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const grade = (id: string, value = 14): Grade => ({
  id,
  accountId: "acc",
  subject: "Maths",
  value,
  scale: 20,
  date: "2026-09-20T10:00:00.000Z",
});

function memoryHarness(grades: Grade[]) {
  let snapshot: SyncSnapshot | null = null;
  const source: SyncSource = {
    grades: async () => grades,
    assignments: async () => [] as Assignment[],
    entries: async () => [] as TimetableEntry[],
  };
  const sink: SyncSink = {
    loadSnapshot: async () => snapshot,
    saveSnapshot: async (s) => {
      snapshot = s;
    },
  };
  return { source, sink };
}

function fakeSender() {
  const calls: { hash: string; title: string; body: string }[] = [];
  const sender: GradePushSender = {
    send: async (hash, payload) => {
      calls.push({ hash, ...payload });
    },
  };
  return { calls, sender };
}

const devices: Device[] = [
  { id: "d1", tokenHash: HASH_A },
  { id: "d2", tokenHash: HASH_B },
];

describe("e2e grades", () => {
  test("premier sync silencieux puis push sur delta uniquement", async () => {
    const grades = [grade("g1")];
    const { source, sink } = memoryHarness(grades);
    const { calls, sender } = fakeSender();

    const first = await runSync(source, sink);
    expect(first.firstRun).toBe(true);
    expect(first.events).toEqual([]);
    const n1 = await notifySyncResult(first, devices, sender);
    expect(n1.sent).toBe(0);
    expect(calls.length).toBe(0);

    grades.push(grade("g2", 16));
    const second = await runSync(source, sink);
    expect(second.firstRun).toBe(false);
    expect(second.events.length).toBe(1);
    expect(second.events[0].type).toBe("GradeCreated");
    const n2 = await notifySyncResult(second, devices, sender);
    expect(n2.sent).toBe(2);
    expect(calls.length).toBe(2);
    expect(calls[0].title).toContain("Maths");
    expect(calls[0].body).toContain("16/20");

    grades[0] = { ...grade("g1"), value: 18 };
    const third = await runSync(source, sink);
    expect(third.events.length).toBe(1);
    const n3 = await notifySyncResult(third, devices, sender);
    expect(n3.sent).toBe(2);
    expect(calls.length).toBe(4);
    expect(calls[3].body).toContain("18/20");
  });

  test("rejeu identique → zéro push", async () => {
    const grades = [grade("g1")];
    const { source, sink } = memoryHarness(grades);
    const { calls, sender } = fakeSender();
    const first = await runSync(source, sink);
    await notifySyncResult(first, devices, sender);
    const second = await runSync(source, sink);
    const n2 = await notifySyncResult(second, devices, sender);
    expect(second.events).toEqual([]);
    expect(n2.sent).toBe(0);
    expect(calls.length).toBe(0);
  });
});
