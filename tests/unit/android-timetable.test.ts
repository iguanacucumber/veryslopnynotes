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
// Instants toujours INJECTÉS : aucun Date.now() caché dans les helpers.
//
// Deux Parties, deux façons de miroiter le temps, et pourquoi :
//   - les helpers de LECTURE D'UN PAYLOAD (`tsDayKey`, `tsTimeLabel`,
//     `tsWeekFrom`) prennent un décalage fixe (+120 = Europe/Paris en été) là où
//     le Kotlin prend une `ZoneId` : les fixtures tombent toutes en octobre 2026,
//     donc le fuseau EST à +02:00 sur toute la fenêtre et un fuseau complet n'y
//     changerait rien. C'est ce qu'annonce l'en-tête, et `bun test` le vérifie ;
//   - les helpers de SEMAINE et de CARTE ajoutés par #137 prennent un VRAI
//     fuseau : l'arithmétique de semaine ne PEUT PAS être miroitée avec un
//     décalage fixe, puisque c'est exactement le défaut qu'elle corrige (167 h ou
//     169 h selon le côté du changement d'heure, jamais 168 h). Voir plus bas
//     « #137 : l'EDT devient un pager par jour ».

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
  // #137 : `startMillis > now`, pas `endMillis > now` — pendant un cours, le
  // « prochain » était le cours EN COURS, donc rien n'était jamais signalé
  // comme « à venir ».
  const open = lessons.filter((l) => l.startMillis > nowMillis && l.status !== "cancelled");
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


// ===========================================================================
// #137 : l'EDT devient un pager par jour, une page par jour. Miroir de la
// logique pure ajoutée à `TimetableWeek.kt` (`shiftWeeks`, `currentLessonOf`,
// `lessonDurationLabel`, `dayNameFr`/`dayPillLabel`/`daySubtitleFr`,
// `lunchBreakOf`/`dayItemsUi`, `highlightOf`) et de `subjectColorHex`
// (SubjectStyle.kt), plus la carte (fond et encre d'un cours annulé).
//
// DEUX FAÇONS DE MIROITER LE TEMPS, et pourquoi :
//   - la lecture d'un PAYLOAD (`tsDayKey`, `tsTimeLabel`) garde le décalage fixe
//     `PARIS = +120` : les fixtures tombent toutes en octobre 2026, donc
//     Europe/Paris EST en +02:00 sur toute la fenêtre — un fuseau complet n'y
//     changerait rien ;
//   - l'arithmétique de SEMAINE, elle, NE PEUT PAS être miroitée avec un décalage
//     fixe : c'est précisément le défaut qu'elle corrige (168 h fixes contre 167 h
//     ou 169 h selon le côté du changement d'heure). Ces miroirs-là prennent un
//     VRAI fuseau et convertissent les dates civiles en instants.
//
// Dérive assumée : duplication de la logique Kotlin, comme tous les autres
// miroirs du dépôt (un JVM ne tourne pas dans `bun test`). Ce que le miroir ne
// voit pas : la résolution de symbole et le rendu — `make android-compile`
// compile le vrai fichier, l'appareil fait le reste.
const ZONE = "Europe/Paris";
type Civil = { y: number; m: number; d: number; hh: number; mm: number; ss: number };
const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Équivalent TS de `Instant.ofEpochMilli(ms).atZone(zone)` : les parties
 *  CIVILES locales du fuseau (pas un décalage : un changement d'heure est
 *  justement ce qu'on veut voir ici). */
function zonedAt(ms: number, zone: string = ZONE): Civil {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(ms))) if (part.type !== "literal") p[part.type] = part.value;
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    hh: Number(p.hour),
    mm: Number(p.minute),
    ss: Number(p.second),
  };
}

/** Décalage du fuseau à cet instant : les parties civiles lues comme UTC moins
 *  l'instant lui-même. */
function zoneOffsetMs(ms: number, zone: string = ZONE): number {
  const p = zonedAt(ms, zone);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - (ms - (ms % 1000));
}

/** Instant d'une heure locale — l'équivalent de `atTime(..).atZone(zone)`.
 *  Deux passes : l'offset peut changer entre l'estimation et le résultat. */
function localCivilMs(y: number, m: number, d: number, hh: number, mm: number, zone: string = ZONE): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  const offset = zoneOffsetMs(guess, zone);
  const first = guess - offset;
  const again = zoneOffsetMs(first, zone);
  return again === offset ? first : guess - again;
}

