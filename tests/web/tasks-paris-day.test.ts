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
import {
  clockLabel,
  dueLabel as homeDueLabel,
  isUpcomingTask,
  parisDayKeyOf,
  parseAssignments,
  parseTimetable,
} from "../../web/src/features/home/parse";
import { isoDay } from "../../web/src/lib/format";
import { lessonsInWeek, parisStartOfWeek } from "../../web/src/features/timetable/week";

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

  test("une date seule est minuit de Paris, jamais celui de l'appareil", () => {
    const [task] = parseAssignments(
      payload([{ id: "jour", subject: "MATHS", title: "À rendre", dueDate: "2026-11-01" }]),
    );
    expect(task).toBeDefined();
    expect(parisDayKeyOf(task!.due)).toBe("2026-11-01");
    expect(clockLabel(task!.due)).toBe("00:00");
    // 23:00 à Paris le jour même : la journée entière n'est pas « en retard ».
    const now = Date.parse("2026-11-01T23:00:00+01:00");
    expect(isUpcomingTask(task!, now)).toBe(true);
    expect(homeDueLabel(task!.due, now, task!.dueRaw)).toBe("aujourd’hui");
  });

  test("un lundi 00:30 de Paris ouvre la semaine même vu de Honolulu", () => {
    // Dimanche 1er novembre 23:30 UTC = lundi 2 novembre 00:30 à Paris.
    const base = new Date("2026-11-01T23:30:00Z");
    const week = parisStartOfWeek(base);
    expect(isoDay(week)).toBe("2026-11-02");
    const lessons = parseTimetable(
      JSON.stringify({
        entries: [
          {
            id: "l1",
            subject: "MATHS",
            start: "2026-11-01T23:30:00Z",
            end: "2026-11-02T00:30:00Z",
          },
        ],
      }),
    );
    expect(lessonsInWeek(lessons, week).map((lesson) => lesson.id)).toEqual(["l1"]);
  });
});
