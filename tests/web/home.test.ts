import { useParisTz } from "./setup";

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isoDay, startOfWeek } from "../../web/src/lib/format";
import {
  ENTRANCE_WINDOW_MS,
  MAX_ITEMS,
  alertCountLabel,
  clockLabel,
  countdownFr,
  courseCountdown,
  courseWidgetTitle,
  dueLabel,
  durationLabel,
  formatAverage,
  formatGrade,
  generalAverage,
  latestGrades,
  movedHint,
  parseAlerts,
  parseAssignments,
  parseCapabilities,
  parseGrades,
  parseTimetable,
  pendingAssignments,
  pendingCount,
  shouldAnimateOnMount,
  subjectAverage,
  tabVisible,
  timeRange,
  upcomingCount,
  upcomingLessons,
  type Grade,
} from "../../web/src/features/home/parse";
import {
  currentLesson,
  groupDays,
  highlightOf,
  lessonsInWeek,
  nextLesson,
  shortDay,
  weekLabel,
  weekQuery,
  weekStartFrom,
} from "../../web/src/features/timetable/week";

useParisTz();

// Dates construites en LOCAL : les tests ne dépendent pas du fuseau de la CI.
const local = (day: number, hour = 8, minute = 0): string =>
  new Date(2026, 9, day, hour, minute).toISOString();

function grade(partial: Partial<Grade> & Pick<Grade, "subject" | "value" | "scale">): Grade {
  return {
    id: partial.id ?? `${partial.subject}-${partial.value}`,
    subject: partial.subject,
    value: partial.value,
    scale: partial.scale,
    coefficient: partial.coefficient ?? null,
    date: partial.date ?? new Date(2026, 9, 12, 8).getTime(),
    dateIso: partial.dateIso ?? local(12, 8),
    bonus: partial.bonus ?? false,
    optional: partial.optional ?? false,
  };
}