/** Date locale du lundi de la semaine qui contient `ms` : `getUTCDay()` compte
 *  le dimanche pour 0, `(jour + 6) % 7` donne donc 0 = lundi, comme le
 *  `dayOfWeek.value - 1` de `java.time` (lundi = 1). */
function tsWeekStartDate(ms: number, zone: string = ZONE): { y: number; m: number; d: number } {
  const p = zonedAt(ms, zone);
  const offset = (new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(p.y, p.m - 1, p.d) - offset * 86_400_000);
  return { y: monday.getUTCFullYear(), m: monday.getUTCMonth() + 1, d: monday.getUTCDate() };
}

/** Miroir de `weekStartOf` : lundi 00 h 00 locales. */
function tsWeekStartOfZone(ms: number, zone: string = ZONE): number {
  const c = tsWeekStartDate(ms, zone);
  return localCivilMs(c.y, c.m, c.d, 0, 0, zone);
}

/** Miroir de `shiftWeeks` : on additionne des JOURS CIVILS, puis on recalcule le
 *  lundi 00 h local. Jamais 168 h. */
function tsShiftWeeks(weekStartMillis: number, weeks: number, zone: string = ZONE): number {
  const c = tsWeekStartDate(weekStartMillis, zone);
  const target = new Date(Date.UTC(c.y, c.m - 1, c.d) + weeks * 7 * 86_400_000);
  return localCivilMs(target.getUTCFullYear(), target.getUTCMonth() + 1, target.getUTCDate(), 0, 0, zone);
}

/** Ce que faisait l'arithmétique FIXE de #76 (`WEEK_MS`), gardée comme témoin du
 *  bug corrigé : elle a disparu du Kotlin, elle reste dans le test. */
const LEGACY_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const tsShiftWeeksLegacy = (weekStartMillis: number, weeks: number): number =>
  weekStartMillis + (weeks < 0 ? -LEGACY_WEEK_MS : LEGACY_WEEK_MS);

/** Date locale ISO d'un instant (comme le `dayKey` Kotlin). */
const tsLocalDayKey = (ms: number, zone: string = ZONE): string => {
  const p = zonedAt(ms, zone);
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
};

/** Miroir de `dayNameFr` : `DAY_NAMES` commence au dimanche comme l'index
 *  `dayOfWeek.value % 7` de `java.time` (dimanche = 7 → 0). */
const tsDayNameFr = (ms: number, zone: string = ZONE): string => {
  const p = zonedAt(ms, zone);
  return capitalize(DAY_NAMES[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()]);
};
const MONTH_NAMES = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];
const tsMonthNameFr = (ms: number, zone: string = ZONE): string => MONTH_NAMES[zonedAt(ms, zone).m - 1] ?? "";
const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const tsDayPillLabel = (ms: number, zone: string = ZONE): string =>
  [String(zonedAt(ms, zone).d), tsMonthNameFr(ms, zone)].filter((v) => v !== "").join(" ");

/** Miroir de `daySubtitleFr`. */
const tsDaySubtitleFr = (dayMs: number, todayMs: number, zone: string = ZONE): string => {
  const diff = Math.round((tsCivilOf(dayMs, zone) - tsCivilOf(todayMs, zone)) / 86_400_000);
  return diff === 0 ? "Aujourd'hui" : diff === -1 ? "Hier" : diff === 1 ? "Demain" : "";
};
const tsCivilOf = (ms: number, zone: string): number => {
  const p = zonedAt(ms, zone);
  return Date.UTC(p.y, p.m - 1, p.d);
};

