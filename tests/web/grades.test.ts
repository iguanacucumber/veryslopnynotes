import { useParisTz } from "./setup";

import { describe, expect, test } from "bun:test";
import {
  algorithmHint,
  computeAverages,
  formatMark,
  gradeContextLabel,
  gradeGroups,
  gradeLabel,
  gradeValueLabel,
  gradesForPeriod,
  gradesQuery,
  historyNote,
  influenceLabel,
  parseGradesPayload,
  parsePeriods,
  scaleSuffix,
  sparklineAverageY,
  sparklineDescription,
  sparklinePoints,
  subjectAlgorithmAverage,
  type Grade,
} from "../../web/src/features/grades/model";

useParisTz();

let seq = 0;

function grade(overrides: Partial<Grade> & Pick<Grade, "subject" | "value">): Grade {
  seq += 1;
  const { subject, value, ...rest } = overrides;
  return {
    id: `g${seq}`,
    subject,
    value,
    scale: 20,
    coefficient: null,
    date: "2026-10-01T08:00:00.000Z",
    millis: Date.parse("2026-10-01T08:00:00.000Z"),
    classAverage: null,
    classMin: null,
    classMax: null,
    periodId: null,
    bonus: false,
    optional: false,
    label: null,
    teacher: null,
    ...rest,
  };
}

describe("parseGradesPayload", () => {
  test("lit la forme réelle { grades, averages }", () => {
    const payload = JSON.stringify({
      averages: {
        algorithm: "weighted",
        general: { value: 14.5, origin: "provided", subjectCount: 2 },
        subjects: [{ subject: "Maths", value: 15, origin: "provided", gradeCount: 2 }],
        history: [{ date: "2026-10-01T00:00:00.000Z", value: 12 }],
        influences: [{ gradeId: "g1", subject: "Maths", impact: 0.42 }],
      },
      grades: [
        {
          id: "g1",
          subject: "Maths",
          value: 15,
          scale: 20,
          coefficient: 2,
          date: "2026-10-01T08:00:00.000Z",
          classAverage: 11.8,
          classMin: 4,
          classMax: 19,
          periodId: "p1",
        },
      ],
    });
    const data = parseGradesPayload(payload, "subject", null);
    expect(data.grades).toHaveLength(1);
    expect(data.grades[0]?.label).toBeNull();
    expect(data.report?.algorithm).toBe("weighted");
    expect(data.report?.provided).toBe(true);
    expect(data.report?.generalValue).toBe(14.5);
    expect(data.report?.subjects[0]?.subject).toBe("Maths");
    expect(data.report?.history).toHaveLength(1);
    expect(data.report?.influences[0]?.impact).toBe(0.42);
  });

  test("accepte la forme du pont de développement { items } et recalcule", () => {
    const payload = JSON.stringify({
      items: [
        { id: "a", subject: "Maths", value: 10, scale: 20, date: "2026-10-01T08:00:00.000Z", periodId: "p1" },
        { id: "b", subject: "Maths", value: 20, scale: 20, date: "2026-10-02T08:00:00.000Z", periodId: "p1" },
      ],
    });
    const data = parseGradesPayload(payload, "subject", "p1");
    expect(data.grades).toHaveLength(2);
    expect(data.report?.provided).toBe(false);
    expect(data.report?.generalValue).toBe(15);
    expect(data.report?.history.map((point) => point.value)).toEqual([10, 15]);
  });

  test("JSON invalide, null ou sans tableau : aucune note, aucun crash", () => {
    expect(parseGradesPayload(null)).toEqual({ grades: [], report: null });
    expect(parseGradesPayload("pas du json")).toEqual({ grades: [], report: null });
    expect(parseGradesPayload("{}")).toEqual({ grades: [], report: null });
    expect(parseGradesPayload('{"grades":"nope"}')).toEqual({ grades: [], report: null });
  });

  test("écarte les notes incohérentes et borne les textes", () => {
    const longSubject = "s".repeat(101);
    const payload = JSON.stringify({
      grades: [
        { id: "ok", subject: "Maths", value: 10, scale: 20, date: "2026-10-01T08:00:00.000Z" },
        { id: "neg", subject: "Maths", value: -1, scale: 20, date: "2026-10-01T08:00:00.000Z" },
        { id: "scale", subject: "Maths", value: 10, scale: 0, date: "2026-10-01T08:00:00.000Z" },
        { id: "date", subject: "Maths", value: 10, scale: 20, date: "hier" },
        { id: "subject", subject: longSubject, value: 10, scale: 20, date: "2026-10-01T08:00:00.000Z" },
        { id: "text", subject: "Maths", value: "abc", scale: 20, date: "2026-10-01T08:00:00.000Z" },
      ],
    });
    const data = parseGradesPayload(payload);
    expect(data.grades.map((g) => g.id)).toEqual(["ok"]);
    // `JSON.stringify` transforme Infinity en null : la borne se teste en JSON brut.
    const raw = '{"grades":[{"id":"inf","subject":"Maths","value":1e999,"scale":20,"date":"2026-10-01T08:00:00.000Z"}]}';
    expect(parseGradesPayload(raw).grades).toEqual([]);
  });

  test("nettoie les caractères de contrôle et borne le libellé", () => {
    const payload = JSON.stringify({
      grades: [
        {
          id: "g1",
          subject: "Maths",
          value: 10,
          scale: 20,
          date: "2026-10-01T08:00:00.000Z",
          label: `DS\u0000 de maths`,
          teacher: "t".repeat(101),
        },
      ],
    });
    const data = parseGradesPayload(payload);
    expect(data.grades[0]?.label).toBe("DS de maths");
    expect(data.grades[0]?.teacher).toBeNull();
  });
});