describe("parseTimetable", () => {
  const payload = JSON.stringify({
    entries: [
      {
        id: "a",
        subject: "MATHEMATIQUES",
        start: local(19, 8),
        end: local(19, 9),
        room: "B14",
        teacher: "Mme X",
      },
      { id: "b", subject: "", start: local(19, 9), end: local(19, 10) },
      { id: "c", subject: "NSI", start: local(19, 10), end: local(19, 9) },
      { id: "d", subject: "HG", start: "pas une date", end: local(19, 11) },
      {
        id: "e",
        subject: "ANGLAIS",
        start: local(19, 11),
        end: local(19, 12),
        status: "cancelled",
      },
      {
        id: "f",
        subject: "PHILOSOPHIE",
        start: local(19, 14),
        end: local(19, 16),
        status: "inconnu",
      },
    ],
  });

  test("garde les cours lisibles et écarte les lignes incomplètes", () => {
    const lessons = parseTimetable(payload);
    expect(lessons.map((lesson) => lesson.id)).toEqual(["a", "e", "f"]);
    expect(lessons[0]?.room).toBe("B14");
    expect(lessons[0]?.teacher).toBe("Mme X");
    expect(lessons[1]?.status).toBe("cancelled");
    expect(lessons[2]?.status).toBeNull();
  });

  test("les cours annulés ne sont jamais « à venir »", () => {
    const lessons = parseTimetable(payload);
    const upcoming = upcomingLessons(lessons, new Date(2026, 9, 19, 7).getTime(), 10);
    expect(upcoming.map((lesson) => lesson.id)).toEqual(["a", "f"]);
  });

  test("accepte l'enveloppe `items` du pont factice", () => {
    const wrapped = JSON.stringify({
      __untrusted: true,
      items: [{ id: "w", subject: "NSI", start: local(20, 8), end: local(20, 10) }],
    });
    expect(parseTimetable(wrapped)).toHaveLength(1);
  });

  test("titre du widget cours : jour courant, demain, date", () => {
    const lesson = parseTimetable(payload)[0]!;
    const now = new Date(2026, 9, 19, 9).getTime();
    expect(courseWidgetTitle(lesson, now)).toBe("Aujourd’hui");
    expect(courseWidgetTitle({ ...lesson, start: new Date(2026, 9, 20, 8).getTime() }, now)).toBe("Demain");
    expect(courseWidgetTitle({ ...lesson, start: new Date(2026, 9, 22, 8).getTime() }, now)).toContain("22");
  });

  test("borne la liste et nettoie les caractères de contrôle", () => {
    const entries = Array.from({ length: MAX_ITEMS + 5 }, (_, index) => ({
      id: `i-${index}`,
      subject: "<script>\u0000alert</script>",
      start: local(19, 8, index % 60),
      end: local(19, 9, index % 60),
    }));
    const lessons = parseTimetable(JSON.stringify({ entries }));
    expect(lessons).toHaveLength(MAX_ITEMS);
    expect(lessons[0]?.subject).not.toContain("\u0000");
    // Le HTML reste une DONNÉE : React l'échappe, on ne le filtre pas en texte.
    expect(lessons[0]?.subject).toContain("<script>");
  });

  test("payload absent ou illisible = aucun cours", () => {
    expect(parseTimetable(null)).toEqual([]);
    expect(parseTimetable("{")).toEqual([]);
    expect(parseTimetable(JSON.stringify({ entries: "nope" }))).toEqual([]);
  });

  test("un cours déplacé garde son statut et son horaire d'origine", () => {
    const moved = parseTimetable(
      JSON.stringify({
        entries: [
          {
            id: "m",
            subject: "MATHS",
            start: local(21, 13),
            end: local(21, 15),
            status: "moved",
            originalStart: local(21, 8),
          },
        ],
      }),
    )[0];
    expect(moved?.status).toBe("moved");
    expect(moved ? movedHint(moved) : "").toBe("départ 08:00");
  });

  test("affiche début et fin, et une durée française", () => {
    const lesson = parseTimetable(payload)[0];
    expect(lesson).toBeDefined();
    if (!lesson) return;
    const range = timeRange(lesson);
    expect(range).toContain(clockLabel(lesson.start));
    expect(range).toContain(clockLabel(lesson.end));
    expect(durationLabel(lesson.end - lesson.start)).toBe("1h");
  });

  // #570 : le même cours publié deux fois (même identifiant) n'est affiché
  // qu'une fois.
  test("un cours publié deux fois n'est affiché qu'une fois (#570)", () => {
    const twice = JSON.stringify({
      entries: [
        { id: "a", subject: "MATHEMATIQUES", start: local(19, 8), end: local(19, 9) },
        { id: "a", subject: "MATHEMATIQUES", start: local(19, 8), end: local(19, 9) },
      ],
    });
    expect(parseTimetable(twice).map((lesson) => lesson.id)).toEqual(["a"]);
  });

  // Deux cours RÉELS distincts ne sont jamais confondus, même s'ils se
  // ressemblent (la déduplication est par identifiant, pas par matière).
  test("deux cours distincts ne sont jamais confondus (#570)", () => {
    const alike = JSON.stringify({
      entries: [
        { id: "a", subject: "MATHEMATIQUES", start: local(19, 8), end: local(19, 9) },
        { id: "b", subject: "MATHEMATIQUES", start: local(19, 8), end: local(19, 9) },
      ],
    });
    expect(parseTimetable(alike).map((lesson) => lesson.id)).toEqual(["a", "b"]);
  });
});

