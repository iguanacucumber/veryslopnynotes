import { describe, expect, test } from "bun:test";
import {
  addDays,
  asNumber,
  cleanText,
  formatNote,
  frRange,
  hexToRgb,
  initials,
  isSameDay,
  isoDay,
  startOfWeek,
  subjectColor,
  tint,
} from "../../web/src/lib/format";

describe("format web", () => {
  test("bornes et nettoyage des payloads", () => {
    expect(cleanText("  a\u0000b  ")).toBe("ab");
    expect(cleanText(null)).toBe("");
    expect(asNumber("12,5")).toBe(12.5);
    expect(asNumber("nope", 7)).toBe(7);
    expect(asNumber(Number.NaN, 3)).toBe(3);
  });

  test("notes et échelle", () => {
    expect(formatNote(16.5, 20)).toBe("16.5");
    expect(formatNote(8, 10)).toBe("16");
    expect(formatNote(0, 20)).toBe("0");
  });

  test("semaine du lundi", () => {
    const monday = new Date(2026, 9, 19);
    const sunday = addDays(monday, 6);
    expect(isoDay(startOfWeek(sunday))).toBe("2026-10-19");
    expect(isSameDay(addDays(startOfWeek(sunday), 6), sunday)).toBe(true);
  });

  test("identité visuelle stable", () => {
    expect(subjectColor("MATHEMATIQUES")).toBe(subjectColor("MATHEMATIQUES"));
    expect(hexToRgb("#29947a")).toEqual([41, 148, 122]);
    expect(tint("#000000", 1)).toBe("rgb(255 255 255)");
    expect(initials("DUPONT Camille")).toBe("DC");
  });

  test("plages horaires", () => {
    expect(frRange("2026-10-19T06:00:00.000Z", "2026-10-19T08:00:00.000Z")).toMatch(/–/);
  });
});
