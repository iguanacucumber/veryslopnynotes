import { useParisTz } from "./setup";

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ASSIGNMENTS_MAX_ITEMS,
  assignmentCardText,
  assignmentDate,
  assignmentHasAssistantMaterial,
  assignmentDayKey,
  assignmentSections,
  assignmentsInWeek,
  assignmentsMatching,
  dueLabel,
  foldFr,
  homeworkRefusalText,
  parseAssignment,
  parseAssignmentsPayload,
  shiftWeek,
  subjectDisplayFr,
  subjectInitial,
  taskProgress,
  weekEndOf,
  weekGap,
  weekLabelFr,
  weekRangeFr,
  weekStartOf,
} from "../../web/src/features/tasks/assignments";
import { bridge } from "../../web/src/bridge/client";
import { weekStatusFr } from "../../web/src/lib/format";
import {
  parseRevisionSheet,
  parseRevisionSheets,
  revisionDateLabel,
  SHEET_MAX_BODY,
  SHEET_MAX_SOURCES,
  SHEETS_MAX_ITEMS,
} from "../../web/src/features/revisions/sheets";

useParisTz();

const NOW = new Date(2026, 9, 21, 12, 0, 0); // mercredi 21 octobre 2026, midi local

const VALID = {
  id: "a3",
  subject: "NUMERIQUE SC.INFORM.",
  title: "TP — base de données",
  dueDate: "2026-10-23T18:00:00.000Z",
  done: false,
  description: "Terminer les requêtes SQL et rendre le script.",
  attachments: [{ id: "att1", label: "sujet-tp.pdf", ref: "homework:1:file:0:att1" }],
};

function payload(items: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ assignments: items, ...extra });
}