describe("devoirs", () => {
  const now = new Date(2026, 9, 19, 12).getTime();
  const payload = JSON.stringify({
    assignments: [
      { id: "1", subject: "MATHS", title: "Exercices 12 à 18", dueDate: local(20, 20), done: false },
      { id: "2", subject: "NSI", title: "TP base de données", dueDate: local(21, 20), done: true },
      { id: "3", subject: "HG", title: "Sans échéance", dueDate: "demain" },
      { id: "4", subject: "ANGLAIS", title: "Déjà passé", dueDate: local(18, 20), done: false },
    ],
  });

  test("écarte les échéances illisibles, garde les faits", () => {
    const tasks = parseAssignments(payload);
    expect(tasks.map((task) => task.id)).toEqual(["4", "1", "2"]);
  });

  test("ne retient que les devoirs non faits et à venir", () => {
    const pending = pendingAssignments(parseAssignments(payload), now, 5);
    expect(pending.map((task) => task.id)).toEqual(["1"]);
    expect(dueLabel(pending[0]!.due, now)).toBe("demain 20:00");
  });

  // #570 : le même devoir publié deux fois (même identifiant) n'est affiché
  // qu'une fois.
  test("un devoir publié deux fois n'est affiché qu'une fois (#570)", () => {
    const twice = JSON.stringify({
      assignments: [
        { id: "1", subject: "MATHS", title: "Exercices 12 à 18", dueDate: local(20, 20) },
        { id: "1", subject: "MATHS", title: "Exercices 12 à 18", dueDate: local(20, 20) },
      ],
    });
    expect(parseAssignments(twice).map((task) => task.id)).toEqual(["1"]);
  });

  // La déduplication est par IDENTIFIANT : deux devoirs RÉELS qui se
  // ressemblent (matière, titre, échéance) ne sont jamais confondus.
  test("deux devoirs distincts ne sont jamais confondus (#570)", () => {
    const alike = JSON.stringify({
      assignments: [
        { id: "1", subject: "MATHS", title: "Exercices", dueDate: local(20, 20) },
        { id: "2", subject: "MATHS", title: "Exercices", dueDate: local(20, 20) },
      ],
    });
    expect(parseAssignments(alike).map((task) => task.id)).toEqual(["1", "2"]);
  });
});

describe("compteurs de l'accueil (#571)", () => {
  const now = new Date(2026, 9, 19, 12).getTime();

  // 5 devoirs : 1 fait, 2 en retard, 2 à venir.
  const cinqDevoirs = JSON.stringify({
    assignments: [
      { id: "fait", subject: "MATHS", title: "Factors", dueDate: local(19, 8), done: true },
      { id: "retard-1", subject: "NSI", title: "Exercice 4", dueDate: local(17, 20), done: false },
      { id: "retard-2", subject: "HG", title: "Fiche 2", dueDate: local(18, 20), done: false },
      { id: "avenir-1", subject: "ANGLAIS", title: "Traduction", dueDate: local(20, 20), done: false },
      { id: "avenir-2", subject: "PHILO", title: "Résumé", dueDate: local(21, 20), done: false },
    ],
  });

  test("« À faire » compte les devoirs en retard, sans plafond", () => {
    const assignments = parseAssignments(cinqDevoirs);
    // 4 à faire : les 2 en retard comptent, le devoir fait non.
    expect(pendingCount(assignments)).toBe(4);
    // La LISTE du widget reste bornée à deux : c'est un extrait, pas le compte.
    expect(pendingAssignments(assignments, now, 2)).toHaveLength(2);
  });

  test("« À faire » : aucun devoir = 0, tous faits = 0", () => {
    expect(pendingCount(parseAssignments(JSON.stringify({ assignments: [] })))).toBe(0);
    const tousFaits = parseAssignments(
      JSON.stringify({
        assignments: [
          { id: "a", subject: "MATHS", title: "Fait", dueDate: local(19, 8), done: true },
          { id: "b", subject: "NSI", title: "Fait aussi", dueDate: local(18, 8), done: true },
        ],
      }),
    );
    expect(pendingCount(tousFaits)).toBe(0);
  });

  test("« À venir » compte tous les cours à venir, annulés et terminés exclus", () => {
    const lessons = parseTimetable(
      JSON.stringify({
        entries: [
          { id: "c1", subject: "MATHS", start: local(19, 14), end: local(19, 15) },
          { id: "c2", subject: "NSI", start: local(19, 15), end: local(19, 16) },
          { id: "c3", subject: "HG", start: local(20, 8), end: local(20, 9) },
          { id: "c4", subject: "ANGLAIS", start: local(20, 9), end: local(20, 10) },
          { id: "c5", subject: "PHILO", start: local(20, 10), end: local(20, 11) },
          {
            id: "annule",
            subject: "EPS",
            start: local(20, 11),
            end: local(20, 12),
            status: "cancelled",
          },
          { id: "termine", subject: "SVT", start: local(18, 8), end: local(18, 9) },
        ],
      }),
    );
    expect(upcomingCount(lessons, now)).toBe(5);
    // La LISTE du widget reste bornée à deux.
    expect(upcomingLessons(lessons, now, 2)).toHaveLength(2);
  });

  test("« À venir » : aucun cours = 0", () => {
    expect(upcomingCount(parseTimetable(null), now)).toBe(0);
  });

  test("la carte d'accueil affiche les compteurs, pas la longueur des listes bornées", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "..", "web", "src", "features", "home", "HomeScreen.tsx"),
      "utf8",
    );
    // Les compteurs sont calculés sur TOUTES les données…
    expect(source).toContain("pendingCount(assignments)");
    expect(source).toContain("upcomingCount(lessons, now)");
    // …et la carte les affiche tels quels : plus jamais la longueur d'une
    // liste BORNÉE à deux.
    const debut = source.indexOf('className="home-hero__stats"');
    expect(debut).toBeGreaterThan(-1);
    const stats = source.slice(debut, source.indexOf("</Card>", debut));
    expect(stats).toContain("tasksTotal");
    expect(stats).toContain("upcomingTotal");
    expect(stats).not.toContain(".length");
  });
});

