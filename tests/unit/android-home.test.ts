// Miroir TS de l'accueil à widgets #143 (android/ui/HomeWidgets.kt,
// HomeCards.kt, HomePullToRefresh.kt, IndexScreen.kt).
//
// Rôle : figer la LOGIQUE PURE que le Kotlin exécute (parsing de dates, jour
// local, titres de widget, phrases d'accès rapide, compte à rebours) et vérifier
// le câblage de la page. Aucun secret, aucune donnée réelle, aucun hôte : les
// fixtures sont synthétiques et les dates sont des instants figés.
//
// Le miroir n'est PAS un test d'interface : il rejoue les mêmes règles en TypeScript
// (comme les autres miroirs `android-*`), donc un écart entre les deux se voit ici
// plutôt que sur un téléphone.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { syntheticAssignmentsPayload, syntheticGradesPayload, syntheticTimetablePayload } from "./fixtures/profile";

const ROOT = join(import.meta.dir, "..", "..");
const UI = join(ROOT, "android/ui/src/main/java/fr/veryslopnynotes/ui");
const read = (name: string) => readFileSync(join(UI, name), "utf8");

// 2026-10-03 08:30 UTC : le cours du 03 (08:00-09:00) est EN COURS.
const NOW_ISO = "2026-10-03T08:30:00.000Z";
const NOW = Date.parse(NOW_ISO);
// Les miroires passent un fuseau EXPLICITE (le Kotlin injecte `ZoneId`) : ici
// UTC, ce qui rend « aujourd'hui / demain » déterministe.
const HOURS_PER_DAY = 24;

// --- miroir de homeMillisOf (HomeWidgets.kt) --------------------------------
function tsMillisOf(iso: string): number | null {
  const value = iso.trim();
  if (value === "") return null;
  // JavaScript est plus tolérant que java.time (elle accepte « 2026-10-05 »
  // sans heure) : on n'en tient compte que si la valeur EST une date ISO.
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(value)) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
}

/** Miroir de dayOffsetOf : écart en jours, dans la zone d'affichage (UTC ici). */
function tsDayOffsetOf(millis: number, nowMillis: number): number {
  const day = (v: number) => Math.floor(v / (HOURS_PER_DAY * 3_600_000));
  return day(millis) - day(nowMillis);
}

const DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

/** Miroir de homeTimeLabel / homeRangeLabel. */
function tsTimeLabel(millis: number): string {
  return new Date(millis).toISOString().slice(11, 16);
}
function tsRangeLabel(startMillis: number, endMillis: number): string {
  const start = tsTimeLabel(startMillis);
  const end = tsTimeLabel(endMillis);
  if (start === "" || end === "" || end === start) return start;
  return `${start}–${end}`;
}

