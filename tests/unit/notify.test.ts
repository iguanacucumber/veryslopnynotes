import { describe, expect, test } from "bun:test";
import type { ContractEvent } from "../../shared/contracts/events";
import { CONTRACTS_VERSION } from "../../shared/contracts/models";
import type { Device, Grade } from "../../shared/contracts/models";
import { formatGradePush, notifyGradeEvents, notifySyncResult } from "../../server/jobs/notify";
import type { GradePushSender } from "../../server/jobs/notify";
import type { SyncResult } from "../../server/jobs/sync";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const grade = (id: string, value = 14, subject = "Maths"): Grade => ({
  id,
  accountId: "acc",
  subject,
  value,
  scale: 20,
  date: "2026-09-20T10:00:00.000Z",
});

const gradeEvent = (g: Grade): ContractEvent => ({
  v: CONTRACTS_VERSION,
  type: "GradeCreated",
  at: "2026-09-21T10:00:00.000Z",
  data: g,
});

function recorder(failOn: string[] = []) {
  const calls: { hash: string; title: string; body: string }[] = [];
  const sender: GradePushSender = {
    send: async (hash, payload) => {
      if (failOn.includes(hash)) throw new Error("down");
      calls.push({ hash, ...payload });
    },
  };
  return { calls, sender };
}

const devices: Device[] = [
  { id: "d1", tokenHash: HASH_A },
  { id: "d2", tokenHash: HASH_B },
];

describe("unit notify", () => {
  test("format depuis données structurées, borné title/body", () => {
    const p = formatGradePush(grade("g1", 15, "Physique"));
    expect(p.title).toContain("Physique");
    expect(p.body).toContain("15/20");
    expect(p.title.length).toBeLessThanOrEqual(120);
    expect(p.body.length).toBeLessThanOrEqual(1000);
    const long = formatGradePush({ ...grade("g9"), subject: "S".repeat(500) });
    expect(long.title.length).toBeLessThanOrEqual(120);
    expect(long.body.length).toBeLessThanOrEqual(1000);
  });

  test("premier sync silencieux : aucun send même avec events", async () => {
    const { calls, sender } = recorder();
    const fake: SyncResult = {
      firstRun: true,
      events: [gradeEvent(grade("g1"))],
      snapshot: { version: 1, at: "", gradeIds: ["g1"], gradePrints: {}, assignmentIds: [], entryIds: [] },
    };
    const res = await notifySyncResult(fake, devices, sender);
    expect(calls.length).toBe(0);
    expect(res.sent).toBe(0);
    expect(res.failed).toBe(0);
    expect(res.events).toBe(0);
  });

  test("delta seul déclenche : fan-out un push par device", async () => {
    const { calls, sender } = recorder();
    const res = await notifyGradeEvents([gradeEvent(grade("g2", 16))], devices, sender);
    expect(res.events).toBe(1);
    expect(res.sent).toBe(2);
    expect(calls.length).toBe(2);
    expect(calls[0].body).toContain("16/20");
  });

  test("non-GradeCreated et grade invalide ignorés", async () => {
    const { calls, sender } = recorder();
    const other: ContractEvent = {
      v: CONTRACTS_VERSION,
      type: "SyncCompleted",
      at: "2026-09-21T10:00:00.000Z",
      data: { accountId: "acc", grades: 1, assignments: 0 },
    };
    const bad = { ...gradeEvent(grade("bad")), data: { ...grade("bad"), value: -5 } };
    const res = await notifyGradeEvents([other, bad as unknown as ContractEvent], devices, sender);
    expect(res.events).toBe(0);
    expect(calls.length).toBe(0);
  });

  test("fail-soft par device + hash invalide skippé sans appel", async () => {
    const { calls, sender } = recorder([HASH_A]);
    const mixed: Device[] = [...devices, { id: "dx", tokenHash: "not-hex" }];
    const res = await notifyGradeEvents([gradeEvent(grade("g3"))], mixed, sender);
    expect(res.sent).toBe(1);
    expect(res.failed).toBe(1);
    expect(calls.length).toBe(1);
    expect(calls[0].hash).toBe(HASH_B);
  });

  test("zéro token en clair en log", async () => {
    const logs: string[] = [];
    const { sender } = recorder();
    await notifyGradeEvents([gradeEvent(grade("g4"))], devices, sender, (m) => logs.push(m));
    const joined = logs.join("\n");
    expect(joined).not.toContain(HASH_A);
    expect(joined).not.toContain(HASH_B);
  });
});