describe("web tâches — parsing défensif", () => {
  test("accepte la forme Kotlin {assignments} et la forme du pont {items}", () => {
    expect(parseAssignmentsPayload(payload([VALID])).items).toHaveLength(1);
    const items = parseAssignmentsPayload(JSON.stringify({ items: [VALID] })).items;
    expect(items[0]?.id).toBe("a3");
    expect(parseAssignmentsPayload(JSON.stringify([VALID])).items).toHaveLength(1);
  });

  test("un JSON illisible ou absent rend un payload vide, jamais une exception", () => {
    for (const raw of [null, "", "{", "null", JSON.stringify({ assignments: "non" })]) {
      const parsed = parseAssignmentsPayload(raw);
      expect(parsed.items).toEqual([]);
      expect(parsed.weekStart).toBeNull();
    }
  });

  test("rejette un devoir hors contrat ou une pièce jointe en URL absolue", () => {
    expect(parseAssignment({ ...VALID, id: "" })).toBeNull();
    expect(parseAssignment({ ...VALID, title: "  " })).toBeNull();
    expect(parseAssignment({ ...VALID, attachments: [{ id: "x", label: "x", ref: "https://pronote/x" }] })).toBeNull();
    expect(parseAssignment({ ...VALID, attachments: [{ id: "x", label: "x", ref: "data:application/pdf;base64,AA" }] })).toBeNull();
    expect(parseAssignment({ ...VALID, attachments: [{ id: "x", label: "x", ref: "homework\\0" }] })).toBeNull();
    expect(parseAssignment({ ...VALID, attachments: [{ id: "x", label: "x", ref: "file:///tmp/x" }] })).toBeNull();
    expect(parseAssignment({ ...VALID, attachments: [{ id: "x", label: "x", ref: "/tmp/x" }] })).toBeNull();
    expect(parseAssignment({ ...VALID, attachments: [{ id: "x", label: "x", ref: "homework:../x" }] })).toBeNull();
    expect(parseAssignment({ ...VALID, attachments: [], description: "x".repeat(2001) })).toBeNull();
    expect(
      parseAssignment({ ...VALID, lessonContent: { title: "", excerpt: "cours" } }),
    ).toBeNull();
  });

  test("la `ref` est validée BRUTE : hors schéma, le devoir ENTIER disparaît", () => {
    // Même verdict que le contrat TS et le Kotlin (`core/Assignment.kt`) : une
    // `ref` invalide fait perdre le devoir entier.
    for (const ref of [
      "homework:0:file:0:12 34",
      "homework:0:file:0:a\u0001b",
      "DATA:application/pdf;base64,AA",
      "homework:../x",
      "x".repeat(201),
    ]) {
      expect(parseAssignment({ ...VALID, attachments: [{ id: "x", label: "x", ref }] })).toBeNull();
    }
    // Une `ref` au schéma est conservée telle quelle (assainie en amont).
    const parsed = parseAssignment({
      ...VALID,
      attachments: [{ id: "12 34", label: "sujet.pdf", ref: "homework:0:file:0:12_34" }],
    });
    expect(parsed?.attachments[0]?.ref).toBe("homework:0:file:0:12_34");
    expect(parsed?.attachments[0]?.id).toBe("12 34");
  });

  test("borne les pièces jointes et les textes de cours", () => {
    const attachments = Array.from({ length: 12 }, (_, index) => ({
      id: `att${index}`,
      label: `fichier-${index}.pdf`,
      ref: `homework:1:file:0:att${index}`,
    }));
    const parsed = parseAssignment({
      ...VALID,
      attachments,
      lessonContent: { title: "t".repeat(300), excerpt: "e".repeat(9000) },
    });
    expect(parsed?.attachments).toHaveLength(10);
    expect(parsed?.lessonContent?.title).toHaveLength(200);
    expect(parsed?.lessonContent?.excerpt).toHaveLength(8000);
  });

  // Le payload peut porter PLUSIEURS cours (matière + jour) et leurs pièces
  // jointes ; le premier reste `lessonContent` pour les anciens lecteurs.
  test("lit les cours multiples et leurs pièces jointes", () => {
    const parsed = parseAssignment({
      ...VALID,
      lessonContent: { title: "Chapitre 4", excerpt: "Cours principal." },
      lessonContents: [
        { title: "Chapitre 4", excerpt: "Cours principal." },
        {
          title: "Chapitre 4 — exercices",
          excerpt: "Exercices.",
          attachments: [{ id: "f1", label: "td.pdf", ref: "homework:0:lesson:1:file:0:f1" }],
        },
      ],
    });
    expect(parsed?.lessonContents).toHaveLength(2);
    expect(parsed?.lessonContent?.title).toBe("Chapitre 4");
    expect(parsed?.lessonContents[1]?.attachments?.[0]?.label).toBe("td.pdf");
  });

  test("nettoie les caractères de contrôle et garde le texte comme donnée", () => {    const parsed = parseAssignment({ ...VALID, description: "  <img src=x onerror=alert(1)>\u0007  " });
    expect(parsed?.description).toBe("<img src=x onerror=alert(1)>");
    expect(parsed?.done).toBe(false);
  });

  test("lit les bornes de semaine et dérive le dimanche", () => {
    const parsed = parseAssignmentsPayload(payload([], { weekStart: "2026-10-19" }));
    expect(parsed.weekStart).toBe("2026-10-19");
    expect(parsed.weekEnd).toBe("2026-10-25");
    expect(weekEndOf("2026-10-19")).toBe("2026-10-25");
    const ranged = parseAssignmentsPayload(payload([], { from: "2026-10-19", to: "2026-10-25" }));
    expect(ranged.weekStart).toBe("2026-10-19");
    expect(ranged.weekEnd).toBe("2026-10-25");
  });

  test("borne le scan, l'acceptation et déduplique par id", () => {
    const many = Array.from({ length: 5000 }, (_, index) => ({ ...VALID, id: `a${index}` }));
    const parsed = parseAssignmentsPayload(payload(many));
    expect(parsed.items).toHaveLength(ASSIGNMENTS_MAX_ITEMS);
    expect(new Set(parsed.items.map((item) => item.id)).size).toBe(ASSIGNMENTS_MAX_ITEMS);

    const duplicates = parseAssignmentsPayload(
      payload([{ ...VALID, id: "same" }, { ...VALID, id: "same" }, { ...VALID, id: "other" }]),
    );
    expect(duplicates.items.map((item) => item.id)).toEqual(["same", "other"]);
  });

  // La déduplication est par identifiant SEUL : deux devoirs réels qui se
  // ressemblent (matière, titre, échéance) ne sont jamais confondus.
  test("la déduplication par id écarte le doublon et garde les devoirs distincts (#570)", () => {
    const twice = parseAssignmentsPayload(payload([VALID, { ...VALID }]));
    expect(twice.items.map((item) => item.id)).toEqual(["a3"]);

    const alike = parseAssignmentsPayload(
      payload([
        { ...VALID, id: "x" },
        { ...VALID, id: "y" },
      ]),
    );
    expect(alike.items.map((item) => item.id)).toEqual(["x", "y"]);
  });
});