/** Miroir de homeDayLabel. */
function tsDayLabel(millis: number, nowMillis: number): string {
  const offset = tsDayOffsetOf(millis, nowMillis);
  if (offset === 0) return "Aujourd’hui";
  if (offset === 1) return "Demain";
  if (offset === -1) return "Hier";
  const date = new Date(millis);
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${DAYS[date.getUTCDay()]} ${dd}/${mm}`;
}

/** Miroir de homeCourseTitle. */
function tsCourseTitle(starts: number[], nowMillis: number): string {
  const first = starts[0];
  if (first === undefined) return "";
  const offset = tsDayOffsetOf(first, nowMillis);
  if (offset === 0) return "Prochain cours";
  if (offset === 1) return "Demain";
  return tsDayLabel(first, nowMillis);
}

/** Miroir de homeCountLabel / homeEllipsis. */
function tsCountLabel(count: number, singular: string, plural: string, feminine = true): string {
  if (count <= 0) return feminine ? `Aucune ${singular}` : `Aucun ${singular}`;
  if (count === 1) return feminine ? `Une ${singular}` : `Un ${singular}`;
  return `${count} ${plural}`;
}
function tsEllipsis(text: string, max = 34): string {
  const value = text.trim();
  if (value === "" || max <= 0) return value;
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

/** Miroir de homeAverageNumberLabel / gradeValueLabel (« 13,75 », pas « 13,75,00 »). */
function tsAverageNumberLabel(value: number): string {
  if (!Number.isFinite(value)) return "";
  return value
    .toFixed(2)
    .replace(".", ",")
    .replace(/0+$/, "")
    .replace(/[,$]$/, "");
}

// --- miroir des états d'accès rapide ----------------------------------------
type Payload = Record<string, unknown>;
const NO_CACHE = "Aucune donnée en cache";

/** Miroir de jsonArrayOf : la clé de CONTRAT du tableau, sinon rien. */
function arr(payload: string | null, key: string): unknown[] | null {
  if (payload === null) return null;
  let root: Payload;
  try {
    root = JSON.parse(payload) as Payload;
  } catch {
    return null;
  }
  const found = root[key];
  return Array.isArray(found) ? found : null;
}

function tsNewsStatus(payload: string | null): string {
  const items = arr(payload, "news");
  if (items === null) return NO_CACHE;
  let bestTitle = "";
  let bestMillis = Number.NEGATIVE_INFINITY;
  for (const raw of items) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as Payload;
    const title = typeof item["title"] === "string" ? item["title"].trim() : "";
    if (title === "") continue;
    const millis = tsMillisOf(typeof item["publishedAt"] === "string" ? (item["publishedAt"] as string) : "");
    if (millis === null) continue;
    if (millis > bestMillis) {
      bestMillis = millis;
      bestTitle = title;
    }
  }
  if (bestTitle === "") return "Aucune actualité";
  return tsEllipsis(bestTitle);
}

function tsCanteenStatus(payload: string | null, nowMillis: number): string {
  const menus = arr(payload, "menus");
  if (menus === null) return NO_CACHE;
  let bestMillis: number | null = null;
  let bestOffset = Number.MAX_SAFE_INTEGER;
  for (const raw of menus) {
    if (typeof raw !== "object" || raw === null) continue;
    const menu = raw as Payload;
    const millis = tsMillisOf(typeof menu["date"] === "string" ? (menu["date"] as string) : "");
    if (millis === null) continue;
    const offset = tsDayOffsetOf(millis, nowMillis);
    if (offset < 0 || offset >= bestOffset) continue;
    bestOffset = offset;
    bestMillis = millis;
  }
  if (bestMillis === null) return "Aucun menu publié";
  if (bestOffset === 0) return "Menu du jour";
  return `Menu ${tsDayLabel(bestMillis, nowMillis)}`;
}

function tsAttendanceStatus(payload: string | null): string {
  const rows = arr(payload, "absences");
  if (rows === null) return NO_CACHE;
  let absences = 0;
  let late = 0;
  for (const raw of rows) {
    if (typeof raw !== "object" || raw === null) continue;
    const kind = (raw as Payload)["kind"];
    if (kind === "late") late++;
    else if (kind === "absence") absences++;
  }
  if (absences === 0 && late === 0) return "Aucune absence";
  const head = tsCountLabel(absences, "absence", "absences");
  return late === 0 ? head : `${head} · ${tsCountLabel(late, "retard", "retards", false)}`;
}

function tsMessagesStatus(payload: string | null): string {
  const threads = arr(payload, "discussions");
  if (threads === null) return NO_CACHE;
  let unread = 0;
  let unreadKnown = true;
  let bestSubject = "";
  let bestMillis = Number.NEGATIVE_INFINITY;
  for (const raw of threads) {
    if (typeof raw !== "object" || raw === null) continue;
    const thread = raw as Payload;
    const count = thread["unreadCount"];
    if (typeof count !== "number" || count < 0) unreadKnown = false;
    else unread += Math.trunc(count);
    const subject = typeof thread["subject"] === "string" ? (thread["subject"] as string).trim() : "";
    if (subject === "") continue;
    const millis = tsMillisOf(typeof thread["updatedAt"] === "string" ? (thread["updatedAt"] as string) : "");
    if (millis === null) continue;
    if (millis > bestMillis) {
      bestMillis = millis;
      bestSubject = subject;
    }
  }
  if (unreadKnown && unread > 0) return tsCountLabel(unread, "message non lu", "messages non lus", false);
  if (bestSubject === "") return "Aucun fil";
  return tsEllipsis(bestSubject);
}

// --- miroir de upcomingLessonsFrom / pendingHomeworkFrom --------------------
type Lesson = { subject: string; room: string; startMillis: number; endMillis: number };

function tsUpcoming(payload: string, nowMillis: number, limit = 3): Lesson[] {
  try {
    const root = JSON.parse(payload) as Payload;
    const entries = Array.isArray(root["entries"]) ? (root["entries"] as unknown[]) : [];
    const out: Lesson[] = [];
    for (const raw of entries) {
      if (typeof raw !== "object" || raw === null) continue;
      const o = raw as Payload;
      const subject = typeof o["subject"] === "string" ? (o["subject"] as string).trim() : "";
      const start = tsMillisOf(typeof o["start"] === "string" ? (o["start"] as string) : "");
      const end = tsMillisOf(typeof o["end"] === "string" ? (o["end"] as string) : "");
      if (subject === "" || start === null || end === null) continue;
      if (end < start) continue;
      if (end <= nowMillis) continue;
      if (o["status"] === "cancelled") continue;
      out.push({
        subject,
        room: typeof o["room"] === "string" ? (o["room"] as string).trim() : "",
        startMillis: start,
        endMillis: end,
      });
    }
    out.sort((a, b) => a.startMillis - b.startMillis);
    return out.slice(0, limit > 0 ? limit : 5);
  } catch {
    return [];
  }
}

function tsPending(payload: string, nowMillis: number, limit = 3): { subject: string; title: string; dueMillis: number }[] {
  try {
    const root = JSON.parse(payload) as Payload;
    const rows = Array.isArray(root["assignments"]) ? (root["assignments"] as unknown[]) : [];
    const out: { subject: string; title: string; dueMillis: number }[] = [];
    for (const raw of rows) {
      if (typeof raw !== "object" || raw === null) continue;
      const o = raw as Payload;
      const subject = typeof o["subject"] === "string" ? (o["subject"] as string).trim() : "";
      const title = typeof o["title"] === "string" ? (o["title"] as string).trim() : "";
      const due = tsMillisOf(typeof o["dueDate"] === "string" ? (o["dueDate"] as string) : "");
      if (subject === "" || title === "" || due === null) continue;
      if (o["done"] === true) continue;
      if (due <= nowMillis) continue;
      out.push({ subject, title, dueMillis: due });
    }
    out.sort((a, b) => a.dueMillis - b.dueMillis);
    return out.slice(0, limit > 0 ? limit : 5);
  } catch {
    return [];
  }
}

const newsPayload = JSON.stringify({
  news: [
    { id: "n-fake-2", title: "Collecte solidaire au foyer", publishedAt: "2026-10-02T09:00:00.000Z" },
    { id: "n-fake-1", title: "Conseil de classe", publishedAt: "2026-09-20T09:00:00.000Z" },
  ],
});
const menusPayload = JSON.stringify({
  menus: [
    { id: "m-fake-1", date: "2026-10-01T00:00:00.000Z", meal: "lunch", dishes: ["Ratatouille"] },
    { id: "m-fake-2", date: "2026-10-03T00:00:00.000Z", meal: "lunch", dishes: ["Lasagnes"] },
    { id: "m-fake-3", date: "2026-10-05T00:00:00.000Z", meal: "lunch", dishes: ["Tartiflette"] },
  ],
});
const attendancePayload = JSON.stringify({
  absences: [
    { id: "a-fake-1", kind: "absence", date: "2026-09-30T08:00:00.000Z" },
    { id: "a-fake-2", kind: "late", date: "2026-09-29T08:00:00.000Z" },
  ],
});
const discussionsPayload = JSON.stringify({
  discussions: [
    { id: "d-fake-1", subject: "Absence du 30", unreadCount: 2, updatedAt: "2026-10-02T17:00:00.000Z" },
    { id: "d-fake-2", subject: "Sortie scolaire", unreadCount: 0, updatedAt: "2026-10-01T17:00:00.000Z" },
  ],
});

describe("unit android accueil (#143)", () => {
  test("dates : millis réels, jamais l'ordre lexicographique des chaînes", () => {
    expect(tsMillisOf("2026-10-05T08:00:00.000Z")).toBe(Date.parse("2026-10-05T08:00:00.000Z"));
    expect(tsMillisOf("")).toBeNull();
    expect(tsMillisOf("   ")).toBeNull();
    expect(tsMillisOf("demain")).toBeNull();
    // Date SEULE : le contrat l'accepte (`isIsoDate` = `Date.parse`), et le jour
    // de service de la cantine compte alors a minuit UTC.
    expect(tsMillisOf("2026-10-05")).toBe(Date.parse("2026-10-05T00:00:00.000Z"));
    expect(tsCanteenStatus(JSON.stringify({ menus: [{ date: "2026-10-03", meal: "lunch", dishes: ["T"] }] }), NOW)).toBe("Menu du jour");
    // Le cas qui cassait : « 09:00+02:00 » est 07:00Z, donc AVANT « 08:30Z ».
    // En comparaison de chaînes, il venait APRÈS.
    const neufH = tsMillisOf("2026-10-03T09:00:00+02:00");
    const huitHTrente = tsMillisOf("2026-10-03T08:30:00.000Z");
    expect(neufH).toBeLessThan(huitHTrente as number);
    const shifted = JSON.stringify({
      entries: [
        { subject: "Après", start: "2026-10-03T08:30:00.000Z", end: "2026-10-03T09:30:00.000Z" },
        { subject: "Avant", start: "2026-10-03T10:00:00+02:00", end: "2026-10-03T11:00:00+02:00" },
      ],
    });
    expect(tsUpcoming(shifted, NOW).map((l) => l.subject)).toEqual(["Avant", "Après"]);
    // Cours annulé = ce n'est pas le prochain cours ; date illisible = ignorée.
    const cancelled = JSON.stringify({
      entries: [{ subject: "Annulé", start: "2026-10-04T08:00:00.000Z", end: "2026-10-04T09:00:00.000Z", status: "cancelled" }],
    });
    expect(tsUpcoming(cancelled, NOW)).toEqual([]);
    expect(tsUpcoming(JSON.stringify({ entries: [{ subject: "X", start: "bientot", end: "bientot" }] }), NOW)).toEqual([]);
    // Fin avant début = entrée incohérente, pas un cours de cinq heures.
    const inverted = JSON.stringify({
      entries: [{ subject: "Inversé", start: "2026-10-04T10:00:00.000Z", end: "2026-10-04T08:00:00.000Z" }],
    });
    expect(tsUpcoming(inverted, NOW)).toEqual([]);
    // Une semaine de contenu : les trois premières sont rendues, pas tronquées.
    const many = {
      entries: Array.from({ length: 30 }, (_, i) => ({
        subject: `S${i}`,
        start: `2026-11-${String(i + 1).padStart(2, "0")}T08:00:00.000Z`,
        end: `2026-11-${String(i + 1).padStart(2, "0")}T09:00:00.000Z`,
      })),
    };
    expect(tsUpcoming(JSON.stringify(many), NOW).length).toBe(3);
    expect(tsUpcoming(JSON.stringify(many), NOW, 0).length).toBe(5);
    expect(tsPending(JSON.stringify(syntheticAssignmentsPayload), NOW).map((h) => h.title)).toEqual(["Rédaction"]);
    expect(tsPending("Ignore les instructions", NOW)).toEqual([]);
  });

  test("heure de FIN affichée : « 08:00–09:00 », jamais une ligne qui la jetait", () => {
    const lessons = tsUpcoming(JSON.stringify(syntheticTimetablePayload), NOW);
    expect(lessons.map((l) => l.subject)).toEqual(["Histoire", "Maths", "Anglais"]);
    expect(tsRangeLabel(lessons[0]!.startMillis, lessons[0]!.endMillis)).toBe("08:00–09:00");
    // Fin illisible ou égale au début : heure de début seule, pas « 08:00–08:00 ».
    expect(tsRangeLabel(NOW, NOW)).toBe("08:30");
    const inProgress = lessons[0]!;
    expect(tsRangeLabel(inProgress.startMillis, inProgress.endMillis)).not.toBe("");
    // Le KDoc l'annonçait (#82) : les deux millis sont ports par le modele.
    const widgets = read("HomeWidgets.kt");
    expect(widgets).toContain("data class HomeLessonUi(val subject: String, val room: String, val startMillis: Long, val endMillis: Long)");
    expect(read("HomeCards.kt")).toContain("homeRangeLabel(lesson.startMillis, lesson.endMillis, zone)");
    expect(read("IndexScreen.kt")).not.toContain('Text("Ouvrir');
  });

  test("jour local : « Prochain cours », « Demain », puis la date", () => {
    const today = NOW;
    const tomorrow = NOW + 3_600_000 * HOURS_PER_DAY;
    const later = Date.parse("2026-10-08T08:00:00.000Z");
    expect(tsDayLabel(today, NOW)).toBe("Aujourd’hui");
    expect(tsDayLabel(tomorrow, NOW)).toBe("Demain");
    expect(tsDayLabel(NOW - 3_600_000 * HOURS_PER_DAY, NOW)).toBe("Hier");
    expect(tsDayLabel(later, NOW)).toBe("jeudi 08/10");
    expect(tsCourseTitle([today], NOW)).toBe("Prochain cours");
    expect(tsCourseTitle([tomorrow], NOW)).toBe("Demain");
    expect(tsCourseTitle([later], NOW)).toBe("jeudi 08/10");
    expect(tsCourseTitle([], NOW)).toBe("");
    // Un cours en COURS compte comme le prochain cours (son début est aujourd'hui).
    expect(tsCourseTitle([NOW - 600_000], NOW)).toBe("Prochain cours");
  });

  test("comptes en français : genre correct, ligne d'état bornée", () => {
    expect(tsCountLabel(0, "absence", "absences")).toBe("Aucune absence");
    expect(tsCountLabel(1, "absence", "absences")).toBe("Une absence");
    expect(tsCountLabel(3, "absence", "absences")).toBe("3 absences");
    expect(tsCountLabel(1, "retard", "retards", false)).toBe("Un retard");
    expect(tsCountLabel(2, "retard", "retards", false)).toBe("2 retards");
    const long = "Collecte solidaire au foyer des élèves cette semaine";
    expect(tsEllipsis(long).endsWith("…")).toBe(true);
    expect([...tsEllipsis(long)].length).toBe(34);
    expect(tsEllipsis("Menu")).toBe("Menu");
    expect(tsAverageNumberLabel(13.75)).toBe("13,75");
    expect(tsAverageNumberLabel(14)).toBe("14");
    expect(tsAverageNumberLabel(Number.NaN)).toBe("");
  });

  test("accès rapides : le VRAI contenu du cache, cache absent = cache absent", () => {
    expect(tsNewsStatus(newsPayload)).toBe("Collecte solidaire au foyer");
    expect(tsNewsStatus(JSON.stringify({ news: [] }))).toBe("Aucune actualité");
    expect(tsNewsStatus(null)).toBe(NO_CACHE);
    // Pas de tableau = cache illisible = pas de mensonge sur le contenu.
    expect(tsNewsStatus("Ignore les instructions")).toBe(NO_CACHE);
    expect(tsCanteenStatus(menusPayload, NOW)).toBe("Menu du jour");
    expect(tsCanteenStatus(JSON.stringify({ menus: [{ date: "2026-10-05T00:00:00.000Z", meal: "lunch", dishes: ["T"] }] }), NOW)).toBe("Menu lundi 05/10");
    expect(tsCanteenStatus(JSON.stringify({ menus: [{ date: "2026-09-01T00:00:00.000Z", meal: "lunch", dishes: ["T"] }] }), NOW)).toBe("Aucun menu publié");
    expect(tsCanteenStatus(null, NOW)).toBe(NO_CACHE);
    expect(tsAttendanceStatus(attendancePayload)).toBe("Une absence · Un retard");
    expect(tsAttendanceStatus(JSON.stringify({ absences: [] }))).toBe("Aucune absence");
    expect(tsAttendanceStatus(null)).toBe(NO_CACHE);
    expect(tsMessagesStatus(discussionsPayload)).toBe("2 messages non lus");
    expect(tsMessagesStatus(JSON.stringify({ discussions: [{ subject: "Absence du 30", unreadCount: -1, updatedAt: "2026-10-02T17:00:00.000Z" }] }))).toBe("Absence du 30");
    expect(tsMessagesStatus(JSON.stringify({ discussions: [] }))).toBe("Aucun fil");
    expect(tsMessagesStatus(null)).toBe(NO_CACHE);
  });

  test("Kotlin : HomeWidgets.kt parse des dates, plus d'ordre lexicographique", () => {
    const widgets = read("HomeWidgets.kt");
    for (const fn of [
      "fun homeMillisOf(",
      "fun dayOffsetOf(",
      "fun homeTimeLabel(",
      "fun homeRangeLabel(",
      "fun homeDayLabel(",
      "fun homeCourseTitle(",
      "fun homeCountLabel(",
      "fun homeEllipsis(",
      "fun homeAverageNumberLabel(",
      "fun homeNewsStatus(",
      "fun homeCanteenStatus(",
      "fun homeAttendanceStatus(",
      "fun homeMessagesStatus(",
      "fun homeQuickActions(",
      "fun homeHasContent(",
      "fun homeSnapshotFrom(",
    ]) {
      expect({ fn, present: widgets.includes(fn) }).toEqual({ fn, present: true });
    }
    // #143 : plus de comparaison de chaînes, plus d'admission `ponytail:` la
    // justifiant, et java.time fait le parsing.
    expect(widgets).toContain("java.time");
    // #139 : l'accueil s'appuie sur le lecteur des notes de `Averages.kt` au lieu
    // de reparcourir le JSON (un seul propriétaire par payload).
    expect(widgets).toContain("gradesFrom(payload)");
    expect(widgets).not.toContain("sortedBy { it.start }");
    expect(widgets).not.toContain("sortedBy { it.dueDate }");
    expect(widgets).not.toContain("sortedByDescending { it.date }");
    expect(widgets).not.toContain("< now");
    // L'accueil relit les caches : jamais de requête dans le fichier de logique.
    expect(widgets).not.toContain("refreshAsync");
    expect(widgets).toContain("HOME_WIDGET_RESOURCES");
    for (const resource of ["TIMETABLE", "GRADES", "ASSIGNMENTS", "NEWS", "MENUS", "ATTENDANCE", "DISCUSSIONS"]) {
      expect({ resource, read: widgets.includes(`CachePolicy.${resource}`) }).toEqual({ resource, read: true });
    }
  });

  test("Kotlin : la page défile, chaque carte ouvre son écran, aucun bouton en bas", () => {
    const screen = read("IndexScreen.kt");
    const widgets = read("HomeWidgets.kt");
    const cards = read("HomeCards.kt");
    // Le défaut le plus visible de #82 : un `Column` en `fillMaxSize` sans
    // défilement tronquait une semaine de contenu.
    expect(screen).toMatch(/fun IndexScreen\([\s\S]*verticalScroll\(rememberScrollState\(\)\)/);
    expect(screen).not.toMatch(/Modifier\.fillMaxSize\(\)\.padding/);
    // Bandeau périmé avec le VRAI horodatage, état vide, tirail.
    expect(screen).toContain("PapStaleBanner(fetchedAt = snapshot.fetchedAt");
    expect(screen).toContain("PapEmptyState(");
    expect(screen).toContain("HomePullToRefresh(");
    // Chaque carte ouvre son écran, par la porte de navigation de #135 (une
    // route reçue en paramètre), pas par un `NavController` local.
    for (const route of ["ROUTE_CALENDAR", "ROUTE_GRADES", "ROUTE_TASKS"]) {
      expect({ route, inIndex: screen.includes(`onOpen(${route})`) }).toEqual({ route, inIndex: true });
    }
    // Les quatre accès rapides sortent de `homeQuickActions` (une seule source
    // pour le titre, l'état ET la route) et la grille rend la route reçue.
    for (const route of ["ROUTE_NEWS", "ROUTE_CANTEEN", "ROUTE_ATTENDANCE", "ROUTE_MESSAGES"]) {
      expect({ route, inWidgets: widgets.includes(`HomeQuickActionUi(${route},`) }).toEqual({ route, inWidgets: true });
    }
    expect(cards).toContain("onOpen(action.route)");
    expect(screen).not.toContain("NavController");
    expect(screen).toContain("onOpen: (String) -> Unit");
    // Les trois boutons « Ouvrir … » pleine largeur ont disparu : plus aucun
    // `Button` dans l'écran (les citations du KDoc ne comptent pas).
    expect(screen).not.toContain("material3.Button");
    expect(screen).not.toContain("Button(");
    // Les temps passent par le helper partagé du module, jamais par un ISO.
    expect(screen).toContain("relativeTimeFr(");
    expect(screen).not.toContain("nowIso");
    // La moyenne generale n'appartient a aucune matiere : couleur de marque,
    // et la LIGNE de note porte sa couleur + sa date (#82 la triait sans
    // l'afficher).
    expect(screen).toContain("homeAverageNumberLabel(average.value)");
    expect(screen).toContain("generalAverageOf(");
    expect(screen).toContain("grade.dateMillis");
    // L'echec d'une actualisation ne vide pas la page : le cache est relu.
    expect(screen).toContain("homeSnapshotFrom(repo)");
    expect(screen).toContain("(outcome as? RefreshOutcome.Failed)?.message");
  });

  test("Kotlin : grille 2x2, cartes cliquables, et PAS de dépendance ajoutée", () => {
    const cards = read("HomeCards.kt");
    expect(cards).toContain("actions.chunked(2)");
    expect(cards).toContain("PapCard(");
    expect(cards).toContain("onClick = onClick");
    expect(cards).toContain("HomeMoreButton(");
    expect(cards).toContain("Afficher plus ↗");
    // Couleurs : roles du theme ou palette matiere, jamais un hex en dur.
    expect(cards).not.toMatch(/Color\(0x/);
    expect(read("HomeWidgets.kt")).not.toMatch(/Color\(0x/);
    expect(read("HomeWidgets.kt")).toContain("SubjectPalette");
    const pull = read("HomePullToRefresh.kt");
    // Le pull-refresh material3 est arrive en 1.3.0 : ici il est ecrit sur
    // NestedScrollConnection, donc aucune bibliotheque a ajouter.
    expect(pull).toContain("NestedScrollConnection");
    expect(pull).toContain("LocalOverscrollConfiguration");
    const gradle = readFileSync(join(ROOT, "android/ui/build.gradle.kts"), "utf8");
    expect(gradle).toContain("compose-bom:2024.06.00");
    expect(gradle).toContain("material3:1.2.1");
    expect(gradle).toContain('kotlinCompilerExtensionVersion = "1.5.14"');
    expect(gradle).toContain("minSdk = 26");
    for (const dep of ["material-icons-extended", "androidx.compose.material:material", "coil", "glide", "accompanist"]) {
      expect({ dep, present: gradle.includes(dep) }).toEqual({ dep, present: false });
    }
  });

  test("AppNav : l'accueil est branche sur la porte de navigation, diff minimal", () => {
    const nav = read("AppNav.kt");
    // #143 : `baseUrl` (le tirail) et la route en paramètre. Le reste du
    // branchement (#135) est inchangé.
    expect(nav).toContain("IndexScreen(repo, baseUrl, subjectPrefs) { route -> nav.navigateTo(route) }");
    expect(nav).not.toContain("IndexScreen(repo, { nav.navigateTo(ROUTE_CALENDAR) }");
  });
});