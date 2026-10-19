import { useParisTz } from "./setup";

import { describe, expect, test } from "bun:test";
import { canteenDayLabel } from "../../web/src/features/canteen/canteen";
import { millisOf } from "../../web/src/features/home/parse";
import { newsDateLabel } from "../../web/src/features/news/news";
import { revisionDateLabel } from "../../web/src/features/revisions/sheets";
import { assignmentDate, assignmentDayKey } from "../../web/src/features/tasks/assignments";
import {
  addDays,
  asNumber,
  cleanText,
  formatNote,
  frDate,
  frDateShort,
  frRange,
  hexToRgb,
  initials,
  isSameDay,
  isoDay,
  parseDate,
  startOfWeek,
  subjectColor,
  tint,
} from "../../web/src/lib/format";

useParisTz();

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

// Une date seule est un jour civil : elle ne doit jamais glisser d'un jour
// selon le fuseau de l'appareil (le web tourne dans la WebView du téléphone).
const OUEST_DE_GREENWICH = "America/Los_Angeles";

/** Force un fuseau le temps du test, puis rend la main. */
function avecTz(tz: string, run: () => void): void {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try {
    run();
  } finally {
    process.env.TZ = previous;
  }
}

/** Jour et mois d'un rendu (« vendredi 16 octobre », « 16 octobre 2026 »). */
function jourMois(texte: string): string {
  return texte
    .replace(/^(dimanche|lundi|mardi|mercredi|jeudi|vendredi|samedi)\s+/, "")
    .replace(/\s+\d{4}$/, "");
}

describe("dates web", () => {
  test("une date seule est minuit local, pas minuit UTC", () => {
    avecTz(OUEST_DE_GREENWICH, () => {
      // `new Date("2026-10-16")` vaut minuit UTC : à l'ouest de Greenwich la
      // date affichée passerait à la veille.
      expect(frDate("2026-10-16")).toBe("vendredi 16 octobre");
      expect(frDateShort("2026-10-16")).toBe("16 oct.");
      expect(isoDay(parseDate("2026-10-16")!)).toBe("2026-10-16");
    });
  });

  test("tous les modules lisent une date seule au même jour", () => {
    avecTz(OUEST_DE_GREENWICH, () => {
      expect(canteenDayLabel("2026-10-16")).toBe("16 octobre 2026");
      expect(assignmentDayKey("2026-10-16")).toBe("2026-10-16");
      expect(isoDay(assignmentDate("2026-10-16")!)).toBe("2026-10-16");
      expect(isoDay(new Date(millisOf("2026-10-16")!))).toBe("2026-10-16");
    });
  });

  test("les abréviations de mois sont justes", () => {
    const attendu = [
      "janv.", "févr.", "mars", "avr.", "mai", "juin",
      "juil.", "août", "sept.", "oct.", "nov.", "déc.",
    ];
    attendu.forEach((mois, index) => {
      const jour = String(index + 1).padStart(2, "0");
      expect(frDateShort(`2026-${jour}-15`)).toBe(`15 ${mois}`);
    });
  });

  test("parité : format, actualités et fiches de révision rendent la même date", () => {
    avecTz(OUEST_DE_GREENWICH, () => {
      const date = "2026-10-16";
      const fiche = { id: "s1", title: "Fiche", subject: "HISTOIRE", date, sources: [], body: "b" };
      expect(jourMois(frDate(date))).toBe("16 octobre");
      expect(jourMois(newsDateLabel(date))).toBe("16 octobre");
      expect(jourMois(revisionDateLabel(fiche))).toBe("16 octobre");
    });
  });
});