describe("notes et moyennes", () => {
  test("la moyenne fournie par l'établissement gagne", () => {
    const payload = JSON.stringify({
      averages: { general: { value: 13.75, origin: "provided", subjectCount: 3 } },
      grades: [
        { id: "1", subject: "MATHS", value: 10, scale: 20, date: local(12, 8) },
      ],
    });
    const report = generalAverage(payload);
    expect(report.value).toBe(13.75);
    expect(report.provided).toBe(true);
  });

  test("calcule la moyenne des matières quand elle n'est pas fournie", () => {
    const grades: Grade[] = [
      grade({ subject: "MATHS", value: 10, scale: 20 }),
      grade({ subject: "MATHS", value: 20, scale: 20, id: "m2" }),
      grade({ subject: "NSI", value: 5, scale: 10 }),
      grade({ subject: "HG", value: 1, scale: 20, coefficient: 0 }),
      grade({ subject: "ANGLAIS", value: 10, scale: 20 }),
      grade({ subject: "ANGLAIS", value: 20, scale: 20, optional: true }),
      grade({ subject: "PHILO", value: 16, scale: 20, bonus: true }),
    ];
    const report = generalAverage(null, grades);
    // maths 15, NSI 10, anglais 15 (facultative retenue), philo 20 (bonus).
    expect(report.value).toBeCloseTo(15, 5);
    expect(report.provided).toBe(false);
    expect(report.subjectCount).toBe(4);
  });

  test("une facultative qui baisse la moyenne est ignorée", () => {
    expect(
      subjectAverage([
        grade({ subject: "MATHS", value: 15, scale: 20 }),
        grade({ subject: "MATHS", value: 5, scale: 20, optional: true }),
      ]),
    ).toBe(15);
  });

  test("sans note exploitable, aucune moyenne (jamais 0 inventé)", () => {
    expect(generalAverage(null, [grade({ subject: "MATHS", value: 8, scale: 20, coefficient: 0 })]).value).toBeNull();
    expect(generalAverage(null, [grade({ subject: "MATHS", value: 8, scale: 20, coefficient: -2 })]).value).toBeNull();
  });

  test("formate les nombres à la française, sans zéros inutiles", () => {
    expect(formatAverage(14)).toBe("14");
    expect(formatAverage(14.3)).toBe("14,3");
    expect(formatAverage(14.35)).toBe("14,35");
    expect(formatGrade(15.5, 20)).toBe("15,5/20");
    expect(formatGrade(5, 10)).toBe("10/20");
  });

  test("les dernières notes sont triées par date et bornées", () => {
    const grades = parseGrades(
      JSON.stringify({
        grades: [
          { id: "a", subject: "MATHS", value: 12, scale: 20, date: local(10, 8) },
          { id: "b", subject: "NSI", value: 18, scale: 20, date: local(14, 8) },
          { id: "c", subject: "HG", value: 15.5, scale: 20, date: local(12, 8) },
        ],
      }),
    );
    const latest = latestGrades(grades, 2);
    expect(latest.map((item) => item.id)).toEqual(["b", "c"]);
    expect(latest[1]?.label).toBe("15,5/20");
  });
});

