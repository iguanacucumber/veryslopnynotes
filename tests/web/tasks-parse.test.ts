import { useParisTz } from "./setup";

import { describe, expect, test } from "bun:test";
import {
  allAssignmentAttachments,
  ASSIGNMENTS_MAX_ITEMS,
  assignmentCardText,
  assignmentDate,
  assignmentDayKey,
  dueLabel,
  foldFr,
  isAllDayDue,
  isAssignmentsPayloadReadable,
  parseAssignment,
  parseAssignmentsPayload,
  shiftWeek,
  subjectDisplayFr,
  subjectInitial,
  taskWeekSuffixFr,
  weekEndOf,
  weekGap,
  weekLabelFr,
  weekRangeFr,
} from "../../web/src/features/tasks/assignments";
import { VALID, payload } from "./tasks-fixtures";

useParisTz();

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

  test("un JSON illisible reste INVALIDE, jamais « aucun devoir » (I14)", () => {
    // Le parseur tolérant ne lève pas ; l'écran lit le prédicat pour afficher
    // une erreur au lieu d'affirmer qu'aucun devoir n'existe.
    for (const raw of [null, "", "{", "null", JSON.stringify({ assignments: "non" }), "{}"]) {
      expect(isAssignmentsPayloadReadable(raw)).toBe(false);
    }
    expect(isAssignmentsPayloadReadable(JSON.stringify({ assignments: [] }))).toBe(true);
    expect(isAssignmentsPayloadReadable(JSON.stringify({ items: [] }))).toBe(true);
    expect(isAssignmentsPayloadReadable(JSON.stringify([VALID]))).toBe(true);
    expect(isAssignmentsPayloadReadable(payload([VALID]))).toBe(true);
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

  test("nettoie les caractères de contrôle et garde le texte comme donnée", () => {
    const parsed = parseAssignment({
      ...VALID,
      description: "  <img src=x onerror=alert(1)>\u0007\u007F\u0085\u009F  ",
    });
    expect(parsed?.description).toBe("<img src=x onerror=alert(1)>");
    expect(parsed?.done).toBe(false);
  });

  test("une pièce jointe en double ne garde que sa première occurrence", () => {
    const parsed = parseAssignment({
      ...VALID,
      attachments: [
        { id: "att1", label: "sujet.pdf", ref: "homework:1:file:0:att1" },
        { id: "att1", label: "doublon.pdf", ref: "homework:1:file:0:att1bis" },
        { id: "att2", label: "annexe.pdf", ref: "homework:1:file:0:att2" },
      ],
      lessonContent: {
        title: "Chapitre 4",
        excerpt: "Cours.",
        attachments: [
          { id: "f1", label: "td.pdf", ref: "homework:0:lesson:1:file:0:f1" },
          { id: "f1", label: "td-copie.pdf", ref: "homework:0:lesson:1:file:0:f1bis" },
        ],
      },
    });
    expect(parsed?.attachments.map((item) => item.label)).toEqual(["sujet.pdf", "annexe.pdf"]);
    expect(parsed?.lessonContent?.attachments?.map((item) => item.label)).toEqual(["td.pdf"]);
  });

  test("les pièces jointes des cours suivent celles du devoir, sans doublon", () => {
    const parsed = parseAssignment({
      ...VALID,
      attachments: [{ id: "att1", label: "sujet.pdf", ref: "homework:1:file:0:att1" }],
      lessonContents: [
        {
          title: "Chapitre 4",
          excerpt: "Cours.",
          attachments: [
            { id: "att1", label: "sujet.pdf", ref: "homework:1:file:0:att1" },
            { id: "autre", label: "sujet-copie.pdf", ref: "homework:1:file:0:att1" },
            { id: "f1", label: "td.pdf", ref: "homework:0:lesson:1:file:0:f1" },
          ],
        },
        {
          title: "Chapitre 5",
          excerpt: "Suite.",
          attachments: [
            { id: "f2", label: "td2.pdf", ref: "homework:0:lesson:2:file:0:f2" },
            { id: "f2", label: "td2-bis.pdf", ref: "homework:0:lesson:2:file:0:f2bis" },
          ],
        },
      ],
    });
    if (!parsed) throw new Error("devoir attendu");
    expect(allAssignmentAttachments(parsed).map((item) => item.label)).toEqual([
      "sujet.pdf",
      "td.pdf",
      "td2.pdf",
    ]);
  });

  test("les pièces jointes réunies restent bornées", () => {
    const attachments = Array.from({ length: 10 }, (_, index) => ({
      id: `att${index}`,
      label: `fichier-${index}.pdf`,
      ref: `homework:1:file:0:att${index}`,
    }));
    const lessonAttachments = Array.from({ length: 10 }, (_, index) => ({
      id: `cours${index}`,
      label: `cours-${index}.pdf`,
      ref: `homework:0:lesson:1:file:0:cours${index}`,
    }));
    const parsed = parseAssignment({
      ...VALID,
      attachments,
      lessonContent: { title: "Chapitre 4", excerpt: "Cours.", attachments: lessonAttachments },
    });
    if (!parsed) throw new Error("devoir attendu");
    expect(allAssignmentAttachments(parsed)).toHaveLength(10);
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

  test("un minuit Paris (PourLe sans heure) est une échéance sans heure (#781)", () => {
    // Forme RÉELLE de `HomeworkPayloads` : `parisIso()` d'un `PourLe` sans
    // heure, pas une date seule fabriquée à la main.
    expect(isAllDayDue("2026-11-01T00:00+01:00")).toBe(true);
    expect(isAllDayDue("2026-11-01T00:00:00+01:00")).toBe(true);
    expect(isAllDayDue("2026-11-01T00:30+01:00")).toBe(false);
    // Minuit UTC = 01:00 à Paris : une heure réelle, pas une journée entière.
    expect(isAllDayDue("2026-11-01T00:00:00Z")).toBe(false);
    expect(dueLabel("2026-11-01T00:00+01:00")).toBe("dimanche 1 novembre");
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

  test("le résumé ne dit « cette semaine » que sur la semaine courante", () => {
    expect(taskWeekSuffixFr("2026-10-19", "2026-10-19")).toBe("cette semaine");
    expect(taskWeekSuffixFr("2026-10-26", "2026-10-19")).toBe("pour la semaine du 26 oct.");
    expect(taskWeekSuffixFr("2026-11-02", "2026-10-19")).toBe("pour la semaine du 2 nov.");
    // Une semaine illisible ne revendique pas la semaine courante.
    expect(taskWeekSuffixFr("illisible", "2026-10-19")).toBe("pour la semaine affichée");
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
