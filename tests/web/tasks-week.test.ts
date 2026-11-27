import { useParisTz } from "./setup";

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  assignmentSections,
  assignmentsInWeek,
  assignmentsMatching,
  dueLabel,
  overdueCount,
  parseAssignmentsPayload,
  weekStartOf,
} from "../../web/src/features/tasks/assignments";
import { TasksSummary } from "../../web/src/features/tasks/TasksSummary";
import { NOW, VALID, payload } from "./tasks-fixtures";

useParisTz();

describe("web tâches — sections", () => {
  // NOW = mercredi 21 octobre 2026, 12:00 (Europe/Paris). La semaine
  // courante commence le lundi 19 octobre 2026.
  const CURRENT_WEEK = "2026-10-19";

  test("les sections suivent la semaine affichée, pas la semaine en cours", () => {
    // #567 : les sections décrivent la semaine AFFICHÉE, pas la semaine en cours.
    const items = parseAssignmentsPayload(
      payload([
        { ...VALID, id: "lundi-passe", dueDate: "2026-10-19T08:00:00.000Z" },
        { ...VALID, id: "aujourdhui-passe", dueDate: "2026-10-21T08:00:00.000Z" },
        { ...VALID, id: "aujourdhui-a-venir", dueDate: "2026-10-21T16:00:00.000Z" },
        { ...VALID, id: "samedi", dueDate: "2026-10-24T18:00:00.000Z" },
        { ...VALID, id: "semaine-suivante", dueDate: "2026-10-26T08:00:00.000Z" },
      ]),
    ).items;

    const courante = assignmentSections(items, CURRENT_WEEK, NOW);
    expect(courante.map((section) => section.id)).toEqual(["overdue", "today", "week", "later"]);
    expect(courante.map((section) => section.items.map((item) => item.id))).toEqual([
      ["lundi-passe", "aujourdhui-passe"],
      ["aujourdhui-a-venir"],
      ["samedi"],
      ["semaine-suivante"],
    ]);
    expect(courante.find((section) => section.id === "week")?.title).toBe("Cette semaine");

    // Semaine suivante affichée : plus de « Aujourd'hui ».
    const suivante = assignmentSections(items, "2026-10-26", NOW);
    expect(suivante.map((section) => section.id)).toEqual(["overdue", "week"]);
    expect(suivante.find((section) => section.id === "week")?.items.map((item) => item.id)).toEqual([
      "semaine-suivante",
    ]);
    expect(suivante.find((section) => section.id === "week")?.title).toBe("Semaine 44");
  });

  test("semaine courante : un devoir dû hier reste « En retard », pas dans la semaine", () => {
    // La semaine affichée ne doit pas faire perdre le signal « en retard » :
    // l'écran ne montre que la semaine choisie.
    const items = parseAssignmentsPayload(
      payload([
        { ...VALID, id: "hier", dueDate: "2026-10-20T18:00:00.000Z" },
        { ...VALID, id: "aujourdhui-passe", dueDate: "2026-10-21T08:00:00.000Z" },
        { ...VALID, id: "aujourdhui-a-venir", dueDate: "2026-10-21T16:00:00.000Z" },
        { ...VALID, id: "demain", dueDate: "2026-10-22T08:00:00.000Z" },
      ]),
    ).items;
    const sections = assignmentSections(items, CURRENT_WEEK, NOW);
    expect(sections.map((section) => section.id)).toEqual(["overdue", "today", "week"]);
    expect(sections.map((section) => section.items.map((item) => item.id))).toEqual([
      ["hier", "aujourdhui-passe"],
      ["aujourdhui-a-venir"],
      ["demain"],
    ]);
    expect(sections.find((section) => section.id === "week")?.title).toBe("Cette semaine");
  });

  test("une échéance du jour SANS heure n'est jamais en retard", () => {
    // Une date seule est un rendez-vous de la journée entière.
    const items = parseAssignmentsPayload(
      payload([{ ...VALID, id: "aujourdhui", dueDate: "2026-10-21" }]),
    ).items;
    const sections = assignmentSections(items, CURRENT_WEEK, NOW);
    expect(sections.map((section) => section.id)).toEqual(["today"]);
    expect(sections[0]?.items.map((item) => item.id)).toEqual(["aujourdhui"]);
  });

  test("un devoir émis à minuit Paris reste « Aujourd'hui » toute la journée (#781)", () => {
    // Dimanche 1er novembre 2026, midi à Paris (semaine du 26 octobre).
    const now = new Date(2026, 10, 1, 12, 0, 0);
    const week = weekStartOf(now);
    expect(week).toBe("2026-10-26");
    const items = parseAssignmentsPayload(
      payload([{ ...VALID, id: "journee", dueDate: "2026-11-01T00:00+01:00" }]),
    ).items;
    // La fenêtre de semaine et les sections lisent le même jour civil.
    expect(assignmentsInWeek(items, week).map((item) => item.id)).toEqual(["journee"]);
    expect(assignmentSections(items, week, now).map((section) => section.id)).toEqual(["today"]);
    expect(dueLabel("2026-11-01T00:00+01:00")).not.toContain("00:00");
  });

  test("une semaine passée : « En retard » avant la semaine, la semaine à l'intérieur", () => {
    const items = parseAssignmentsPayload(
      payload([
        { ...VALID, id: "avant", dueDate: "2026-10-08T08:00:00.000Z" },
        { ...VALID, id: "dedans", dueDate: "2026-10-14T08:00:00.000Z" },
        { ...VALID, id: "apres", dueDate: "2026-10-21T08:00:00.000Z" },
      ]),
    ).items;
    const sections = assignmentSections(items, "2026-10-12", NOW);
    // Pas de « Aujourd'hui » pour une semaine passée : la journée en cours est
    // « Plus tard » pour cette semaine-là.
    expect(sections.map((section) => section.id)).toEqual(["overdue", "week", "later"]);
    expect(sections.map((section) => section.items.map((item) => item.id))).toEqual([
      ["avant"],
      ["dedans"],
      ["apres"],
    ]);
  });

  test("chaque devoir reste visible une fois et une seule, quelle que soit la semaine", () => {
    const items = parseAssignmentsPayload(
      payload([
        { ...VALID, id: "lundi", dueDate: "2026-10-19T08:00:00.000Z" },
        { ...VALID, id: "mardi", dueDate: "2026-10-20T08:00:00.000Z" },
        { ...VALID, id: "aujourdhui", dueDate: "2026-10-21T08:00:00.000Z" },
        { ...VALID, id: "vendredi", dueDate: "2026-10-23T08:00:00.000Z" },
        { ...VALID, id: "plus-tard", dueDate: "2026-11-02T08:00:00.000Z" },
        { ...VALID, id: "sans-echeance", dueDate: "illisible" },
        { ...VALID, id: "fait", dueDate: "2026-10-21T08:00:00.000Z", done: true },
      ]),
    ).items;
    for (const week of ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02"]) {
      const sections = assignmentSections(items, week, NOW);
      const ids = sections.flatMap((section) => section.items.map((item) => item.id));
      expect(new Set(ids).size).toBe(ids.length);
      expect([...ids].sort()).toEqual(items.map((item) => item.id).sort());
    }
  });

  test("le fait prime sur la date et une date illisible reste visible sans échéance", () => {
    const items = parseAssignmentsPayload(
      payload([
        { ...VALID, id: "future-done", dueDate: "2026-12-01T18:00:00.000Z", done: true },
        { ...VALID, id: "undated", dueDate: "illisible" },
      ]),
    ).items;
    const sections = assignmentSections(items, CURRENT_WEEK, NOW);
    expect(sections.map((section) => section.id)).toEqual(["undated", "done"]);
    expect(sections[0]?.items[0]?.id).toBe("undated");
    expect(sections[1]?.items[0]?.id).toBe("future-done");
  });

  test("trie chaque section par échéance", () => {
    const items = parseAssignmentsPayload(
      payload([
        { ...VALID, id: "b", dueDate: "2026-10-24T18:00:00.000Z" },
        { ...VALID, id: "a", dueDate: "2026-10-24T08:00:00.000Z" },
      ]),
    ).items;
    const sections = assignmentSections(items, CURRENT_WEEK, NOW);
    expect(sections[0]?.id).toBe("week");
    expect(sections[0]?.items.map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("web tâches — retard visible", () => {
  // NOW = mercredi 21 octobre 2026, 12:00 (Europe/Paris).
  const CURRENT_WEEK = "2026-10-19";
  const items = parseAssignmentsPayload(
    payload([
      { ...VALID, id: "lundi", subject: "HISTOIRE-GEOGRAPHIE", dueDate: "2026-10-19T08:00:00.000Z" },
      { ...VALID, id: "hier", subject: "MATHEMATIQUES", dueDate: "2026-10-20T18:00:00.000Z" },
      { ...VALID, id: "aujourdhui", dueDate: "2026-10-21T16:00:00.000Z" },
      { ...VALID, id: "demain", dueDate: "2026-10-22T08:00:00.000Z" },
    ]),
  ).items;

  function summary(overdue: number, remaining = 4): string {
    return renderToStaticMarkup(
      createElement(TasksSummary, {
        percent: 0,
        remaining,
        overdue,
        weekSuffix: "cette semaine",
      }),
    );
  }

  test("le badge affiche le compte de la section « En retard » rendue", () => {
    const sections = assignmentSections(items, CURRENT_WEEK, NOW);
    const section = sections.find((item) => item.id === "overdue");
    expect(section?.items.map((item) => item.id)).toEqual(["lundi", "hier"]);
    expect(overdueCount(sections)).toBe(section?.items.length ?? -1);

    const html = summary(overdueCount(sections));
    expect(html).toContain("4 tâches restantes cette semaine");
    expect(html).toContain("2 devoirs en retard");
    expect(html.match(/devoirs en retard/g)).toHaveLength(1);
  });

  test("la recherche qui réduit la liste réduit le badge pareil", () => {
    const filtered = assignmentsMatching(items, "mathematiques");
    const sections = assignmentSections(filtered, CURRENT_WEEK, NOW);
    expect(sections.find((item) => item.id === "overdue")?.items.map((item) => item.id)).toEqual([
      "hier",
    ]);

    const html = summary(overdueCount(sections));
    expect(html).toContain("1 devoir en retard");
    expect(html).not.toContain("2 devoirs en retard");
  });

  test("aucun devoir en retard : aucun badge", () => {
    // Une recherche sans résultat vide la section : le badge ne survit pas.
    const sections = assignmentSections(assignmentsMatching(items, "introuvable"), CURRENT_WEEK, NOW);
    expect(overdueCount(sections)).toBe(0);
    expect(summary(overdueCount(sections))).not.toContain("en retard");
  });

  test("l'écran dérive le badge des sections rendues, pas d'un second calcul", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "..", "web", "src", "features", "tasks", "TasksScreen.tsx"),
      "utf8",
    );
    expect(source).toContain("const overdue = overdueCount(sections)");
    expect(source).toContain("overdue={overdue}");
  });
});