describe("web tâches — dates et semaines", () => {
  test("accepte une date seule et un instant ISO, rejette le reste", () => {
    expect(assignmentDayKey("2026-10-18")).toBe("2026-10-18");
    expect(assignmentDate("2026-02-31")).toBeNull();
    expect(assignmentDate("pas une date")).toBeNull();
    expect(assignmentDate("2026-10-18T08:00:00+02:00")).not.toBeNull();
  });

  test("libellé d'échéance : date seule sans heure, instant avec heure", () => {
    const stamped = new Date(2026, 9, 25, 20, 0, 0).toISOString();
    expect(dueLabel(stamped)).toContain("dimanche 25 octobre");
    expect(dueLabel(stamped)).toContain("20:00");
    expect(dueLabel("2026-10-25")).toBe("dimanche 25 octobre");
    expect(dueLabel("illisible")).toBe("");
  });

  test("numéro et plage de semaine ISO, année affichée seulement au changement", () => {
    expect(weekLabelFr("2026-10-19")).toBe("Semaine 43");
    expect(weekRangeFr("2026-10-19")).toBe("19/10 – 25/10");
    expect(weekRangeFr("2026-12-28")).toBe("28/12 – 03/01/2027");
    expect(shiftWeek("2026-10-19", 1)).toBe("2026-10-26");
    expect(shiftWeek("2026-10-19", -1)).toBe("2026-10-12");
    expect(shiftWeek("illisible", 1)).toBe("illisible");
  });

  test("l'écart avec la semaine courante alimente le libellé (#580)", () => {
    expect(weekGap("2026-10-19", "2026-10-19")).toBe(0);
    expect(weekGap("2026-10-12", "2026-10-19")).toBe(-1);
    expect(weekGap("2026-10-26", "2026-10-19")).toBe(1);
    expect(weekGap("2026-11-02", "2026-10-19")).toBe(2);
    // Illisible : on ne prétend pas être sur une autre semaine.
    expect(weekGap("illisible", "2026-10-19")).toBe(0);
  });
});

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
    expect(source).toContain("weekStartOf(new Date())");
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
    expect(source).toContain("assignmentSections(matching, week, new Date())");
    expect(source).toContain("assignmentsMatching(items, search)");
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

describe("web tâches — texte", () => {
  test("la consigne n'est pas affichée deux fois", () => {
    const duplicate = parseAssignment({
      ...VALID,
      title: "Evaluation de compréhension orale et d'expression écrite",
      description: "Evaluation de compréhension orale et d'expression écrite sur le début de la séquence.",
    });
    expect(assignmentCardText(duplicate!)).toEqual({
      title: "",
      body: "Evaluation de compréhension orale et d'expression écrite sur le début de la séquence.",
    });
    const distinct = parseAssignment({ ...VALID, title: "Exercices", description: "p. 84" });
    expect(assignmentCardText(distinct!)).toEqual({ title: "Exercices", body: "p. 84" });
  });

  test("matière : casse de phrase, initiale et repli", () => {
    expect(subjectDisplayFr("ALLEMAND LV2")).toBe("Allemand LV2");
    expect(subjectDisplayFr("Mathématiques")).toBe("Mathématiques");
    expect(subjectDisplayFr("2NDE STL")).toBe("2nde STL");
    expect(subjectInitial("NUMERIQUE SC.INFORM.")).toBe("N");
    expect(subjectInitial("   ")).toBe("?");
    expect(foldFr("Économie — DÉJÀ")).toBe("economie — deja");
  });
});