describe("alertes et capacités", () => {
  test("compte les alertes du contrat et du pont factice", () => {
    expect(
      parseAlerts(
        JSON.stringify({
          alerts: [
            { id: "a", kind: "instruction", excerpt: "extrait", source: "news" },
            { id: "b", kind: "instruction", excerpt: "extrait", source: "canteen" },
            "ligne invalide",
          ],
        }),
      ),
    ).toHaveLength(2);
    expect(parseAlerts(JSON.stringify({ items: [{ id: "x" }] }))).toHaveLength(1);
    expect(alertCountLabel(0)).toBe("Aucune alerte");
    expect(alertCountLabel(1)).toBe("1 alerte");
    expect(alertCountLabel(3)).toBe("3 alertes");
  });

  test("capacités connues = onglets servis ; absent/inconnu = tout visible", () => {
    const tabs = parseCapabilities(
      JSON.stringify({ capabilities: { tabs: ["grades", "news", "news", ""] } }),
    );
    expect(tabs).toEqual(["grades", "news"]);
    expect(tabVisible(tabs, "grades")).toBe(true);
    expect(tabVisible(tabs, "timetable")).toBe(false);
    expect(parseCapabilities(JSON.stringify({ items: { tabs: ["menus"] } }))).toEqual(["menus"]);
    expect(parseCapabilities(JSON.stringify({ capabilities: {} }))).toBeNull();
    expect(parseCapabilities(null)).toBeNull();
    expect(tabVisible(null, "timetable")).toBe(true);
  });

  // #413 : un contrat de capabilities INVALIDE est publié par le natif comme
  // `capabilities: null` (« rien n'est affirmé »). Le web doit le lire comme
  // l'INCONNU : tous les onglets restent accessibles. Le confondre avec une
  // liste VIDE (qui dit « tous les onglets désactivés ») blackouterait
  // l'accueil sur une panne.
  test("contrat invalide (publié `capabilities: null`) = inconnu, navigation intacte", () => {
    const inconnu = parseCapabilities(JSON.stringify({ capabilities: null }));
    expect(inconnu).toBeNull();
    for (const tab of ["grades", "homework", "timetable", "news", "menus"]) {
      expect(tabVisible(inconnu, tab)).toBe(true);
    }
    // La liste VIDE, elle, reste une affirmation : tout est désactivé.
    const vide = parseCapabilities(JSON.stringify({ capabilities: { tabs: [] } }));
    expect(vide).toEqual([]);
    expect(tabVisible(vide, "grades")).toBe(false);
  });
});

describe("entrée des widgets de l'accueil (#569)", () => {
  const opened = new Date(2026, 9, 21, 8).getTime();

  test("monté avec l'écran : l'entrée se joue", () => {
    expect(shouldAnimateOnMount(opened, opened)).toBe(true);
  });

  test("monté 2 s plus tard : aucune entrée (pas de surgissement tardif)", () => {
    expect(shouldAnimateOnMount(opened, opened + 2_000)).toBe(false);
  });

  test("la fenêtre de fraîcheur est courte, et la borne est incluse", () => {
    expect(ENTRANCE_WINDOW_MS).toBeLessThanOrEqual(500);
    expect(shouldAnimateOnMount(opened, opened + ENTRANCE_WINDOW_MS)).toBe(true);
    expect(shouldAnimateOnMount(opened, opened + ENTRANCE_WINDOW_MS + 1)).toBe(false);
  });

  test("une horloge illisible n'anime jamais", () => {
    expect(shouldAnimateOnMount(Number.NaN, opened)).toBe(false);
    expect(shouldAnimateOnMount(opened, Number.NaN)).toBe(false);
    expect(shouldAnimateOnMount(Number.POSITIVE_INFINITY, opened)).toBe(false);
  });
});

