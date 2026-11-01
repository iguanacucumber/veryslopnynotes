// L'appareil peut être ailleurs que l'établissement : sections et fenêtre de
// semaine doivent lire le MÊME jour civil de Paris (#781).
import { afterAll, describe, expect, test } from "bun:test";
import {
  assignmentSections,
  assignmentsInWeek,
  dueLabel,
  parseAssignmentsPayload,
  weekStartOf,
} from "../../web/src/features/tasks/assignments";

const previous = process.env.TZ;
process.env.TZ = "Pacific/Honolulu";
afterAll(() => {
  process.env.TZ = previous ?? "UTC";
});

const VALID = {
  id: "a1",
  subject: "MATHS",
  title: "Exercices",
  dueDate: "2026-11-01T00:00+01:00",
  done: false,
  description: "",
};

function payload(items: unknown[]): string {
  return JSON.stringify({ assignments: items });
}

describe("web tâches — jour de Paris, appareil ailleurs", () => {
  test("un minuit Paris reste « Aujourd'hui » vécu depuis Honolulu", () => {
    // 12:00 à Paris = 01:00 à Honolulu : même jour local, mais l'échéance
    // 00:00 Paris est la VEILLE (31 octobre) pour l'appareil.
    const now = new Date("2026-11-01T12:00:00+01:00");
    const week = weekStartOf(now);
    const items = parseAssignmentsPayload(payload([VALID])).items;
    expect(week).toBe("2026-10-26");
    expect(assignmentsInWeek(items, week).map((item) => item.id)).toEqual(["a1"]);
    expect(assignmentSections(items, week, now).map((section) => section.id)).toEqual(["today"]);
    expect(dueLabel(VALID.dueDate)).toBe("dimanche 1 novembre");
  });

  test("la semaine courante suit le lundi de Paris, pas celui de l'appareil", () => {
    // Lundi 2 novembre 00:30 à Paris = dimanche 1er novembre à Honolulu.
    const now = new Date("2026-11-02T00:30:00+01:00");
    const week = weekStartOf(now);
    expect(week).toBe("2026-11-02");
    const items = parseAssignmentsPayload(
      payload([{ ...VALID, id: "lundi", dueDate: "2026-11-02T00:00+01:00" }]),
    ).items;
    expect(assignmentsInWeek(items, week).map((item) => item.id)).toEqual(["lundi"]);
    expect(assignmentSections(items, week, now).map((section) => section.id)).toEqual(["today"]);
  });
});