/** Miroir de `durationLabelOf`. */
function tsDurationLabelOf(millis: number): string {
  const minutes = Math.max(0, Math.floor(millis / 60_000));
  if (minutes < 1) return "";
  if (minutes < 60) return minutes === 1 ? "1 min" : `${minutes} mins`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest} mins`;
}
const tsLessonDurationLabel = (l: Lesson): string => tsDurationLabelOf(l.endMillis - l.startMillis);

/** Miroir de `currentLessonOf`. */
function tsCurrentLessonOf(lessons: Lesson[], nowMillis: number): Lesson | null {
  const open = lessons.filter((l) => l.startMillis <= nowMillis && nowMillis < l.endMillis && l.status !== "cancelled");
  return open.reduce<Lesson | null>((best, l) => (best === null || l.startMillis < best.startMillis ? l : best), null);
}

/** Miroir de `highlightOf` : en cours > prochain > rien. */
function tsHighlightOf(lesson: Lesson, currentStartMillis: number | null, nextStartMillis: number | null): "NONE" | "NEXT" | "CURRENT" {
  if (currentStartMillis !== null && lesson.startMillis === currentStartMillis) return "CURRENT";
  if (nextStartMillis !== null && lesson.startMillis === nextStartMillis) return "NEXT";
  return "NONE";
}

/** Query de fenêtre du contrat, dans le FUSEAU (`weekStart=2026-10-05`) :
 *  version zone-aware de `tsWindowQuery`, qui plus haut garde le décalage fixe. */
const tsWindowQueryZone = (ms: number, zone: string = ZONE): string => `weekStart=${tsLocalDayKey(ms, zone)}`;

/** Miroir de `lunchBreakOf` : le creux doit contenir 12 h 30 locales et durer
 *  au moins 45 minutes. */
function tsLunchBreak(prevEnd: number, nextStart: number, zone: string = ZONE): { label: string; startMillis: number; endMillis: number } | null {
  if (nextStart - prevEnd < 45 * 60_000) return null;
  const p = zonedAt(prevEnd, zone);
  const noon = localCivilMs(p.y, p.m, p.d, 12, 30, zone);
  if (prevEnd > noon || nextStart < noon) return null;
  return { label: "Pause méridienne", startMillis: prevEnd, endMillis: nextStart };
}

/** Miroir de `dayItemsUi` : cours triés, pause méridienne insérée dans le creux. */
function tsDayItems(lessons: Lesson[], zone: string = ZONE): { kind: "LECOURS" | "PAUSE"; id: string }[] {
  const sorted = [...lessons].sort((a, b) => a.startMillis - b.startMillis);
  const out: { kind: "LECOURS" | "PAUSE"; id: string }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) {
      const pause = tsLunchBreak(sorted[i - 1]!.endMillis, sorted[i]!.startMillis, zone);
      if (pause !== null) out.push({ kind: "PAUSE", id: pause.label });
    }
    out.push({ kind: "LECOURS", id: sorted[i]!.id });
  }
  return out;
}

/** Miroir de `stableHash` (SubjectStyle.kt) : `fold(31)` masqué sur 32 bits,
 *  itéré sur les unités UTF-16 comme le `for (c in value)` de Kotlin. */
function tsStableHash(value: string): number {
  let acc = 7;
  for (let i = 0; i < value.length; i++) acc = (Math.imul(acc, 31) + value.charCodeAt(i)) >>> 0;
  return acc;
}

const SUBJECT_PALETTE = [
  "#C50017", "#DA2400", "#DD6B00", "#E8901C", "#E8B048",
  "#6BAE00", "#37BB12", "#12BB67", "#26B290", "#26ABB2",
  "#2DB9D8", "#009EC5", "#007FDA", "#3A56D0", "#7600CA",
  "#962DD8", "#B300CA", "#C50066", "#DD004A", "#DD0030",
];
const tsDerivedSubjectHex = (subject: string): string =>
  SUBJECT_PALETTE[tsStableHash(subject.trim().toLowerCase()) % SUBJECT_PALETTE.length]!;
/** Miroir de `subjectColorHex` : les prefs d'abord, sinon la couleur dérivée. */
const tsSubjectColorHex = (prefHex: string | null, subject: string): string =>
  prefHex !== null && /^#[0-9a-fA-F]{6}$/.test(prefHex) ? prefHex : tsDerivedSubjectHex(subject);

// --- Couleurs : miroir de `tint`, luminance et contraste (PapillonTheme.kt) ---
type Rgb = { r: number; g: number; b: number };
const hex8 = (h: string): Rgb => ({
  r: parseInt(h.slice(1, 3), 16) / 255,
  g: parseInt(h.slice(3, 5), 16) / 255,
  b: parseInt(h.slice(5, 7), 16) / 255,
});
function tsTint(color: Rgb, p: number): Rgb {
  const amount = Math.min(1, Math.abs(p));
  const towardWhite = p >= 0;
  const f = (v: number): number => (towardWhite ? v + (1 - v) * amount : v - v * amount);
  return { r: f(color.r), g: f(color.g), b: f(color.b) };
}
function tsLuminance(color: Rgb): number {
  const l = (v: number): number => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * l(color.r) + 0.7152 * l(color.g) + 0.0722 * l(color.b);
}
const tsContrast = (a: Rgb, b: Rgb): number => {
  const la = tsLuminance(a);
  const lb = tsLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const rounded = (x: number): number => Math.round(x * 100) / 100;
const toHex = (c: Rgb): string => `#${[c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
const DANGER = hex8("#DC1400");
/** Miroir de `cancelledSurface` / `cancelledInk` : le rouge de marque du thème,
 *  dérivé par le MÊME `tint` que le reste, donc sans couleur en dur. */