describe("semaine de l'EDT", () => {
  const base = new Date(2026, 9, 21, 12); // mercredi 21 octobre 2026
  const weekStart = weekStartFrom(0, base);
  const payload = JSON.stringify({
    entries: [
      { id: "lun", subject: "MATHS", start: local(19, 8), end: local(19, 9) },
      { id: "ven", subject: "NSI", start: local(23, 10), end: local(23, 11) },
      { id: "suiv", subject: "HG", start: local(26, 8), end: local(26, 9) },
    ],
  });
  const lessons = parseTimetable(payload);

  test("le lundi est calculé par date, pas par 168 heures", () => {
    expect(isoDay(weekStart)).toBe("2026-10-19");
    expect(isoDay(weekStartFrom(1, base))).toBe("2026-10-26");
    expect(weekQuery(weekStart)).toBe("weekStart=2026-10-19");
    expect(weekLabel(weekStart)).toContain("19");
    expect(weekLabel(weekStart)).toContain("25");
    expect(weekLabel(weekStart)).toContain("octobre");
  });

  test("filtre et groupe les cours par jour local", () => {
    const week = lessonsInWeek(lessons, weekStart);
    expect(week.map((lesson) => lesson.id)).toEqual(["lun", "ven"]);
    const groups = groupDays(week, weekStart);
    expect(groups).toHaveLength(7);
    expect(groups[0]?.key).toBe("2026-10-19");
    expect(groups[0]?.lessons.map((lesson) => lesson.id)).toEqual(["lun"]);
    expect(groups[4]?.lessons.map((lesson) => lesson.id)).toEqual(["ven"]);
    expect(groups[1]?.lessons).toEqual([]);
    expect(shortDay(new Date(2026, 9, 19))).toBe("lun.");
  });

  test("distingue cours en cours, prochain et mise en avant", () => {
    const week = lessonsInWeek(lessons, weekStart);
    const at830 = new Date(2026, 9, 19, 8, 30).getTime();
    const current = currentLesson(week, at830);
    const next = nextLesson(week, at830);
    expect(current?.id).toBe("lun");
    expect(next?.id).toBe("ven");
    expect(highlightOf(week[0]!, current, next)).toBe("current");
    expect(highlightOf(week[1]!, current, next)).toBe("next");
    expect(highlightOf(lessons[2]!, current, next)).toBeNull();
    expect(currentLesson(week, new Date(2026, 9, 19, 7).getTime())).toBeNull();
    expect(nextLesson(week, new Date(2026, 9, 23, 23).getTime())).toBeNull();
  });
});

describe("libellés de temps", () => {
  const now = new Date(2026, 9, 19, 8).getTime();

  test("compte à rebours", () => {
    expect(countdownFr(now + 12 * 60_000, now)).toBe("dans 12 min");
    expect(countdownFr(now + 2 * 3_600_000, now)).toBe("dans 2 h");
    expect(countdownFr(new Date(2026, 9, 20, 8).getTime(), now)).toBe("demain 08:00");
    expect(countdownFr(now, now)).toBe("");
  });

  test("cours en cours et horloge", () => {
    const lesson = parseTimetable(
      JSON.stringify({ entries: [{ id: "x", subject: "MATHS", start: local(19, 8), end: local(19, 9) }] }),
    )[0]!;
    expect(courseCountdown(lesson, new Date(2026, 9, 19, 8, 30).getTime())).toBe("en cours");
    expect(clockLabel(new Date(2026, 9, 19, 8, 5).getTime())).toBe("08:05");
  });

  test("durées", () => {
    expect(durationLabel(60_000)).toBe("1 min");
    expect(durationLabel(55 * 60_000)).toBe("55 mins");
    expect(durationLabel(110 * 60_000)).toBe("1h 50 mins");
    expect(durationLabel(2 * 3_600_000)).toBe("2h");
    expect(durationLabel(0)).toBe("");
  });

  test("échéance passée", () => {
    expect(dueLabel(new Date(2026, 9, 18, 20).getTime(), now)).toBe("en retard");
  });
});

describe("helpers de semaine exportés", () => {
  test("startOfWeek est réutilisé, donc lundi 00:00 local", () => {
    const monday = startOfWeek(new Date(2026, 9, 21, 12));
    expect(isoDay(monday)).toBe("2026-10-19");
    expect(monday.getHours()).toBe(0);
  });
});
