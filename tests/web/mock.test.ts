import { useParisTz } from "./setup";

import { describe, expect, test } from "bun:test";
import { mockCall } from "../../web/src/bridge/mock";
import type { PairResult, ResourceResult, SessionStatus } from "../../web/src/bridge/types";
import { parseAssignmentsPayload } from "../../web/src/features/tasks/assignments";
import { parseNewsPayload } from "../../web/src/features/news/news";
import { parseCanteenPayload } from "../../web/src/features/canteen/canteen";
import { parseAlertsPayload } from "../../web/src/features/alerts/alerts";
import { parseAttendance } from "../../web/src/features/attendance/model";
import { parseDiscussions } from "../../web/src/features/messages/model";
import { parseGradesPayload } from "../../web/src/features/grades/model";
import { parseTimetable } from "../../web/src/features/home/parse";

useParisTz();

async function payloadOf(key: string): Promise<string | null> {
  const result = await mockCall<ResourceResult>("resources.load", { key });
  expect(result.error).toBeNull();
  return result.payload;
}

describe("pont factice", () => {
  test("les ressources de démonstration sont parsables", async () => {
    for (const key of ["grades", "assignments", "timetable", "news", "attendance", "discussions"] as const) {
      const result = await mockCall<ResourceResult>("resources.load", { key });
      expect(result.error).toBeNull();
      const parsed = JSON.parse(result.payload ?? "{}") as { items?: unknown };
      expect(Array.isArray(parsed.items)).toBe(true);
    }
  });

  test("chaque fixture passe le vrai parseur de son écran", async () => {
    const grades = await payloadOf("grades");
    expect(parseGradesPayload(grades).grades.length).toBeGreaterThan(0);

    const assignments = await payloadOf("assignments");
    expect(parseAssignmentsPayload(assignments).items.length).toBeGreaterThan(0);

    const timetable = await payloadOf("timetable");
    expect(parseTimetable(timetable).length).toBeGreaterThan(0);

    const news = await payloadOf("news");
    expect(parseNewsPayload(news).length).toBeGreaterThan(0);

    const attendance = await payloadOf("attendance");
    expect(parseAttendance(attendance).absences.length).toBeGreaterThan(0);

    const discussions = await payloadOf("discussions");
    expect(parseDiscussions(discussions).length).toBeGreaterThan(0);

    const canteen = await payloadOf("canteen");
    const week = parseCanteenPayload(canteen);
    expect(week.days.length).toBeGreaterThan(0);
    expect(week.days.flatMap((day) => day.meals.flatMap((meal) => meal.dishes)).length).toBeGreaterThan(0);
    expect(week.days.flatMap((day) => day.meals.flatMap((meal) => meal.allergens)).length).toBeGreaterThan(0);

    const alerts = await payloadOf("alerts");
    const parsedAlerts = parseAlertsPayload(alerts);
    expect(parsedAlerts.length).toBeGreaterThan(0);
    expect(parsedAlerts[0]?.excerpt).toContain("<img");
  });

  test("le pont factice suit la semaine demandée", async () => {
    const base = parseTimetable(await payloadOf("timetable"));
    const result = await mockCall<ResourceResult>("resources.load", {
      key: "timetable",
      query: "weekStart=2026-10-26",
    });
    const next = parseTimetable(result.payload);
    expect(next.map((lesson) => lesson.id)).toEqual(base.map((lesson) => lesson.id));
    expect(next[0]!.start - base[0]!.start).toBe(7 * 86_400_000);

    // Requête illisible : la semaine de démonstration, jamais une semaine inventée.
    const bogus = await mockCall<ResourceResult>("resources.load", {
      key: "timetable",
      query: "weekStart=nope",
    });
    expect(parseTimetable(bogus.payload)[0]!.start).toBe(base[0]!.start);
  });

  test("session restaurée par défaut", async () => {
    const status = await mockCall<SessionStatus>("session.restore", {});
    expect(status.state).toBe("restored");
  });

  test("le corps d'une actualité arrive À LA DEMANDE (#475)", async () => {
    const news = parseNewsPayload(await payloadOf("news"));
    expect(news.length).toBeGreaterThan(0);
    // La liste ne porte QUE les métadonnées : le corps est ailleurs.
    expect(news[0]?.body).toBe("");
    const body = await mockCall<{ body: string }>("news.item", { id: news[0]?.id });
    expect(body.body.length).toBeGreaterThan(0);
    // Un identifiant inconnu = corps vide, jamais une exception.
    const missing = await mockCall<{ body: string }>("news.item", { id: "inconnu" });
    expect(missing.body).toBe("");
  });

  test("appairage sans PIN refusé, avec PIN accepté", async () => {
    const bad = await mockCall<PairResult>("pairing.pair", {
      qr: { login: "x", jeton: "y", url: "https://school.invalid" },
      pin: "",
    });
    expect(bad.ok).toBe(false);
    const good = await mockCall<PairResult>("pairing.pair", {
      qr: { login: "x", jeton: "y", url: "https://school.invalid" },
      pin: "1234",
    });
    expect(good.ok).toBe(true);
  });

  test("méthode inconnue refusée", async () => {
    await expect(mockCall("nope", {})).rejects.toThrow("inconnue");
  });
});
