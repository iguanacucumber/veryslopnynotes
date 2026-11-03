// #893 — l'école est à Paris : les fenêtres EDT/devoirs et les instants publiés
// sortent du fuseau de l'établissement. L'horloge est INJECTÉE (`Clock` fixe) :
// minuit, passage d'heure d'été/hiver et frontière d'année sont reproductibles.
// Outillage absent = SKIP BRUYANT ; échec de compilation = défaut.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "SchoolTimeMain.kt");
const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

async function ask<T>(op: unknown): Promise<T> {
  return JSON.parse(await link!.ask(op)) as T;
}

interface Window {
  from: string;
  to: string;
}

const HOUR = 3_600_000;

describe("fuseau scolaire : heures murales et offsets UTC (#893)", () => {
  test.skipIf(skip)("l'été publie +02:00 et l'hiver +01:00", async () => {
    const summer = await ask<{ iso: string }>({ op: "parisIso", local: "2026-07-01T12:00:00" });
    expect(summer.iso).toBe("2026-07-01T12:00+02:00");
    const winter = await ask<{ iso: string }>({ op: "parisIso", local: "2026-12-01T12:00:00" });
    expect(winter.iso).toBe("2026-12-01T12:00+01:00");
  });

  test.skipIf(skip)("un même instant UTC est lu à l'heure de Paris, jamais à celle de l'appareil", async () => {
    const summer = await ask<{ iso: string }>({ op: "nowIso", instant: "2026-07-01T10:00:00Z" });
    expect(summer.iso).toBe("2026-07-01T12:00+02:00");
    const winter = await ask<{ iso: string }>({ op: "nowIso", instant: "2026-12-01T10:00:00Z" });
    expect(winter.iso).toBe("2026-12-01T11:00+01:00");
  });

  test.skipIf(skip)("minuit Paris : 23:30Z est encore la veille, 23:30Z+1h est le lendemain", async () => {
    const before = await ask<{ day: string; local: string }>({
      op: "today",
      instant: "2026-11-03T22:30:00Z",
    });
    expect(before.day).toBe("2026-11-03");
    const after = await ask<{ day: string; local: string }>({
      op: "today",
      instant: "2026-11-03T23:30:00Z",
    });
    expect(after.day).toBe("2026-11-04");
    // 00:30 à Paris, pas 23:30 : l'heure murale vient de l'horloge injectée.
    const local = await ask<{ local: string }>({ op: "now", instant: "2026-11-03T23:30:00Z" });
    expect(local.local).toBe("2026-11-04T00:30");
  });
});

describe("DST : la semaine murale ne fait pas 7 × 24 h (#893)", () => {
  test.skipIf(skip)("printemps 2026 : la semaine du 23 mars dure 167 h", async () => {
    const win = await ask<Window>({ op: "weekWindow", weekStart: "2026-03-23" });
    expect(win.from).toBe("2026-03-22T23:00:00Z");
    expect(win.to).toBe("2026-03-29T21:59:59.999Z");
    expect(Date.parse(win.to) + 1 - Date.parse(win.from)).toBe(167 * HOUR);
  });

  test.skipIf(skip)("automne 2026 : la semaine du 19 octobre dure 169 h", async () => {
    const win = await ask<Window>({ op: "weekWindow", weekStart: "2026-10-19" });
    expect(win.from).toBe("2026-10-18T22:00:00Z");
    expect(win.to).toBe("2026-10-25T22:59:59.999Z");
    expect(Date.parse(win.to) + 1 - Date.parse(win.from)).toBe(169 * HOUR);
  });

  test.skipIf(skip)("une semaine demandée reste bornée à l'heure murale de Paris", async () => {
    const res = await ask<Window>({
      op: "assignmentWindow",
      weekStart: "2026-03-23",
      instant: "2026-01-01T10:00:00Z",
    });
    expect(res.from).toBe("2026-03-23T00:00");
    expect(res.to).toBe("2026-03-29T23:59:59.999");
  });

  test.skipIf(skip)("le trou DST de 02:30 est résolu à Paris (03:30), jamais sur l'appareil", async () => {
    const res = await ask<{ local: string }>({
      op: "dateParse",
      text: "29/03/2026 02:30:00",
      instant: "2026-03-29T00:00:00Z",
    });
    expect(res.local).toBe("2026-03-29T03:30");
  });
});

describe("année : la semaine et le repli traversent le 31 décembre (#893)", () => {
  test.skipIf(skip)("la semaine du 28 décembre 2026 finit en 2027", async () => {
    const win = await ask<Window>({ op: "weekWindow", weekStart: "2026-12-28" });
    expect(win.from).toBe("2026-12-27T23:00:00Z");
    expect(win.to).toBe("2027-01-03T22:59:59.999Z");
    expect(Date.parse(win.to) + 1 - Date.parse(win.from)).toBe(168 * HOUR);
  });

  test.skipIf(skip)("le repli −7/+21 jours lit l'année à Paris (1er janvier 00:30)", async () => {
    const res = await ask<Window>({
      op: "assignmentWindow",
      weekStart: null,
      instant: "2026-12-31T23:30:00Z",
    });
    expect(res.from).toBe("2026-12-25T00:30");
    expect(res.to).toBe("2027-01-22T00:30");
  });

  test.skipIf(skip)("une date Pronote sans année prend l'année de l'horloge à Paris", async () => {
    const res = await ask<{ local: string }>({
      op: "dateParse",
      text: "01/01",
      instant: "2026-12-31T23:30:00Z",
    });
    expect(res.local).toBe("2027-01-01T00:00");
    const today = await ask<{ local: string }>({
      op: "dateParse",
      text: "0800",
      instant: "2026-12-31T23:30:00Z",
    });
    expect(today.local).toBe("2027-01-01T00:00");
  });

  test.skipIf(skip)("la semaine courante de la cantine commence le lundi 28 décembre", async () => {
    const res = await ask<Window>({
      op: "currentWeek",
      instant: "2027-01-01T10:00:00Z",
    });
    expect(res.from).toBe("2026-12-28T00:00");
    expect(res.to).toBe("2027-01-03T23:59:59");
  });
});

describe("câblage : l'horloge injectée va jusqu'aux payloads (#893)", () => {
  test("le fuseau scolaire alimente les payloads et les dépôts", () => {
    const schoolTime = readFileSync(join(DATA, "SchoolTime.kt"), "utf8");
    expect(schoolTime).toContain('ZoneId.of("Europe/Paris")');
    expect(schoolTime).toContain("fun schoolClock(): Clock = Clock.system(SCHOOL_ZONE)");

    const homework = readFileSync(join(DATA, "HomeworkPayloads.kt"), "utf8");
    expect(homework).toContain("assignmentWindow(query[\"weekStart\"], clock)");

    const timetable = readFileSync(join(DATA, "TimetablePayloads.kt"), "utf8");
    expect(timetable).toContain("val now = schoolNow(clock)");

    const reads = readFileSync(join(DATA, "CachedReads.kt"), "utf8");
    expect(reads).toContain("assignmentsPayload(client, q, clock)");
    expect(reads).toContain("timetablePayload(client, q, clock)");

    const repo = readFileSync(join(DATA, "SyncedRepository.kt"), "utf8");
    expect(repo).toContain("cachedRead(client, resource, query, previous, schoolTime)");
  });
});