describe("algorithmes (parité core/Averages.kt)", () => {
  test("moyenne des matières vs pondérée", () => {
    const grades = [
      grade({ subject: "Maths", value: 10 }),
      grade({ subject: "Maths", value: 20 }),
      grade({ subject: "NSI", value: 10, coefficient: 5 }),
    ];
    expect(subjectAlgorithmAverage(grades)).toBeCloseTo(12.5, 5);
    expect(computeAverages(grades, "subject").generalValue).toBeCloseTo(12.5, 5);
    expect(computeAverages(grades, "weighted").generalValue).toBeCloseTo((80 / 140) * 20, 5);
  });

  test("médiane des notes ramenées sur /20, bonus ignorés", () => {
    const grades = [
      grade({ subject: "A", value: 10 }),
      grade({ subject: "B", value: 20 }),
      grade({ subject: "C", value: 10, bonus: true }),
    ];
    // Le bonus vaut 10 : s'il était compté, la médiane serait 10.
    expect(computeAverages(grades, "median").generalValue).toBe(15);
  });

  test("coefficient 0 exclut la note", () => {
    const grades = [
      grade({ subject: "Maths", value: 0, coefficient: 0 }),
      grade({ subject: "Maths", value: 10, coefficient: 1 }),
    ];
    expect(computeAverages(grades, "weighted").generalValue).toBe(10);
  });

  test("une note facultative n'est retenue que si elle améliore la moyenne", () => {
    const improves = [
      grade({ subject: "Maths", value: 10 }),
      grade({ subject: "Maths", value: 20, optional: true }),
    ];
    expect(computeAverages(improves, "subject").generalValue).toBeCloseTo(15, 5);

    const lowers = [
      grade({ subject: "Maths", value: 15 }),
      grade({ subject: "Maths", value: 5, optional: true }),
    ];
    expect(computeAverages(lowers, "subject").generalValue).toBeCloseTo(15, 5);
  });

  test("période choisie : notes et rapport sont cadrés dessus", () => {
    const grades = [
      grade({ subject: "Maths", value: 10, periodId: "p1" }),
      grade({ subject: "Maths", value: 20, periodId: "p2" }),
    ];
    expect(computeAverages(grades, "subject", "p1").generalValue).toBe(10);
    expect(computeAverages(grades, "subject", "p2").generalValue).toBe(20);
    expect(computeAverages(grades, "subject", null).generalValue).toBe(15);
  });

  test("influences : écart avec / sans la note", () => {
    const grades = [
      grade({ id: "low", subject: "Maths", value: 10 }),
      grade({ id: "high", subject: "Maths", value: 20 }),
    ];
    const report = computeAverages(grades, "subject");
    const high = report.influences.find((i) => i.gradeId === "high");
    const low = report.influences.find((i) => i.gradeId === "low");
    expect(high?.impact).toBe(5);
    expect(low?.impact).toBe(-5);
  });

  test("aucune note exploitable : moyenne null, jamais 0", () => {
    expect(computeAverages([], "subject").generalValue).toBeNull();
    expect(computeAverages([grade({ subject: "Maths", value: 10, coefficient: 0 })], "subject").generalValue).toBeNull();
  });
});

