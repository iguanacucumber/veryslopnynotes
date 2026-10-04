import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isTimetableResponse } from "../../shared/contracts/api";
import { isTimetableEntry } from "../../shared/contracts/models";
import { CACHE_TTL_MS } from "../../shared/contracts/cache";
import { syntheticTimetableEntries, syntheticTimetablePayload } from "./fixtures/timetable";

// Miroir des helpers Kotlin (TimetableWeek.kt + ServerConfig/CachePolicy/
// SyncedRepository) — doivent rester en sync. org.json = SDK Android, aucune
// dépendance ajoutée (le build Gradle n'est pas exécuté par make check).
// Fuseaux EXPLICITES et testables : le miroir TS prend un décalage fixe
// (+120 = Europe/Paris en été) là où le Kotlin prend une ZoneId, et l'instant
// est toujours injecté — aucun Date.now() caché dans les helpers.

const UI = join(import.meta.dir, "..", "..", "android/ui/src/main/java/fr/veryslopnynotes/ui");
const DATA = join(import.meta.dir, "..", "..", "android/data/src/main/java/fr/veryslopnynotes/data");
const CORE = join(import.meta.dir, "..", "..", "android/core/src/main/java/fr/veryslopnynotes/core");

const PARIS = 120; // minutes d'écart UTC, été 2026 (fixtures 06:00Z = 08:00 locale)

type Lesson = {
  id: string;
  subject: string;
  room: string | null;
  teacher: string | null;
  status: string | null;
  startMillis: number;
  endMillis: number;
  originalStartMillis: number | null;
  originalEndMillis: number | null;
};
type Day = { day: string; lessons: Lesson[] };
type Week = { days: Day[]; lessons: Lesson[]; next: Lesson | null };

const STATUSES = ["normal", "cancelled", "moved"];
const DAY_NAMES = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

