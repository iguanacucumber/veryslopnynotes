import { useParisTz } from "./setup";

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assignmentsInWeek,
  assignmentsMatching,
  parseAssignmentsPayload,
  shiftWeek,
  taskProgress,
  weekStartOf,
} from "../../web/src/features/tasks/assignments";
import { bridge } from "../../web/src/bridge/client";
import { weekStatusFr } from "../../web/src/lib/format";
import { NOW, VALID, payload } from "./tasks-fixtures";

useParisTz();

describe("web tâches — navigation de semaine", () => {
  test("la semaine courante démarre un lundi et aller/retour revient au même jour", () => {
    const start = weekStartOf(NOW);
    expect(start).toBe("2026-10-19");
    expect(shiftWeek(start, 1)).toBe("2026-10-26");
    expect(shiftWeek(shiftWeek(start, 1), -1)).toBe(start);
  });

  test("le pont envoie la semaine affichée au natif (fenêtre de recherche)", async () => {
    // Sans la semaine affichée, le natif cherche dans une fenêtre fixe
    // (-7/+21 j) : un devoir de la semaine +4 est « introuvable ».
    const sent: Array<{ method: string; params: Record<string, unknown> }> = [];
    const g = globalThis as unknown as {
      window?: unknown;
      VSN?: unknown;
      __vsnResolve?: (id: string, result: string) => void;
    };
    g.window = globalThis;
    g.VSN = {
      call: (requestId: string, method: string, paramsJson: string) => {
        sent.push({ method, params: JSON.parse(paramsJson) as Record<string, unknown> });
        g.__vsnResolve?.(requestId, '{"ok":true}');
      },
    };
    try {
      await bridge.toggleAssignment("a1", true, "2026-11-16");
      await bridge.openAttachment("a1", "att1", "2026-11-16");
      await bridge.askHomework("a1", "2026-11-16");
    } finally {
      delete g.window;
      delete g.VSN;
    }
    expect(sent).toEqual([
      { method: "assignments.toggle", params: { id: "a1", done: true, weekStart: "2026-11-16" } },
      {
        method: "assignments.attachment",
        params: { homeworkId: "a1", attachmentId: "att1", weekStart: "2026-11-16" },
      },
      {
        method: "llm.askHomework",
        params: { assignmentId: "a1", weekStart: "2026-11-16", proceedAnyway: false },
      },
    ]);
  });

  test("un payload d'une autre semaine ne fuit pas sous le nouvel en-tête", () => {
    const items = parseAssignmentsPayload(
      payload([
        { ...VALID, id: "previous", dueDate: "2026-10-14" },
        { ...VALID, id: "current", dueDate: "2026-10-21" },
        { ...VALID, id: "next", dueDate: "2026-10-27" },
        { ...VALID, id: "undated", dueDate: "illisible" },
      ]),
    ).items;
    expect(assignmentsInWeek(items, "2026-10-19").map((item) => item.id)).toEqual(["current", "undated"]);
    expect(assignmentsInWeek(items, "2026-10-12").map((item) => item.id)).toEqual(["previous", "undated"]);
    expect(assignmentsInWeek(items, "2026-10-26").map((item) => item.id)).toEqual(["next", "undated"]);
    expect(assignmentsInWeek(items, "illisible")).toEqual([]);
  });

  test("la fenêtre de semaine est en jours de PARIS, pas en millisecondes UTC (#749)", () => {
    // Le natif publie un INSTANT : lundi 00:00 Paris = dimanche 22:00 UTC.
    // Des bornes UTC rangeaient ce devoir dans la semaine PRÉCÉDENTE (bug).
    const items = parseAssignmentsPayload(
      payload([
        {
          ...VALID,
          id: "monday-midnight",
          dueDate: "2026-10-19T00:00:00+02:00",
        },
        {
          ...VALID,
          id: "sunday-late",
          dueDate: "2026-10-25T23:30:00+01:00",
        },
        {
          ...VALID,
          id: "next-monday-early",
          dueDate: "2026-10-26T00:30:00+01:00",
        },
      ]),
    ).items;
    expect(assignmentsInWeek(items, "2026-10-19").map((item) => item.id)).toEqual([
      "monday-midnight",
      "sunday-late",
    ]);
    expect(assignmentsInWeek(items, "2026-10-12").map((item) => item.id)).toEqual([]);
    // Lundi 00:30 Paris appartient à la semaine SUIVANTE.
    expect(assignmentsInWeek(items, "2026-10-26").map((item) => item.id)).toEqual([
      "next-monday-early",
    ]);
  });

  test("une semaine de changement d'heure garde ses bornes (167/169 h, #749)", () => {
    // 25 octobre 2026 : passage à l'heure d'hiver. La semaine 19→25 dure 169 h :
    // une fenêtre fixe de 7 × 24 h décalerait la borne.
    const items = parseAssignmentsPayload(
      payload([
        { ...VALID, id: "sun-evening", dueDate: "2026-10-25T23:59:00+01:00" },
        { ...VALID, id: "mon-early", dueDate: "2026-10-26T00:01:00+01:00" },
      ]),
    ).items;
    expect(assignmentsInWeek(items, "2026-10-19").map((item) => item.id)).toEqual(["sun-evening"]);
    expect(assignmentsInWeek(items, "2026-10-26").map((item) => item.id)).toEqual(["mon-early"]);
    // La semaine de printemps (29 mars 2026, 167 h) reste bornée pareil.
    const spring = parseAssignmentsPayload(
      payload([
        { ...VALID, id: "sun", dueDate: "2026-03-29T23:30:00+02:00" },
        { ...VALID, id: "mon", dueDate: "2026-03-30T00:30:00+02:00" },
      ]),
    ).items;
    expect(assignmentsInWeek(spring, "2026-03-23").map((item) => item.id)).toEqual(["sun"]);
    expect(assignmentsInWeek(spring, "2026-03-30").map((item) => item.id)).toEqual(["mon"]);
  });

  test("la recherche ignore accents et casse, et couvre matière, titre, consigne", () => {
    const items = parseAssignmentsPayload(
      payload([
        { ...VALID, id: "maths", subject: "MATHEMATIQUES", title: "Exercices", description: "Fractions" },
        { ...VALID, id: "histoire", subject: "HISTOIRE-GEOGRAPHIE", title: "Révision", description: "Régimes" },
        { ...VALID, id: "nsi", subject: "NUMERIQUE SC.INFORM.", title: "TP SQL", description: "Requêtes" },
      ]),
    ).items;
    expect(assignmentsMatching(items, "mathematiques").map((item) => item.id)).toEqual(["maths"]);
    expect(assignmentsMatching(items, "revision").map((item) => item.id)).toEqual(["histoire"]);
    expect(assignmentsMatching(items, "sql").map((item) => item.id)).toEqual(["nsi"]);
    expect(assignmentsMatching(items, "   ")).toEqual(items);
    expect(assignmentsMatching(items, "introuvable")).toEqual([]);
  });

  test("l'avancement compte les terminés, sans dépasser la semaine", () => {
    const items = parseAssignmentsPayload(
      payload([
        { ...VALID, id: "done", done: true },
        { ...VALID, id: "todo", done: false },
        { ...VALID, id: "todo2", done: false },
      ]),
    ).items;
    expect(taskProgress(items)).toEqual({ total: 3, done: 1, remaining: 2, percent: 33 });
    expect(taskProgress([])).toEqual({ total: 0, done: 0, remaining: 0, percent: 0 });
  });

  test("la navigation est rendue même sans weekStart dans le payload", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "..", "web", "src", "features", "tasks", "TasksScreen.tsx"),
      "utf8",
    );
    const components = readFileSync(
      join(import.meta.dir, "..", "..", "web", "src", "ui", "components.tsx"),
      "utf8",
    );
    expect(source).toContain("weekStartOf(new Date(now))");
    expect(source).toContain("<WeekNavigator");
    expect(components).toContain('aria-label="Semaine précédente"');
    expect(components).toContain('aria-label="Semaine suivante"');
    expect(source).not.toContain("bounds && displayStart");
  });

  test("l'écran regroupe les devoirs sur la semaine AFFICHÉE (#567)", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "..", "web", "src", "features", "tasks", "TasksScreen.tsx"),
      "utf8",
    );
    // Les sections suivent l'en-tête : la semaine affichée, pas « maintenant ».
    // Et « maintenant » avance (tick) : pas de sections figées après minuit.
    expect(source).toContain("assignmentSections(matching, week, new Date(now))");
    expect(source).toContain("const now = useNow()");
    expect(source).toContain("assignmentsMatching(items, search)");
  });

  test("le navigateur et les sections partagent la même horloge", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "..", "web", "src", "features", "tasks", "TasksScreen.tsx"),
      "utf8",
    );
    // La semaine courante du parent ne peut plus rester figée au montage quand
    // les sections avancent après minuit.
    expect(source).toContain("const currentWeek = weekStartOf(new Date(now))");
    expect(source).toContain("<TasksWeek key={week} week={week} now={now} />");
    expect(source).toContain("function TasksWeek({ week, now }: { week: string; now: number })");
  });

  test("le bouton de retour annonce le statut relatif, pas « Cette semaine » (#567, #580)", () => {
    const components = readFileSync(
      join(import.meta.dir, "..", "..", "web", "src", "ui", "components.tsx"),
      "utf8",
    );
    // Le libellé vient de la fonction pure : le composant partagé n'écrit plus
    // « Semaine courante » en dur.
    expect(components).toContain("weekStatusFr(weeks)");
    expect(components).not.toContain("Cette semaine");
    expect(components).toContain("revenir à la semaine courante");
    expect(weekStatusFr(0)).toBe("Semaine courante");
    expect(weekStatusFr(-1)).toBe("Semaine précédente de 1 semaine");
  });
});