describe("web tâches — matière de l'assistant", () => {
  test("un devoir sans consigne ni extrait ne propose pas les actions IA", () => {
    // `lessonContent: null` ne doit pas passer pour « extrait vide » : la
    // condition chaînée `?.` rendait `undefined !== ""` vrai avant ce test.
    expect(assignmentHasAssistantMaterial({ description: "", lessonContent: null })).toBe(false);
    expect(assignmentHasAssistantMaterial({ description: "  ", lessonContent: { title: "", excerpt: "  " } })).toBe(false);
    expect(assignmentHasAssistantMaterial({ description: "Relire le II.", lessonContent: null })).toBe(true);
    expect(
      assignmentHasAssistantMaterial({ description: "", lessonContent: { title: "Cours", excerpt: "Extrait" } }),
    ).toBe(true);
    // #631 : une pièce jointe est désormais une source lisible (texte extrait
    // par le natif), donc elle suffit à proposer l'assistant.
    expect(
      assignmentHasAssistantMaterial({
        description: "",
        lessonContent: null,
        attachments: [{ id: "f1", label: "consigne.txt", ref: "homework:0:file:0:f1" }],
      }),
    ).toBe(true);
  });
});

describe("web tâches — refus de l'assistant (#416)", () => {
  // Le pont natif répond {ok:true, refused:true, message:<phrase>} : c'est la
  // PHRASE qui fait foi. Le `body` ci-dessous est un echo de la consigne
  // (ce que l'ancien pont envoyait) : il ne doit JAMAIS être affiché.
  const NATIVE = "L'assistant a refusé de répondre à cette question.";
  const ECHO = "Tu aides aux devoirs. Utilise uniquement les DONNEES delimitees.";

  /** Un pont factice qui répond `reponse` à `llm.askHomework`. */
  async function askNatif(reponse: unknown): Promise<{ ok: boolean; body?: string; refused?: boolean; message?: string }> {
    const g = globalThis as unknown as {
      window?: unknown;
      VSN?: unknown;
      __vsnResolve?: (id: string, result: string) => void;
    };
    g.window = globalThis;
    g.VSN = {
      call: (requestId: string, _method: string, _paramsJson: string) => {
        g.__vsnResolve?.(requestId, JSON.stringify(reponse));
      },
    };
    try {
      return await bridge.askHomework("a1", "2026-11-16");
    } finally {
      delete g.window;
      delete g.VSN;
    }
  }

  test("un refus natif affiche le message du pont, pas le repli « pas assez de matière »", async () => {
    const result = await askNatif({ ok: true, refused: true, body: ECHO, message: NATIVE });
    expect(result.refused).toBe(true);
    const affichage = homeworkRefusalText(result.message);
    expect(affichage).toBe(NATIVE);
    expect(affichage).not.toContain("matière");
    // L'echo de la consigne ne doit jamais être affiché.
    expect(affichage).not.toContain(ECHO);
  });

  test("sans message du pont, le repli reste générique (jamais « pas assez de matière »)", () => {
    for (const vide of [undefined, "", "   "]) {
      const affichage = homeworkRefusalText(vide);
      expect(affichage).not.toContain("matière");
      expect(affichage.trim()).not.toBe("");
    }
  });

  test("l'écran n'affiche jamais le corps brut d'un refus", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "..", "web", "src", "features", "tasks", "TasksScreen.tsx"),
      "utf8",
    );
    const debut = source.indexOf("if (result.refused) {");
    expect(debut).toBeGreaterThan(-1);
    const branche = source.slice(debut, source.indexOf("} else if (!result.ok)", debut));
    expect(branche).toContain("homeworkRefusalText(result.message)");
    expect(branche).not.toContain("result.body");
  });
});