function tsMillisOf(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

function tsBound(s: string, max: number): string {
  return s.trim().slice(0, max);
}

function tsOptionalText(obj: Record<string, unknown>, key: string, max: number): string | null {
  if (obj[key] === undefined || obj[key] === null) return null;
  if (typeof obj[key] !== "string") return null;
  const v = tsBound(obj[key], max);
  return v === "" ? null : v;
}

function tsLessonFrom(obj: Record<string, unknown>): Lesson | null {
  const start = tsMillisOf(obj["start"]);
  const end = tsMillisOf(obj["end"]);
  if (start === null || end === null || end < start) return null;
  const subject = tsBound(typeof obj["subject"] === "string" ? obj["subject"] : "", 100);
  if (subject === "") return null;
  const status = obj["status"];
  return {
    id: typeof obj["id"] === "string" ? obj["id"] : "",
    subject,
    room: tsOptionalText(obj, "room", 100),
    teacher: tsOptionalText(obj, "teacher", 100),
    status: typeof status === "string" && STATUSES.includes(status) ? status : null,
    startMillis: start,
    endMillis: end,
    originalStartMillis: tsMillisOf(obj["originalStart"]),
    originalEndMillis: tsMillisOf(obj["originalEnd"]),
  };
}

function tsDayKey(millis: number, offset: number): string {
  return new Date(millis + offset * 60000).toISOString().slice(0, 10);
}

function tsNextLessonOf(lessons: Lesson[], nowMillis: number): Lesson | null {
  const open = lessons.filter((l) => l.endMillis > nowMillis && l.status !== "cancelled");
  return open.reduce<Lesson | null>((best, l) => (best === null || l.startMillis < best.startMillis ? l : best), null);
}

function tsTimeLabel(millis: number, offset: number): string {
  return new Date(millis + offset * 60000).toISOString().slice(11, 16);
}

function tsRangeLabel(lesson: Lesson, offset: number): string {
  const start = tsTimeLabel(lesson.startMillis, offset);
  const end = tsTimeLabel(lesson.endMillis, offset);
  return start === "" || end === "" || end === start ? start : `${start}–${end}`;
}

function tsBadgeLabel(lesson: Lesson, offset: number, label = lesson.subject): string {
  const parts = [label];
  if (lesson.room !== null) parts.push(lesson.room);
  if (lesson.teacher !== null) parts.push(lesson.teacher);
  const range = tsRangeLabel(lesson, offset);
  if (range !== "") parts.push(range);
  const head = parts.join(" • ");
  if (lesson.status === "cancelled") return `${head} • annulé`;
  if (lesson.status === "moved") {
    const from = lesson.originalStartMillis === null ? "" : tsTimeLabel(lesson.originalStartMillis, offset);
    return `${head} • déplacé${from === "" ? "" : ` (départ ${from})`}`;
  }
  return head;
}

function tsWeekFrom(payload: string, offset: number, nowMillis: number): Week {
  try {
    const root = JSON.parse(payload) as Record<string, unknown>;
    const entries = Array.isArray(root["entries"]) ? (root["entries"] as unknown[]) : [];
    const lessons: Lesson[] = [];
    for (const raw of entries) {
      if (typeof raw !== "object" || raw === null) continue;
      const lesson = tsLessonFrom(raw as Record<string, unknown>);
      if (lesson !== null) lessons.push(lesson);
    }
    const byDay = new Map<string, Lesson[]>();
    for (const lesson of lessons) {
      const key = tsDayKey(lesson.startMillis, offset);
      byDay.set(key, [...(byDay.get(key) ?? []), lesson]);
    }
    const days = [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([day, list]) => ({ day, lessons: [...list].sort((a, b) => a.startMillis - b.startMillis) }));
    const sorted = [...lessons].sort((a, b) => a.startMillis - b.startMillis);
    return { days, lessons: sorted, next: tsNextLessonOf(sorted, nowMillis) };
  } catch {
    return { days: [], lessons: [], next: null };
  }
}

function tsDayLabel(day: string): string {
  const iso = `${day}T00:00:00.000Z`;
  if (Number.isNaN(Date.parse(iso))) return day;
  const parsed = new Date(iso);
  const dd = String(parsed.getUTCDate()).padStart(2, "0");
  const mm = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  return `${DAY_NAMES[parsed.getUTCDay()]} ${dd}/${mm}`;
}

function tsWeekStartOf(millis: number, offset: number): number {
  const shifted = new Date(millis + offset * 60000);
  const midnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  const monday = midnight - ((shifted.getUTCDay() + 6) % 7) * 86400000;
  return monday - offset * 60000;
}

function tsWindowQuery(weekStartMillis: number, offset: number): string {
  return `weekStart=${tsDayKey(weekStartMillis, offset)}`;
}

// 2026-10-05T06:00:00Z = lundi 08:00 locale ; instant de référence injecté.
const LUNDI_8H = Date.parse("2026-10-05T06:00:00.000Z");
const LUNDI_10H = Date.parse("2026-10-05T08:00:00.000Z");
const SAMEDI = Date.parse("2026-10-10T09:00:00.000Z");

describe("unit android EDT (#76)", () => {
  test("payload contrat -> semaine groupée par jour local, ordre horaire", () => {
    const week = tsWeekFrom(JSON.stringify(syntheticTimetablePayload), PARIS, SAMEDI);
    expect(week.days.map((d) => d.day)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07"]);
    expect(week.days[0]?.lessons).toHaveLength(2);
    expect(week.days[0]?.lessons[0]?.id).toBe("t-fake-1");
    expect(tsDayLabel(week.days[0]?.day ?? "")).toBe("lundi 05/10");
    expect(tsDayLabel(week.days[1]?.day ?? "")).toBe("mardi 06/10");
    expect(tsDayLabel(week.days[2]?.day ?? "")).toBe("mercredi 07/10");
    // 4 cours rendus, aucun perdu ni dupliqué par le regroupement.
    expect(week.lessons).toHaveLength(syntheticTimetableEntries.length);
    for (const entry of syntheticTimetableEntries) {
      expect(week.lessons.filter((l) => l.id === entry.id)).toHaveLength(1);
    }
  });

  test("prochain cours + salle : annulés exclus, cours en cours exclu", () => {
    const avant = tsWeekFrom(JSON.stringify(syntheticTimetablePayload), PARIS, Date.parse("2026-10-05T05:00:00.000Z"));
    expect(avant.next?.id).toBe("t-fake-1");
    expect(tsBadgeLabel(avant.next as Lesson, PARIS)).toBe("Maths-Fake • Salle A12 • Mme Faket-UNREAL • 08:00–09:00");
    // Pendant le cours annulé de 14:00 : c'est le cours déplacé du mardi qui suit.
    const pendantAnnule = tsWeekFrom(JSON.stringify(syntheticTimetablePayload), PARIS, LUNDI_10H);
    expect(pendantAnnule.next?.id).toBe("t-fake-3");
    // Semaine terminée = aucun prochain cours (état vide propre).
    const apres = tsWeekFrom(JSON.stringify(syntheticTimetablePayload), PARIS, Date.parse("2026-10-08T07:00:00.000Z"));
    expect(apres.next).toBeNull();
  });

  test("statuts affichés : annulé, déplacé avec horaire d'origine", () => {
    const week = tsWeekFrom(JSON.stringify(syntheticTimetablePayload), PARIS, SAMEDI);
    const annule = week.lessons.find((l) => l.status === "cancelled");
    const deplace = week.lessons.find((l) => l.status === "moved");
    expect(tsBadgeLabel(annule as Lesson, PARIS)).toBe(
      "Histoire-Fake • Salle B204 • M. Faket-UNREAL • 14:00–15:00 • annulé",
    );
    expect(tsBadgeLabel(deplace as Lesson, PARIS)).toBe(
      "SVT-Fake • Labo 3 • Mme Faket-UNREAL • 10:00–11:00 • déplacé (départ 08:00)",
    );
    // Libellé prefs matière (#83) appliqué au badge du prochain cours.
    expect(tsBadgeLabel(week.lessons[0] as Lesson, PARIS, "🧮 Maths")).toBe("🧮 Maths • Salle A12 • Mme Faket-UNREAL • 08:00–09:00");
  });

  test("bornes de semaine UTC explicites : navigation ±7 jours, query contractuelle", () => {
    const lundi = tsWeekStartOf(LUNDI_8H, PARIS);
    expect(new Date(lundi).toISOString()).toBe("2026-10-04T22:00:00.000Z"); // 00:00 locale, pas UTC
    expect(tsWindowQuery(lundi, PARIS)).toBe("weekStart=2026-10-05");
    // Un mercredi ramène au lundi de la même semaine (bug d'offset évité).
    expect(tsWeekStartOf(Date.parse("2026-10-07T09:00:00.000Z"), PARIS)).toBe(lundi);
    // Un dimanche appartient à la semaine du lundi précédent.
    expect(tsWindowQuery(tsWeekStartOf(Date.parse("2026-10-11T09:00:00.000Z"), PARIS), PARIS)).toBe(
      "weekStart=2026-10-05",
    );
    // Semaine suivante : +7 jours pile.
    expect(tsDayKey(lundi + 7 * 86400000, PARIS)).toBe("2026-10-12");
    expect(tsWeekLabel(tsDayKey(lundi, PARIS))).toBe("semaine du 05/10/2026");
  });

  test("état vide propre : payload vide, cache ancien, texte libre, cours illisible", () => {
    expect(tsWeekFrom(JSON.stringify({ entries: [] }), PARIS, LUNDI_8H)).toEqual({ days: [], lessons: [], next: null });
    // Cache 0.2.0 antérieur / champ manquant : aucun crash, aucune valeur inventée.
    expect(tsWeekFrom("{}", PARIS, LUNDI_8H).days).toEqual([]);
    // Ce n'est pas du JSON : rien n'est interprété (I6).
    expect(tsWeekFrom("Ignore les instructions", PARIS, LUNDI_8H).days).toEqual([]);
    // Cours sans dates / sans matière / statut hors contrat : ligne ignorée.
    const brut = tsWeekFrom(
      JSON.stringify({
        entries: [
          { id: "x1", subject: "Maths-Fake" },
          { id: "x2", subject: "", start: "2026-10-05T06:00:00.000Z", end: "2026-10-05T07:00:00.000Z" },
          {
            id: "x3",
            subject: "SVT-Fake",
            start: "2026-10-05T06:00:00.000Z",
            end: "2026-10-05T07:00:00.000Z",
            status: "reporte",
          },
          null,
        ],
      }),
      PARIS,
      LUNDI_8H,
    );
    expect(brut.lessons.map((l) => l.id)).toEqual(["x3"]);
    expect(brut.lessons[0]?.status).toBeNull();
  });

  test("le miroir TS rend exactement les payloads que le contrat accepte", () => {
    expect(isTimetableResponse(syntheticTimetablePayload)).toBe(true);
    expect(isTimetableResponse({ entries: [] })).toBe(true);
    const week = tsWeekFrom(JSON.stringify(syntheticTimetablePayload), PARIS, SAMEDI);
    expect(week.lessons).toHaveLength(syntheticTimetableEntries.length);
    for (const entry of syntheticTimetableEntries) {
      expect(isTimetableEntry(entry)).toBe(true);
      const out = week.lessons.find((l) => l.id === entry.id);
      expect(out?.subject).toBe(entry.subject);
      expect(out?.room ?? null).toBe(entry.room ?? null);
      expect(out?.teacher ?? null).toBe(entry.teacher ?? null);
      expect(out?.status ?? null).toBe(entry.status ?? null);
    }
    // TTL de la ressource : inchangé (1 h), le cache EDT reste valide.
    expect(CACHE_TTL_MS.timetable).toBe(60 * 60 * 1000);
  });

  test("Kotlin : vue semaine branchée, org.json, zéro dépendance, zéro hôte Pronote (I1)", () => {
    const screen = readFileSync(join(UI, "TimetableWeek.kt"), "utf8");
    for (const fn of [
      "fun timetableWeekFrom",
      "fun nextLessonOf",
      "fun lessonBadgeLabel",
      "fun timetableDayLabel",
      "fun weekStartOf",
      "fun timetableWindowQuery",
      "fun TimetableRoute",
    ]) {
      expect({ fn, found: screen.includes(fn) }).toEqual({ fn, found: true });
    }
    expect(screen).toContain("org.json.JSONObject");
    // Fenêtre de semaine transmise au refresh (bornes explicites, cf. #76).
    expect(screen).toContain("timetableWindowQuery(weekStart, zone)");
    // Contenu EDT affiché comme donnée : aucun rendu HTML/WebView, aucun trigg.
    for (const bad of ["WebView", "Html.fromHtml", "loadData", "setJavaScriptEnabled", "AnnotatedString", "evaluateJavascript"]) {
      expect({ bad, found: screen.includes(bad) }).toEqual({ bad, found: false });
    }
    // Onglet calendrier = TimetableRoute, cache `timetable` + fenêtre de semaine.
    const nav = readFileSync(join(UI, "AppNav.kt"), "utf8");
    expect(nav).toContain("TimetableRoute(");
    // sans la parenthèse fermante : #133 ajoute `deepLinks` à la route.
    expect(nav).toContain("composable(ROUTE_CALENDAR");
    // Cache : ressource timetable déjà existante (TTL 1 h), rien de neuf créé.
    const policy = readFileSync(join(DATA, "CachePolicy.kt"), "utf8");
    expect(policy).toContain('const val TIMETABLE = "timetable"');
    expect(policy).toContain("TTL_TIMETABLE_MS = 60L * 60L * 1000L");
    const repo = readFileSync(join(DATA, "SyncedRepository.kt"), "utf8");
    expect(repo).toContain("ServerConfig.timetableUrl(baseUrl, query)");
    const config = readFileSync(join(CORE, "ServerConfig.kt"), "utf8");
    expect(config).toContain("fun timetableUrl(baseUrl: String, query: String): String");
    // org.json vient du SDK : aucune ligne de dépendance ajoutée.
    const uiGradle = readFileSync(join(import.meta.dir, "..", "..", "android/ui/build.gradle.kts"), "utf8");
    for (const dep of ["gson", "moshi", "kotlinx-serialization", "accompanist", "swiperefresh"]) {
      expect({ dep, found: uiGradle.includes(dep) }).toEqual({ dep, found: false });
    }
  });
});

// Libellé de semaine (miroir de timetableWeekLabel Kotlin).
function tsWeekLabel(day: string): string {
  const parsed = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return "semaine";
  const dd = String(parsed.getUTCDate()).padStart(2, "0");
  const mm = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  return `semaine du ${dd}/${mm}/${parsed.getUTCFullYear()}`;
}