const tsCancelledSurface = (dark: boolean): Rgb => tsTint(DANGER, dark ? -0.6 : 0.82);
const tsCancelledInk = (dark: boolean): Rgb => tsTint(DANGER, dark ? 0.72 : -0.45);

/** Un cours de test (les fixtures n'ont pas les cas dont j'ai besoin ici). */
const lesson = (id: string, startIso: string, endIso: string, status: string | null = "normal"): Lesson => ({
  id,
  subject: `${id}-mat`,
  room: null,
  teacher: null,
  status,
  startMillis: Date.parse(startIso),
  endMillis: Date.parse(endIso),
  originalStartMillis: null,
  originalEndMillis: null,
});

/** Heure locale d'un jour d'octobre 2026 (UTC+2) : 08:00 locale = 06:00Z. */
const at = (hour: number, minute = 0): number => Date.parse(`2026-10-05T${pad2(hour)}:${pad2(minute)}:00.000Z`) - 2 * 3_600_000;
const MERIDIENNE = "Pause méridienne";

describe("unit android EDT par jour (#137)", () => {
  test("navigation de semaine : des jours civils, jamais 168 h (le bug de l'heure d'été)", () => {
    // Deux changements d'heure en 2026 : dimanche 29 mars (passage à l'heure
    // d'été, +02:00) et dimanche 25 octobre (retour à l'heure d'hiver, +01:00).
    const lundi = (iso: string): number => tsWeekStartOfZone(Date.parse(iso));

    // 1. Une semaine SANS changement d'heure fait 7 jours pile, et l'aller-retour
    //    revient exactement au même instant.
    const fev23 = lundi("2026-02-25T09:00:00.000Z");
    expect(tsLocalDayKey(fev23)).toBe("2026-02-23");
    expect(tsShiftWeeks(fev23, 1) - fev23).toBe(7 * 86_400_000);
    expect(tsShiftWeeks(tsShiftWeeks(fev23, 1), -1)).toBe(fev23);

    // 2. La semaine du 23 au 29 mars CONTIENT le passage à l'heure d'été : elle
    //    ne dure que 167 h, et `plusWeeks` pose quand même le lundi 30 à 00 h.
    const mar23 = lundi("2026-03-25T09:00:00.000Z");
    expect(tsLocalDayKey(mar23)).toBe("2026-03-23");
    const mar30 = tsShiftWeeks(mar23, 1);
    expect(mar30 - mar23).toBe(167 * 3_600_000);
    expect(tsLocalDayKey(mar30)).toBe("2026-03-30");
    expect(tsShiftWeeks(mar30, -1)).toBe(mar23);
    expect(tsShiftWeeks(mar30, 1) - mar30).toBe(7 * 86_400_000);

    // 3. LE CAS DESTRUCTEUR, côté octobre : la semaine du 19 est à +02:00
    //    jusqu'au dimanche 25 inclus, la suivante à +01:00. En avant de 168 h,
    //    l'ancien calcul tombe sur DIMANCHE 23 h — donc `weekStart=` partait
    //    sur le dimanche, pour le reste de la session. `plusWeeks` non.
    const oct19 = lundi("2026-10-22T09:00:00.000Z");
    expect(tsLocalDayKey(oct19)).toBe("2026-10-19");
    const oct26 = tsShiftWeeks(oct19, 1);
    expect(oct26 - oct19).toBe(169 * 3_600_000);
    expect(tsLocalDayKey(oct26)).toBe("2026-10-26");
    expect(tsLocalDayKey(tsShiftWeeksLegacy(oct19, 1))).toBe("2026-10-25");
    expect(tsShiftWeeksLegacy(oct19, 1)).toBe(oct26 - 3_600_000);
    expect(tsShiftWeeks(oct26, -1)).toBe(oct19);
    // Le même défaut en arrière, de l'autre côté de l'année : la semaine du 30
    // mars moins 168 h, c'est le dimanche 22 mars à 23 h.
    expect(tsLocalDayKey(tsShiftWeeksLegacy(mar30, -1))).toBe("2026-03-22");
    // Et en avant depuis la semaine du 23 mars : un lundi… à 01 h, donc un
    // `weekStart` qui n'est plus minuit (le jour reste juste, l'instant non).
    expect(tsShiftWeeksLegacy(mar23, 1)).toBe(mar30 + 3_600_000);
    expect(tsLocalDayKey(tsShiftWeeksLegacy(mar23, 1))).toBe("2026-03-30");

    // 4. Dix allers-retours de part et d'autre : l'état ne dérive pas. (L'ancien
    //    calcul, lui, compose ses heures perdues et ses dimanches.)
    let week = oct19;
    for (let i = 0; i < 10; i++) week = tsShiftWeeks(tsShiftWeeks(week, 1), -1);
    expect(week).toBe(oct19);
    // Chaque semaine visée est bien un lundi 00 h 00 locales, sans exception.
    for (const [ms, attendu] of [
      [fev23, "2026-02-23"],
      [mar23, "2026-03-23"],
      [mar30, "2026-03-30"],
      [oct19, "2026-10-19"],
      [oct26, "2026-10-26"],
      [tsShiftWeeks(oct26, 1), "2026-11-02"],
      [tsShiftWeeks(oct19, -1), "2026-10-12"],
    ] as [number, string][]) {
      const p = zonedAt(ms);
      expect({ jour: tsLocalDayKey(ms), heure: `${p.hh}:${pad2(p.mm)}`, attendu }).toEqual({
        jour: attendu,
        heure: "0:00",
        attendu,
      });
      // Et la query du contrat porte bien ce lundi-là.
      expect(tsWindowQueryZone(ms)).toBe(`weekStart=${attendu}`);
    }
  });

  test("cours en cours et prochain cours : deux mises en avant, jamais la même", () => {
    const matin = lesson("matin", "2026-10-05T06:00:00.000Z", "2026-10-05T07:00:00.000Z");
    const annule = lesson("annule", "2026-10-05T09:00:00.000Z", "2026-10-05T10:00:00.000Z", "cancelled");
    const aprem = lesson("aprem", "2026-10-05T12:00:00.000Z", "2026-10-05T13:00:00.000Z");
    const liste = [matin, annule, aprem];
    // Pendant le cours du matin : il est en cours, et le PROCHAIN est bien celui
    // de 14 h — l'ancien filtre `end > now` aurait renvoyé le cours en cours.
    expect(tsCurrentLessonOf(liste, Date.parse("2026-10-05T06:30:00.000Z"))?.id).toBe("matin");
    expect(tsNextLessonOf(liste, Date.parse("2026-10-05T06:30:00.000Z"))?.id).toBe("aprem");
    // Avant le premier cours : rien en cours, le premier cours est le suivant.
    expect(tsCurrentLessonOf(liste, Date.parse("2026-10-05T05:00:00.000Z"))).toBeNull();
    expect(tsNextLessonOf(liste, Date.parse("2026-10-05T05:00:00.000Z"))?.id).toBe("matin");
    // Pendant le cours ANNULÉ : il n'est ni en cours ni le suivant (il ne se
    // passe pas) ; c'est le cours de 14 h qui est mis en avant.
    expect(tsCurrentLessonOf(liste, Date.parse("2026-10-05T09:30:00.000Z"))).toBeNull();
    expect(tsNextLessonOf(liste, Date.parse("2026-10-05T09:30:00.000Z"))?.id).toBe("aprem");
    // Après le dernier : ni l'un ni l'autre.
    expect(tsCurrentLessonOf(liste, Date.parse("2026-10-06T06:00:00.000Z"))).toBeNull();
    expect(tsNextLessonOf(liste, Date.parse("2026-10-06T06:00:00.000Z"))).toBeNull();
    // Mise en avant : en cours > prochain > rien, jamais les deux, jamais l'annulé.
    const cur = matin.startMillis;
    const next = aprem.startMillis;
    expect(tsHighlightOf(matin, cur, next)).toBe("CURRENT");
    expect(tsHighlightOf(aprem, cur, next)).toBe("NEXT");
    expect(tsHighlightOf(annule, cur, next)).toBe("NONE");
    expect(tsHighlightOf(annule, null, null)).toBe("NONE");
    expect(tsHighlightOf(matin, cur, null)).toBe("CURRENT");
  });

  test("durée en français : 1 min, 55 mins, 1h 50 mins, 2h, et rien sous une minute", () => {
    const duree = (minutes: number): string => tsDurationLabelOf(minutes * 60_000);
    expect(duree(0)).toBe("");
    expect(duree(1)).toBe("1 min");
    expect(duree(55)).toBe("55 mins");
    expect(duree(59)).toBe("59 mins");
    expect(duree(60)).toBe("1h");
    expect(duree(110)).toBe("1h 50 mins");
    expect(duree(120)).toBe("2h");
    expect(duree(605)).toBe("10h 5 mins");
    // Bornes égales ou inversées : jamais « 0 mins », jamais un négatif.
    expect(tsDurationLabelOf(-1)).toBe("");
    expect(tsLessonDurationLabel(lesson("x", "2026-10-05T06:00:00.000Z", "2026-10-05T06:00:00.000Z"))).toBe("");
    expect(tsLessonDurationLabel(lesson("x", "2026-10-05T06:00:00.000Z", "2026-10-05T06:55:00.000Z"))).toBe("55 mins");
    expect(tsLessonDurationLabel(lesson("x", "2026-10-05T06:00:00.000Z", "2026-10-05T07:50:00.000Z"))).toBe("1h 50 mins");
  });

  test("pause méridienne : le creux qui contient 12 h 30 locales, et lui seul", () => {
    // 11:55 -> 13:00 : le creux contient 12 h 30, c'est la pause (1 h 05).
    expect(tsLunchBreak(at(11, 55), at(13, 0))?.label).toBe(MERIDIENNE);
    expect(tsDurationLabelOf(at(13, 0) - at(11, 55))).toBe("1h 5 mins");
    // 11:30 -> 12:30 : midi est sur la borne, donc pause (borne fermée).
    expect(tsLunchBreak(at(11, 30), at(12, 30))?.label).toBe(MERIDIENNE);
    // 10:00 -> 10:30 : récré de 30 minutes, pas un repas.
    expect(tsLunchBreak(at(10, 0), at(10, 30))).toBeNull();
    // 12:00 -> 12:40 : le creux FINIT avant 12 h 30, donc il ne le contient pas.
    expect(tsLunchBreak(at(12, 0), at(12, 40))).toBeNull();
    // 14:00 -> 16:00 : long, mais l'après-midi.
    expect(tsLunchBreak(at(14, 0), at(16, 0))).toBeNull();
    // Une journée de 25 h (retour à l'heure d'hiver) : 12 h 30 y tombe deux
    // fois, et le creux qui le contient reste une pause.
    const soir25 = (hour: number): number => Date.parse(`2026-10-25T${pad2(hour)}:00:00.000Z`);
    expect(tsLunchBreak(soir25(10), soir25(12))?.label).toBe(MERIDIENNE);
    // Page de jour : cours, pause, cours — jamais deux pauses, jamais l'inverse.
    const matin = lesson("matin", "2026-10-05T06:00:00.000Z", "2026-10-05T07:00:00.000Z");
    const aprem = lesson("aprem", "2026-10-05T11:00:00.000Z", "2026-10-05T12:00:00.000Z");
    expect(tsDayItems([aprem, matin])).toEqual([
      { kind: "LECOURS", id: "matin" },
      { kind: "PAUSE", id: MERIDIENNE },
      { kind: "LECOURS", id: "aprem" },
    ]);
    // Deux cours consécutifs : aucune pause déduite entre eux.
    const matin2 = lesson("matin2", "2026-10-05T07:00:00.000Z", "2026-10-05T08:00:00.000Z");
    expect(tsDayItems([matin, matin2]).map((i) => i.kind)).toEqual(["LECOURS", "LECOURS"]);
  });

  test("annulé : rouge pâle dérivé du thème, encre mesurée au-dessus de 4.5:1", () => {
    // Clair : le rouge de marque (`error`) éclairci à 82 %, l'encre assombrie à
    // −45 % — le même pas que l'encre d'une carte matière. Ce fond est bien de
    // la famille « #F8D0CC » de papillon.bzh, sans qu'un hex soit recopié.
    expect(toHex(tsCancelledSurface(false))).toBe("#f9d5d1");
    expect(toHex(tsCancelledInk(false))).toBe("#790b00");
    expect(rounded(tsContrast(tsCancelledInk(false), tsCancelledSurface(false)))).toBe(8.29);
    // Sombre : le MÊME rouge assombri à −60 %, encre éclaircie à 72 %. Toujours
    // lisible, et sans une seconde feuille de style.
    expect(toHex(tsCancelledSurface(true))).toBe("#580800");
    expect(toHex(tsCancelledInk(true))).toBe("#f5bdb8");
    expect(rounded(tsContrast(tsCancelledInk(true), tsCancelledSurface(true)))).toBe(8.88);
    expect(tsContrast(tsCancelledInk(true), hex8("#121212"))).toBeGreaterThan(4.5);
    expect(tsContrast(tsCancelledInk(false), hex8("#FFFFFF"))).toBeGreaterThan(4.5);
    // Le rouge du thème EN TEXTE sur le rouge pâle mesurait 3.3:1 : c'est
    // exactement le 1.5:1 du `Color.LightGray` qu'on a laissé, en mieux.
    expect(rounded(tsContrast(DANGER, tsCancelledSurface(false)))).toBe(3.72);
    expect(tsContrast(DANGER, tsCancelledSurface(false))).toBeLessThan(4.5);
    // Le texte du cours annulé, lui, est l'encre mesurée, pas le rouge du thème.
    expect(tsContrast(tsCancelledInk(false), tsCancelledSurface(false))).toBeGreaterThan(4.5);
  });

  test("couleur de matière : les prefs d'abord, sinon une couleur dérivée du nom", () => {
    // Repli dérivé : stable, insensible à la casse et aux espaces, et toujours
    // pris dans la palette du thème (aucune couleur inventée).
    expect(tsDerivedSubjectHex("Maths-Fake")).toBe("#DD6B00");
    expect(tsDerivedSubjectHex("maths-fake")).toBe("#DD6B00");
    expect(tsDerivedSubjectHex("  MATHS-FAKE  ")).toBe("#DD6B00");
    expect(tsDerivedSubjectHex("Histoire-Fake")).toBe("#C50017");
    expect(tsDerivedSubjectHex("SVT-Fake")).toBe("#007FDA");
    expect(tsDerivedSubjectHex("EPS-Fake")).toBe("#C50066");
    for (const subject of ["Maths", "Histoire", "SVT", "EPS", "Anglais", "Physique-Chimie", ""]) {
      expect({ subject, dansLaPalette: SUBJECT_PALETTE.includes(tsDerivedSubjectHex(subject)) }).toEqual({
        subject,
        dansLaPalette: true,
      });
    }
    // Deux matières différentes ne partagent pas toujours une couleur : la
    // palette compte 20 teintes, donc la collision est possible et sans
    // conséquence (la prefs, elle, reste prioritaire).
    expect(tsSubjectColorHex("#123456", "Maths-Fake")).toBe("#123456");
    // Une couleur de prefs INVALIDE est ignorée comme si elle manquait (un cache
    // ancien peut contenir autre chose que `#RRGGBB`).
    expect(tsSubjectColorHex("nimp", "Maths-Fake")).toBe("#DD6B00");
    expect(tsSubjectColorHex(null, "Maths-Fake")).toBe("#DD6B00");
    // La couleur dérivée passe le contraste de la carte sur les 20 teintes
    // (`subjectContent` sur `subjectSurface`) : le pire est le jaune `#E8B048`.
    let pire = 99;
    let pireHex = "";
    for (const hex of SUBJECT_PALETTE) {
      const c = hex8(hex);
      const ratio = tsContrast(tsTint(c, -0.45), tsTint(c, 0.75));
      if (ratio < pire) {
        pire = ratio;
        pireHex = hex;
      }
    }
    expect({ pireHex, pire: rounded(pire) }).toEqual({ pireHex: "#E8B048", pire: 4.9 });
    expect(pire).toBeGreaterThanOrEqual(4.5);
  });

  test("en-tête de jour : nom, pastille du mois, sous-titre relatif", () => {
    expect(tsDayNameFr(at(8, 0))).toBe("Lundi");
    expect(tsDayPillLabel(at(8, 0))).toBe("5 octobre");
    expect(tsDayPillLabel(Date.parse("2026-10-05T09:00:00.000Z"))).toBe("5 octobre");
    expect(tsMonthNameFr(at(8, 0))).toBe("octobre");
    // Sous-titre : date locale comparée à date locale (à 23 h un jour de 23 h,
    // « hier » se décide sur le JOUR, pas sur un écart d'heures).
    expect(tsDaySubtitleFr(at(8, 0), at(8, 0))).toBe("Aujourd'hui");
    expect(tsDaySubtitleFr(at(8, 0) - 86_400_000, at(8, 0))).toBe("Hier");
    expect(tsDaySubtitleFr(at(8, 0) + 86_400_000, at(8, 0))).toBe("Demain");
    expect(tsDaySubtitleFr(at(8, 0) + 3 * 86_400_000, at(8, 0))).toBe("");
    // Le 25 octobre 2026 est un dimanche de 25 h : 00 h 30 locales est encore le
    // 25 (il fait 02 h 30 en CET), donc le jour ne bouge pas.
    const nuit = Date.parse("2026-10-25T00:30:00.000Z");
    expect(tsLocalDayKey(nuit)).toBe("2026-10-25");
    expect(tsDaySubtitleFr(nuit - 86_400_000, nuit)).toBe("Hier");
  });

  test("Kotlin : pager par jour, défilement, pause, couleurs de matière — rien jeté", () => {
    // Sans les commentaires : les KDoc du fichier NOMMENT les bugs corrigés
    // (« `WEEK_MS` », « `Color.LightGray` »), et une garde qui lit le texte
    // brut confondrait le nom de la mauvaise pratique avec la pratique.
    const code = (src: string): string =>
      src
        .replace(/\/\*[\s\S]*?\*\//g, "\n")
        .split("\n")
        .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
        .join("\n");
    const screen = code(readFileSync(join(UI, "TimetableWeek.kt"), "utf8"));
    const card = readFileSync(join(UI, "TimetableCourseCard.kt"), "utf8");
    // Le conteneur de défilement qui manquait (#137) : une `Column` à
    // `fillMaxSize` tronquait silencieusement la fin de la semaine.
    expect(screen).toContain("LazyColumn(");
    expect(screen).toContain("stickyHeader");
    expect(screen).toContain("HorizontalPager(");
    expect(screen).toContain("rememberPagerState");
    expect(screen).toContain("PullToRefreshContainer(");
    expect(screen).toContain("nestedScroll(pullState.nestedScrollConnection)");
    // Les briques de #136, enfin adoptées par un écran.
    for (const brique of ["PapLoading(", "PapEmptyState(", "PapErrorState(", "PapStaleBanner(", "PapCourseCard(", "PapLunchCard(", "PapPill("]) {
      const trouvee = screen.includes(brique) || card.includes(brique);
      expect({ brique, trouvee }).toEqual({ brique, trouvee: true });
    }
    // Le message RÉEL du serveur, plus la chaîne figée.
    expect(screen).toContain("PapErrorState(message = error.message");
    expect(screen.includes('"Erreur réseau. Réessayer."')).toBe(false);
    // Le bug des 168 h : plus aucune arithmétique fixe sur la semaine.
    for (const interdit of ["WEEK_MS", "7L * 24L * 60L * 60L * 1000L", "Color.LightGray"]) {
      expect({ interdit, present: (screen + code(card)).includes(interdit) }).toEqual({ interdit, present: false });
    }
    expect(screen).toContain("shiftWeeks(weekStart, -1L, zone)");
    expect(screen).toContain("shiftWeeks(weekStart, 1L, zone)");
    expect(screen).toContain("LocalDate")
    // La couleur des prefs color enfin la carte, et une matière sans prefs a un
    // repli dérivé du nom.
    expect(screen).toContain("subjectColorHex(subjectPrefs, lesson.subject)");
    const style = readFileSync(join(UI, "SubjectStyle.kt"), "utf8");
    expect(style).toContain("fun subjectColorHex");
    expect(style).toContain("fun derivedSubjectHex");
    // La carte ne lit ni dépôt ni prefs : elle reçoit un libellé et une couleur.
    for (const interdit of ["SyncedRepository", "SubjectPrefs", "repo.", "LaunchedEffect"]) {
      expect({ interdit, present: code(card).includes(interdit) }).toEqual({ interdit, present: false });
    }
    // Anatomie : colonne vertébrale de 6 dp, gouttière de 60 dp, fond pastel et
    // encre venue des helpers du thème.
    expect(card).toContain("SPINE_WIDTH = 6.dp");
    expect(card).toContain("TimetableTimeGutterWidth = 60.dp");
    expect(card).toContain("subjectSurface(colorHex)");
    expect(card).toContain("subjectContent(colorHex)");
    expect(card).toContain("cancelledSurface(error, dark)");
    expect(card).toContain("cancelledInk(error, dark)");
    // ZÉRO couleur en dur dans la carte : ni `Color(0x…)` ni `#RRGGBB`, donc
    // pas de couleur Material revenue par accident (cf. #134).
    const sansCommentaires = code(card);
    for (const interdit of [/Color\(0x/, /#[0-9a-fA-F]{6}/]) {
      expect({ interdit: String(interdit), trouve: sansCommentaires.match(interdit) }).toEqual({
        interdit: String(interdit),
        trouve: null,
      });
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