describe("sélection et regroupement", () => {
  test("gradesForPeriod garde tout si aucun periodId n'est publié", () => {
    const grades = [grade({ subject: "A", value: 1 }), grade({ subject: "B", value: 2 })];
    expect(gradesForPeriod(grades, "p1")).toHaveLength(2);
  });

  test("gradesForPeriod filtre quand l'établissement publie l'appartenance", () => {
    const grades = [
      grade({ subject: "A", value: 1, periodId: "p1" }),
      grade({ subject: "B", value: 2, periodId: "p2" }),
    ];
    expect(gradesForPeriod(grades, "p1")).toHaveLength(1);
    expect(gradesForPeriod(grades, "p3")).toHaveLength(0);
    expect(gradesForPeriod(grades, null)).toHaveLength(2);
  });

  test("gradeGroups trie par moyenne décroissante puis par nom", () => {
    const grades = [
      grade({ subject: "Maths", value: 10 }),
      grade({ subject: "NSI", value: 20 }),
      grade({ subject: "Sans moyenne", value: 10, coefficient: 0 }),
    ];
    const report = computeAverages(grades, "subject");
    const groups = gradeGroups(grades, report.subjects);
    expect(groups.map((g) => g.subject)).toEqual(["NSI", "Maths", "Sans moyenne"]);
    expect(groups[2]?.average).toBeNull();
  });

  test("gradesQuery valide l'algorithme et borne la période", () => {
    expect(gradesQuery("weighted", null)).toBe("algorithm=weighted");
    expect(gradesQuery("median", "p/1")).toBe("algorithm=median&periodId=p%2F1");
    expect(gradesQuery("subject", `  ${"x".repeat(70)}  `)).toBe(`algorithm=subject&periodId=${"x".repeat(64)}`);
  });
});

describe("parsePeriods", () => {
  test("lit la forme réelle et la forme { items }", () => {
    const real = parsePeriods(
      JSON.stringify({
        periods: [
          { id: "p1", name: "Trimestre 1", start: "2026-09-01T00:00:00.000Z", end: "2026-12-05T00:00:00.000Z" },
        ],
      }),
    );
    expect(real).toEqual([
      { id: "p1", name: "Trimestre 1", start: "2026-09-01T00:00:00.000Z", end: "2026-12-05T00:00:00.000Z" },
    ]);
    const mock = parsePeriods(JSON.stringify({ items: [{ id: "p2", name: "Trimestre 2" }] }));
    expect(mock).toEqual([{ id: "p2", name: "Trimestre 2", start: null, end: null }]);
  });

  test("écarte une tranche incohérente ou sans nom", () => {
    const periods = parsePeriods(
      JSON.stringify({
        periods: [
          { id: "bad", name: "Inversée", start: "2026-12-01T00:00:00.000Z", end: "2026-09-01T00:00:00.000Z" },
          { id: "noname", name: "" },
          { id: "ok", name: "Semestre 1" },
        ],
      }),
    );
    expect(periods.map((p) => p.id)).toEqual(["ok"]);
  });
});

