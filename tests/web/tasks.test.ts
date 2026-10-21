import { useParisTz } from "./setup";

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ASSIGNMENTS_MAX_ITEMS,
  assignmentCardText,
  assignmentDate,
  assignmentDayKey,
  assignmentSections,
  assignmentsInWeek,
  dueLabel,
  foldFr,
  homeworkRefusalText,
  parseAssignment,
  parseAssignmentsPayload,
  shiftWeek,
  subjectDisplayFr,
  subjectInitial,
  weekEndOf,
  weekLabelFr,
  weekRangeFr,
  weekStartOf,
} from "../../web/src/features/tasks/assignments";
import { bridge } from "../../web/src/bridge/client";
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
    // Même verdict que le contrat TS et que le Kotlin (`core/Assignment.kt`) :
    // une `ref` avec un espace (identifiant Pronote exotique), un caractère de
    // contrôle ou une URL fait perdre le devoir entier.
    for (const ref of [
      "homework:0:file:0:12 34",
      "homework:0:file:0:a\u0001b",
      "DATA:application/pdf;base64,AA",
      "homework:../x",
      "x".repeat(201),
    ]) {
      expect(parseAssignment({ ...VALID, attachments: [{ id: "x", label: "x", ref }] })).toBeNull();
    }
    // Une `ref` au schéma est conservée telle quelle (elle a été assainie en amont).
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
      lessonContent: { title: "t".repeat(300), excerpt: "e".repeat(6000) },
    });
    expect(parsed?.attachments).toHaveLength(10);
    expect(parsed?.lessonContent?.title).toHaveLength(200);
    expect(parsed?.lessonContent?.excerpt).toHaveLength(500);
  });

  test("nettoie les caractères de contrôle et garde le texte comme donnée", () => {
    const parsed = parseAssignment({ ...VALID, description: "  <img src=x onerror=alert(1)>\u0007  " });
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
});

describe("web tâches — sections", () => {
  test("range en retard / aujourd'hui / cette semaine / plus tard / terminés", () => {
    const items = parseAssignmentsPayload(
      payload([
        { ...VALID, id: "late", dueDate: "2026-10-20T18:00:00.000Z" },
        { ...VALID, id: "today", dueDate: "2026-10-21T08:00:00.000Z" },
        { ...VALID, id: "week", dueDate: "2026-10-24T18:00:00.000Z" },
        { ...VALID, id: "later", dueDate: "2026-11-02T18:00:00.000Z" },
        { ...VALID, id: "done", dueDate: "2026-10-20T18:00:00.000Z", done: true },
      ]),
    ).items;
    const sections = assignmentSections(items, NOW);
    expect(sections.map((section) => section.id)).toEqual(["overdue", "today", "week", "later", "done"]);
    expect(sections.map((section) => section.items.map((item) => item.id))).toEqual([
      ["late"],
      ["today"],
      ["week"],
      ["later"],
      ["done"],
    ]);
  });

  test("le fait prime sur la date et une date illisible reste visible sans échéance", () => {
    const items = parseAssignmentsPayload(
      payload([
        { ...VALID, id: "future-done", dueDate: "2026-12-01T18:00:00.000Z", done: true },
        { ...VALID, id: "undated", dueDate: "illisible" },
      ]),
    ).items;
    const sections = assignmentSections(items, NOW);
    expect(sections.map((section) => section.id)).toEqual(["undated", "done"]);
    expect(sections[0]?.items[0]?.id).toBe("undated");
    expect(sections[1]?.items[0]?.id).toBe("future-done");
  });

  test("trie chaque section par échéance", () => {
    const items = parseAssignmentsPayload(
      payload([
        { ...VALID, id: "b", dueDate: "2026-10-21T18:00:00.000Z" },
        { ...VALID, id: "a", dueDate: "2026-10-21T08:00:00.000Z" },
      ]),
    ).items;
    expect(assignmentSections(items, NOW)[0]?.items.map((item) => item.id)).toEqual(["a", "b"]);
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
    // #369 : sans la semaine affichée, le natif cherche le devoir dans une
    // fenêtre fixe (-7/+21 j) : un devoir de la semaine +4 est « introuvable ».
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
      { method: "llm.askHomework", params: { assignmentId: "a1", weekStart: "2026-11-16" } },
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
