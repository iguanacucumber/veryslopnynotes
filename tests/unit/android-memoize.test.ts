// Miroir de SOURCE de #312 : les parses JSON des écrans ne se rejouent plus à
// chaque recomposition.
//
// Ce n'est PAS un test d'interface (pas d'infra Compose ici) : c'est un
// garde-fou de TEXTE, comme les autres gardes de forme du dépôt. Il fige deux
// choses :
//   1. chaque dérivé d'écran qui parse un payload est dans un `remember(...)`
//      dont la CLÉ est celle de ce qu'il lit (payload, période, recherche,
//      minute pour l'âge du solde) — une clé incomplète figerait la valeur ;
//   2. les formes NON mémoïsées d'avant #312 (le parse par recomposition) ne
//      reviennent pas.
//
// Le comportement lui-même est figé par les miroirs `android-*` existants
// (HomeWidgets/Averages/EDT/cantine/devoirs/vie scolaire/discussions), qui n'ont
// pas bougé d'une ligne : c'est eux qui prouvent que la mémoïsation n'a rien
// changé à l'affichage.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";

const ROOT = join(import.meta.dir, "..", "..");
const UI = join(ROOT, "android/ui/src/main/java/fr/veryslopnynotes/ui");
const read = (name: string) => readFileSync(join(UI, name), "utf8");

/**
 * Un dérivé mémoïsé : le fichier, et l'expression qui doit se lire DANS le
 * `remember(...)` — la clé attendue est écrite dans le motif, donc un `remember`
 * dont la clé ne couvre pas l'entrée du calcul échoue ici.
 */