describe("mise en forme", () => {
  test("valeurs et barèmes français", () => {
    expect(formatMark(14.5)).toBe("14,50");
    expect(gradeValueLabel(15)).toBe("15");
    expect(gradeValueLabel(15.5)).toBe("15,5");
    expect(gradeValueLabel(15.25)).toBe("15,25");
    expect(scaleSuffix(20)).toBe("/20");
    expect(scaleSuffix(10)).toBe("/10");
    expect(scaleSuffix(0)).toBe("");
    expect(influenceLabel(0.42)).toBe("+0,42 sur la moyenne");
    expect(influenceLabel(-0.3)).toBe("−0,30 sur la moyenne");
    expect(influenceLabel(0)).toBe("Sans effet sur la moyenne");
  });

  test("chaque algorithme a une explication courte et distincte", () => {
    const hints = [algorithmHint("subject"), algorithmHint("weighted"), algorithmHint("median")];
    expect(hints.every((hint) => hint.length > 10)).toBe(true);
    expect(new Set(hints).size).toBe(3);
  });

  test("contexte de note borné à ce qui est publié", () => {
    const full = grade({
      subject: "Maths",
      value: 15,
      coefficient: 2,
      classAverage: 11.8,
      classMin: 4,
      classMax: 19,
      teacher: "Mme Touron",
      bonus: true,
      optional: true,
    });
    expect(gradeContextLabel(full)).toBe(
      "Coeff. 2 · Bonus · Facultatif · Mme Touron · Moyenne de classe 11,8 · De 4 à 19",
    );
    expect(gradeContextLabel(grade({ subject: "Maths", value: 15 }))).toBe("");
    expect(gradeLabel(grade({ subject: "Maths", value: 15 }))).toBe("Maths");
    expect(gradeLabel(grade({ subject: "Maths", value: 15, label: "DS" }))).toBe("DS");
  });
});

describe("sparkline", () => {
  test("aucune valeur ou une seule valeur", () => {
    expect(sparklinePoints([], 320, 88)).toEqual([]);
    expect(sparklinePoints([null, null], 320, 88)).toEqual([]);
    expect(sparklinePoints([12], 320, 88)).toEqual([{ x: 320, y: 44 }]);
    expect(sparklinePoints([12], 0, 88)).toEqual([]);
  });

  test("deux valeurs : extrêmes du cadre, y inversé", () => {
    const points = sparklinePoints([10, 20], 320, 88);
    expect(points).toEqual([
      { x: 0, y: 88 },
      { x: 320, y: 0 },
    ]);
  });

  test("valeurs égales : ligne à mi-hauteur sans division par zéro", () => {
    expect(sparklinePoints([12, 12, 12], 320, 88).map((p) => p.y)).toEqual([44, 44, 44]);
  });

  test("phrases d'historique et description accessible", () => {
    expect(historyNote([])).toContain("Pas d'historique");
    expect(historyNote([12])).toContain("Une seule moyenne");
    expect(historyNote([12, 14])).toBe("");
    expect(sparklineDescription([12, 14])).toBe("Évolution de la moyenne : de 12 à 14.");
  });

  test("ligne de moyenne : même échelle que la courbe, rien si elle n'apprend rien", () => {
    // 10 → 20 : la moyenne 15 tombe à mi-hauteur du cadre.
    expect(sparklineAverageY([10, 20], 88)).toBe(44);
    // 10 → 14 → 18 : moyenne 14, encore à mi-hauteur (l'échelle est min..max).
    expect(sparklineAverageY([10, 14, 18], 88)).toBe(44);
    // 10 → 18 → 20 : moyenne 16, donc sous le milieu du cadre.
    expect(sparklineAverageY([10, 18, 20], 88)).toBeCloseTo(35.2, 5);
    // Séries inexploitables : une seule valeur, série plate, hauteur nulle.
    expect(sparklineAverageY([12], 88)).toBeNull();
    expect(sparklineAverageY([12, 12, 12], 88)).toBeNull();
    expect(sparklineAverageY([10, 20], 0)).toBeNull();
    expect(sparklineAverageY([null, null], 88)).toBeNull();
  });
});