describe("web fiches — parsing défensif", () => {
  const SHEET = {
    id: "rev1",
    title: "Régimes totalitaires — fiche de révision",
    subject: "HISTOIRE-GEOGRAPHIE",
    date: "2026-10-17T18:00:00.000Z",
    sources: ["a1"],
    body: "1. Définir le totalitarisme.\n2. Comparer les régimes.",
  };

  test("accepte {sheets} et le tableau nu, ignore une fiche incomplète", () => {
    expect(parseRevisionSheets({ sheets: [SHEET, { id: "x" }] })).toHaveLength(1);
    expect(parseRevisionSheets([SHEET])).toHaveLength(1);
    expect(parseRevisionSheets({ items: [SHEET] })).toHaveLength(1);
    expect(parseRevisionSheets({ sheets: "nope" })).toEqual([]);
    expect(parseRevisionSheets(null)).toEqual([]);
  });

  test("trie par date décroissante et garde le corps comme texte brut", () => {
    const older = { ...SHEET, id: "old", date: "2026-10-01T18:00:00.000Z" };
    const sheets = parseRevisionSheets([older, SHEET]);
    expect(sheets.map((sheet) => sheet.id)).toEqual(["rev1", "old"]);
    const xss = parseRevisionSheet({ ...SHEET, body: "<script>alert(1)</script>" });
    expect(xss?.body).toBe("<script>alert(1)</script>");
  });

  test("date lisible et fiche introuvable", () => {
    const sheet = parseRevisionSheet(SHEET);
    expect(sheet).not.toBeNull();
    expect(revisionDateLabel(sheet!)).toContain("17 octobre");
    expect(parseRevisionSheet({ ...SHEET, body: "" })).toBeNull();
    expect(parseRevisionSheet(null)).toBeNull();
  });

  test("accepte une enveloppe JSON sérialisée", () => {
    expect(parseRevisionSheets(JSON.stringify({ sheets: [SHEET] }))).toHaveLength(1);
    expect(parseRevisionSheets(JSON.stringify([SHEET]))).toHaveLength(1);
    expect(parseRevisionSheets("{")).toEqual([]);
  });

  test("la fiche ouverte est rendue dans sa carte, avec aria-expanded/controls", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "..", "web", "src", "features", "revisions", "RevisionSheets.tsx"),
      "utf8",
    );
    expect(source).toContain("aria-expanded={opened}");
    expect(source).toContain("aria-controls={bodyId}");
    expect(source).toContain("<SheetBody sheet={selected.sheet} />");
    // Disclosure inline : le corps est rendu DANS la carte de la fiche, après
    // son déclencheur, jamais dans une carte séparée au-dessus de la liste.
    expect(source.indexOf("<SheetBody")).toBeGreaterThan(source.indexOf("aria-controls={bodyId}"));
    // Un seul « Fermer » : le déclencheur devient Fermer et porte le focus.
    expect(source).toContain("triggers.current.get(selected.id)?.focus()");
    expect(source).not.toContain("Fiche ouverte");
    expect(source).toContain("triggers.current.get(id)?.focus()");
  });

  test("la fiche fermée montre un aperçu texte et des actions Ouvrir/PDF", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "..", "web", "src", "features", "revisions", "RevisionSheets.tsx"),
      "utf8",
    );
    expect(source).toContain('eyebrow="Assistant"');
    expect(source).toContain('title="Fiches de révision"');
    expect(source).toContain("Créer une fiche");
    expect(source).toContain('navigate("/tasks")');
    expect(source).toContain("sourceLabel");
    expect(source).toContain("revision-card__preview");
    // Ouvrir est l'action principale, PDF l'action secondaire.
    const open = source.indexOf("btn btn--small revision-card__open");
    const pdf = source.indexOf("btn btn--ghost btn--small revision-card__pdf");
    expect(open).toBeGreaterThan(-1);
    expect(pdf).toBeGreaterThan(open);
    expect(source).toContain("Exporter en PDF la fiche");
    // L'aperçu fermé reste du texte aplati (`previewOf`), pas du markdown.
    expect(source).toContain("previewOf(sheet.body)");
    // Corps ouvert : parseur markdown borné rendu en éléments React, jamais
    // de HTML brut injecté.
    expect(source).toContain("<MarkdownBody text={sheet.body} />");
    expect(source).not.toContain("innerHTML");
    expect(source).not.toContain("dangerouslySetInnerHTML");
  });

  test("borne le scan, les sources et le corps, déduplique par id", () => {
    const many = Array.from({ length: 5000 }, (_, index) => ({ ...SHEET, id: `rev${index}` }));
    const parsed = parseRevisionSheets(many);
    expect(parsed).toHaveLength(SHEETS_MAX_ITEMS);
    expect(new Set(parsed.map((sheet) => sheet.id)).size).toBe(SHEETS_MAX_ITEMS);

    expect(parseRevisionSheets([SHEET, SHEET, { ...SHEET, id: "other" }])).toHaveLength(2);

    const sources = Array.from({ length: 25 }, (_, index) => `src${index}`);
    const capped = parseRevisionSheet({
      ...SHEET,
      sources,
      body: "b".repeat(30_000),
    });
    expect(capped?.sources).toHaveLength(SHEET_MAX_SOURCES);
    expect(capped?.body).toHaveLength(SHEET_MAX_BODY);
  });
});