const MEMOIZED: Array<{ file: string; pattern: RegExp }> = [
  // Notes : les deux parses du payload, puis les étages qui ne lisent que des
  // listes déjà analysées (la frappe dans la recherche ne rejoue plus le JSON).
  { file: "GradesScreen.kt", pattern: /remember\(payload\)[^\n]*averagesFrom\(it\)/ },
  { file: "GradesScreen.kt", pattern: /remember\(payload\)[^\n]*gradesFrom\(payload\)/ },
  { file: "GradesScreen.kt", pattern: /remember\(allGrades, periodId\)[^\n]*gradesForPeriod\(allGrades, periodId\)/ },
  { file: "GradesScreen.kt", pattern: /remember\(grades, query\)[^\n]*gradeMatches\(it, query\)/ },
  { file: "GradesScreen.kt", pattern: /remember\(filtered, subjects, query\)[\s\S]{0,80}?gradeGroups\(filtered, subjects \?: emptyList\(\)\)/ },
  { file: "GradesScreen.kt", pattern: /remember\(filtered\)[^\n]*recentGrades\(filtered\)/ },
  // EDT : le modèle ne dépend plus que du payload et de la zone (le tick d'une
  // minute ne rejoue plus le JSON de la semaine).
  { file: "TimetableWeek.kt", pattern: /remember\(payload, zone\)[^\n]*timetableWeekFrom\(it, zone\)/ },
  // Accueil : un `remember` par payload, plus la carte de pastilles.
  { file: "IndexScreen.kt", pattern: /remember\(snapshot\.timetable\)[\s\S]{0,60}?upcomingLessons\(it\)/ },
  { file: "IndexScreen.kt", pattern: /remember\(snapshot\.assignments\)[\s\S]{0,60}?pendingHomework\(it\)/ },
  { file: "IndexScreen.kt", pattern: /remember\(snapshot\.grades\)[^\n]*latestGradesFrom\(it, limit = 1\)/ },
  { file: "IndexScreen.kt", pattern: /remember\(snapshot\.grades\)[^\n]*averagesFrom\(it\)/ },
  // La clé d'`homeQuickActions` est le JOUR local, pas `nowMillis` : la seule
  // ligne d'horloge (Cantine) compare des dates, donc un tic de minute ne doit
  // PAS rejouer les quatre parses.
  { file: "IndexScreen.kt", pattern: /remember\(\s*snapshot\.news,\s*snapshot\.menus,\s*snapshot\.attendance,\s*snapshot\.discussions,\s*dayKey\(nowMillis, zone\),\s*zone,\s*\)[\s\S]{0,80}?homeQuickActions\(/ },
  { file: "IndexScreen.kt", pattern: /remember\(snapshot\.news, snapshot\.menus, snapshot\.attendance, snapshot\.discussions\)[\s\S]{0,120}?\.count \{ it != null \}/ },
  { file: "IndexScreen.kt", pattern: /remember\(snapshot\.discussions, snapshot\.attendance\)[\s\S]{0,80}?messagesUnreadBadge\(snapshot\.discussions\)/ },
  // Devoirs : le parse, l'état optimiste, le filtre matière/recherche et le
  // second lecteur du payload (la liste des matières du filtre).
  { file: "Assignments.kt", pattern: /remember\(payload\)[^\n]*assignmentsFromPayload\(payload\)/ },
  { file: "Assignments.kt", pattern: /remember\(list, pending\)[\s\S]{0,120}?copy\(done = done\)/ },
  { file: "Assignments.kt", pattern: /remember\(optimistic, selectedSubject, query\)[\s\S]{0,120}?filterAssignments\(optimistic, selectedSubject, query\)/ },
  { file: "Assignments.kt", pattern: /remember\(payload\)[^\n]*subjectsFromPayload\(it\)/ },
  { file: "Assignments.kt", pattern: /remember\(visible, nowMillis, zone\)[\s\S]{0,80}?assignmentSections\(visible, nowMillis, zone\)/ },
  // Vie scolaire et cantine : un parse par payload. La cantine garde en plus la
  // MINUTE dans sa clé, parce que l'âge du solde est une information d'horloge.
  { file: "Attendance.kt", pattern: /remember\(payload\)[^\n]*attendanceFrom\(payload\)/ },
  { file: "Attendance.kt", pattern: /remember\(data, periodId\)[^\n]*absencesForPeriod\(data, periodId\)/ },
  { file: "Attendance.kt", pattern: /remember\(rows\)[^\n]*attendanceSections\(rows\)/ },
  { file: "Attendance.kt", pattern: /remember\(rows\)[^\n]*attendanceStatus\(rows\)/ },
  { file: "CanteenMenus.kt", pattern: /remember\(payload, nowMillis \/ MINUTE_MS, zone\)[\s\S]{0,60}?canteenWeekFrom\(it, nowMillis, zone\)/ },
  // Actualités (état « lu » de session) et grille d'accès rapides de l'accueil.
  { file: "NewsScreen.kt", pattern: /remember\(news, readIds\)[\s\S]{0,120}?copy\(read = true\)/ },
  { file: "MessagesScreen.kt", pattern: /remember\(discussions, query\)[^\n]*searchConversations\(discussions, query\)/ },
  { file: "MessagesScreen.kt", pattern: /remember\(discussions\)[^\n]*unreadTotal\(discussions\)/ },
  { file: "HomeCards.kt", pattern: /remember\(actions\)[^\n]*actions\.chunked\(2\)/ },
];

/** Parse d'écran d'un fichier donné : appel qui doit vivre dans un bloc mémoïsé. */
const SCREEN_PARSES: Array<{ file: string; call: string }> = [
  { file: "GradesScreen.kt", call: "averagesFrom(" },
  { file: "GradesScreen.kt", call: "gradesFrom(" },
  { file: "TimetableWeek.kt", call: "timetableWeekFrom(" },
  { file: "Attendance.kt", call: "attendanceFrom(" },
  { file: "CanteenMenus.kt", call: "canteenWeekFrom(" },
  { file: "Assignments.kt", call: "assignmentsFromPayload(" },
  { file: "Assignments.kt", call: "subjectsFromPayload(" },
  { file: "IndexScreen.kt", call: "averagesFrom(" },
  { file: "IndexScreen.kt", call: "latestGradesFrom(" },
  { file: "IndexScreen.kt", call: "upcomingLessons(" },
  { file: "IndexScreen.kt", call: "pendingHomework(" },
  { file: "IndexScreen.kt", call: "messagesUnreadBadge(" },
  { file: "IndexScreen.kt", call: "attendanceTotalBadge(" },
];

/** Les lignes d'avant #312 : le parse rejoué à chaque recomposition. */
const GONE: Array<{ file: string; old: string }> = [
  { file: "GradesScreen.kt", old: "val report = payload?.let { averagesFrom(it) }" },
  { file: "GradesScreen.kt", old: "val grades = gradesForPeriod(gradesFrom(payload), periodId)" },
  { file: "GradesScreen.kt", old: "val recent = recentGrades(filtered)" },
  { file: "TimetableWeek.kt", old: "timetableWeekFrom(it, zone, nowMillis)" },
  { file: "IndexScreen.kt", old: "upcomingLessonsFrom(it, nowMillis" },
  { file: "IndexScreen.kt", old: "pendingHomeworkFrom(it, nowMillis" },
  { file: "IndexScreen.kt", old: "val badges = mapOf(" },
  { file: "Assignments.kt", old: "val list = assignmentsFromPayload(payload)" },
  { file: "Assignments.kt", old: "subjects = payload?.let { subjectsFromPayload(it) }" },
  { file: "Attendance.kt", old: "val data = attendanceFrom(payload)" },
  { file: "CanteenMenus.kt", old: "val week = payload?.let { canteenWeekFrom(it) }" },
  { file: "NewsScreen.kt", old: "val shown = news.map {" },
  { file: "MessagesScreen.kt", old: "val visible = searchConversations(discussions, query)" },
  { file: "MessagesScreen.kt", old: "val unread = unreadTotal(discussions)" },
  { file: "HomeCards.kt", old: "for (row in actions.chunked(2))" },
];

/** Corps d'une fonction, à partir de son en-tête jusqu'à la fonction suivante. */
function bodyOf(source: string, head: string): string {
  const start = source.indexOf(head);
  expect({ head, found: start >= 0 }).toEqual({ head, found: true });
  const end = source.indexOf("\nfun ", start + head.length);
  return source.slice(start, end < 0 ? undefined : end);
}

describe("unit android mémoïsation des parses (#312)", () => {
  for (const { file, pattern } of MEMOIZED) {
    test(`${file} : ${pattern.source.slice(0, 46)}…`, () => {
      expect({ file, memoized: pattern.test(read(file)) }).toEqual({ file, memoized: true });
    });
  }

  test("Kotlin : tout parse d'écran vit dans un bloc qui contient un `remember(`", () => {
    for (const { file, call } of SCREEN_PARSES) {
      const src = codeOnly(read(file));
      // L'appel, jamais la DÉFINITION de la fonction (`fun nom(`).
      const re = new RegExp(`(?<!fun )${call.replace("(", "\\(")}`, "g");
      for (const match of src.matchAll(re)) {
        const at = match.index ?? 0;
        // Bloc = lignes consécutives non vides autour de l'appel : c'est là que
        // le `remember` doit se trouver, sur la ligne du `val` ou dans son corps.
        const start = src.lastIndexOf("\n\n", at) + 2;
        const block = src.slice(start, at);
        expect({ file, call, memoized: block.includes("remember(") }).toEqual({
          file,
          call,
          memoized: true,
        });
      }
    }
  });

  test("Kotlin : les formes non mémoïsées d'avant #312 ne sont pas revenues", () => {
    for (const { file, old } of GONE) {
      expect({ file, old, present: codeOnly(read(file)).includes(old) }).toEqual({
        file,
        old,
        present: false,
      });
    }
  });

  test("HomeWidgets : l'analyse et l'horloge sont deux fonctions distinctes", () => {
    const widgets = read("HomeWidgets.kt");
    // L'étage d'HORLOGE ne touche aucun JSON : c'est ce qui permet de le rejouer
    // à chaque tic sur une liste déjà analysée.
    const clock = bodyOf(widgets, "fun upcomingLessonsFrom(\n    lessons:") +
      bodyOf(widgets, "fun pendingHomeworkFrom(\n    homework:");
    expect(clock).not.toContain("JSONObject");
    expect(clock).not.toContain("JSONArray");
    expect(clock).toContain("it.endMillis > nowMillis");
    expect(clock).toContain("it.dueMillis > nowMillis");
    // L'étage d'ANALYSE, lui, ne connaît pas l'heure : la liste des accueils
    // passée à `remember(payload)` ne peut pas se figer sur un `now`.
    const parse = bodyOf(widgets, "fun upcomingLessons(payload: String)") +
      bodyOf(widgets, "fun pendingHomework(payload: String)");
    expect(parse).not.toContain("nowMillis");
    // Ce qui reste DANS l'analyse : les règles du payload (cours annulé écarté,
    // devoir déjà fait écarté), donc rien qui doive vieillir avec l'horloge.
    expect(parse).toContain("HOME_STATUS_CANCELLED");
    expect(parse).toContain('optBoolean("done", false)');
  });

  test("EDT : le modèle de semaine n'a plus de champ d'horloge", () => {
    const src = read("TimetableWeek.kt");
    // `next` a quitté `TimetableWeekUi` : sans ça, le parse devrait être rejoué
    // à chaque tick pour rafraîchir le prochain cours.
    expect(src).not.toContain("val next: TimetableLessonUi?");
    expect(src).toMatch(/fun timetableWeekFrom\(\s*payload: String,\s*zone: ZoneId = ZoneId\.systemDefault\(\),\s*\)/);
    // Le drapeau est recalculé sur la liste DÉJÀ analysée.
    expect(src).toContain("nextLessonOf(it.lessons, nowMillis)");
  });

  test("Accueil : les deux étages sont appelés sur la liste analysée", () => {
    const src = read("IndexScreen.kt");
    expect(src).toContain("upcomingLessonsFrom(lessons, nowMillis, limit = 1)");
    expect(src).toContain("pendingHomeworkFrom(homework, nowMillis, limit = 2)");
  });
});
