import { useParisTz } from "./setup";

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  algorithmHint,
  computeAverages,
  coverageLabel,
  formatMark,
  gradeContextLabel,
  gradeGroups,
  gradeLabel,
  gradeValueLabel,
  gradesForPeriod,
  gradesQuery,
  historyNote,
  influenceLabel,
  isGradesPayloadReadable,
  originLabel,
  parseGradesPayload,
  parsePeriods,
  reportTitle,
  scaleSuffix,
  sparklineAverageY,
  sparklineDescription,
  sparklinePoints,
  subjectAlgorithmAverage,
  type AveragesReport,
  type Grade,
  type SubjectAverage,
} from "../../web/src/features/grades/model";
import {
  GradesHero,
  GradesNoData,
  GradesScreen,
  GradesSubjectSections,
  Sparkline,
} from "../../web/src/features/grades/components";
import {
  invalidateOnRequestChange,
  requestId,
  visibleResource,
  type ResourceStatus,
} from "../../web/src/lib/resource";

useParisTz();

const ROOT = join(import.meta.dir, "..", "..");

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

  test("une moyenne négative du rapport est ABSENTE, jamais affichée", () => {
    const payload = JSON.stringify({
      averages: {
        algorithm: "subject",
        general: { value: -3, origin: "provided", subjectCount: 1 },
        subjects: [{ subject: "Maths", value: -2, origin: "provided", gradeCount: 1 }],
        history: [{ date: "2026-10-01T00:00:00.000Z", value: -1 }],
        influences: [],
      },
      grades: [],
    });
    const data = parseGradesPayload(payload);
    expect(data.report?.generalValue).toBeNull();
    expect(data.report?.subjects[0]?.value).toBeNull();
    expect(data.report?.history[0]?.value).toBeNull();
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

  test("la médiane porte sur TOUTES les notes, pas sur chaque matière", () => {
    // Médiane par matière (A=10, B=20 → 15) vs toutes les notes (0, 20, 20 → 20) :
    // l'aide doit décrire le calcul RÉEL.
    const grades = [
      grade({ subject: "A", value: 0 }),
      grade({ subject: "A", value: 20 }),
      grade({ subject: "B", value: 20 }),
    ];
    expect(subjectAlgorithmAverage(grades)).toBe(15);
    expect(computeAverages(grades, "median").generalValue).toBe(20);
    expect(algorithmHint("median")).toContain("toutes les notes");
    expect(algorithmHint("median")).not.toContain("chaque matière");
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

// Une moyenne publiée par l'établissement ne dépend PAS de l'algorithme choisi :
// l'écran ne doit pas afficher « Médiane » au-dessus du chiffre fourni. La courbe
// et les influences, elles, restent des estimations.
describe("moyenne fournie par l'établissement : l'écran ne ment pas", () => {
  const report: AveragesReport = {
    algorithm: "median",
    generalValue: 12.5,
    provided: true,
    subjectCount: 2,
    subjects: [
      { subject: "Maths", value: 12, provided: true, gradeCount: 1 },
      { subject: "NSI", value: 13, provided: true, gradeCount: 2 },
    ],
    history: [
      { date: "2026-10-01T08:00:00.000Z", value: 11 },
      { date: "2026-10-08T08:00:00.000Z", value: 14 },
    ],
    influences: [{ gradeId: "g1", subject: "Maths", impact: 0.42 }],
  };

  test("titre et provenance décrivent une moyenne publiée, pas un algorithme", () => {
    expect(reportTitle(report)).toBe("Moyenne générale");
    expect(originLabel(true, null)).toBe("publiée par l'établissement");
  });

  test("l'aide dit que seules la courbe et les influences sont estimées", () => {
    const hint = algorithmHint("median", true);
    expect(hint).toContain("établissement");
    expect(hint).toContain("estimées");
    expect(hint).not.toContain("médiane");
  });

  test("courbe et influences sont annoncées comme estimées", () => {
    expect(historyNote([11, 14], true)).toContain("Courbe estimée");
    expect(sparklineDescription([11, 14], true)).toBe("Évolution estimée de la moyenne : de 11 à 14.");
    expect(influenceLabel(0.42, true)).toBe("+0,42 sur la moyenne estimée");
    expect(influenceLabel(0, true)).toBe("Sans effet sur la moyenne estimée");
    expect(historyNote([11, 14])).toBe("");
    expect(influenceLabel(0.42)).toBe("+0,42 sur la moyenne");
  });

  test("le héros porte le titre, la provenance, la couverture et la mention de courbe", () => {
    const html = renderToStaticMarkup(createElement(GradesHero, { report }));
    expect(html).toContain("Moyenne générale");
    expect(html).not.toContain("Médiane des notes");
    expect(html).toContain("publiée par l&#x27;établissement");
    expect(html).toContain("2 matières · 3 notes");
    expect(html).toContain("Courbe estimée à partir des notes");
    expect(html).toContain("Évolution estimée de la moyenne");
  });

  test("la couverture compte les matières et les notes retenues", () => {
    expect(coverageLabel(report)).toBe("2 matières · 3 notes");
    expect(coverageLabel({ ...report, subjectCount: 1, subjects: [report.subjects[0]!] })).toBe("1 matière · 1 note");
    expect(coverageLabel({ ...report, subjectCount: 0, subjects: [] })).toBe("");
  });

  test("l'écran de Notes annonce une moyenne fournie et des influences estimées", () => {
    const payload = JSON.stringify({
      averages: {
        algorithm: "median",
        general: { value: 12.5, origin: "provided", subjectCount: 1 },
        subjects: [{ subject: "Maths", value: 12, origin: "provided", gradeCount: 1 }],
        history: [
          { date: "2026-10-01T08:00:00.000Z", value: 11 },
          { date: "2026-10-08T08:00:00.000Z", value: 14 },
        ],
        influences: [{ gradeId: "g1", subject: "Maths", impact: 0.42 }],
      },
      grades: [
        { id: "g1", subject: "Maths", value: 12, scale: 20, date: "2026-10-01T08:00:00.000Z" },
      ],
    });
    const html = renderToStaticMarkup(
      createElement(GradesScreen, {
        payload,
        loading: false,
        error: null,
        stale: false,
        periodsError: null,
        algorithm: "median",
        periodId: null,
        periods: [],
        dark: false,
        onAlgorithm: () => {},
        onPeriod: () => {},
        onRefresh: () => {},
      }),
    );
    expect(html).toContain("Moyenne générale");
    expect(html).not.toContain("Médiane des notes");
    expect(html).toContain("Moyenne publiée par l&#x27;établissement ; la courbe et les influences sont estimées.");
    expect(html).toContain("+0,42 sur la moyenne estimée");
    expect(html).toContain("Courbe estimée à partir des notes");
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

  test("une matière ABSENTE du rapport est estimée localement", () => {
    const grades = [
      grade({ subject: "Maths", value: 12 }),
      grade({ subject: "NSI", value: 16 }),
    ];
    const report: SubjectAverage[] = [{ subject: "Maths", value: 12, provided: true, gradeCount: 1 }];
    const groups = gradeGroups(grades, report);
    const nsi = groups.find((group) => group.subject === "NSI");
    // Le rapport ne dit rien de NSI : estimer vaut mieux que « Pas de moyenne ».
    expect(nsi?.average).toBe(16);
    expect(nsi?.provided).toBe(false);
    expect(nsi?.gradeCount).toBe(1);
  });

  test("une entrée du rapport à null fait foi : pas de repli local", () => {
    const grades = [
      grade({ subject: "Maths", value: 12 }),
      grade({ subject: "NSI", value: 16 }),
    ];
    const report: SubjectAverage[] = [
      { subject: "Maths", value: 12, provided: true, gradeCount: 1 },
      { subject: "NSI", value: null, provided: false, gradeCount: 0 },
    ];
    const nsi = gradeGroups(grades, report).find((group) => group.subject === "NSI");
    expect(nsi?.average).toBeNull();
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
      teacher: "Mme Leroy",
      bonus: true,
      optional: true,
    });
    expect(gradeContextLabel(full)).toBe(
      "Coeff. 2 · Bonus · Facultatif · Mme Leroy · Moyenne de classe 11,8 · De 4 à 19",
    );
    expect(gradeContextLabel(grade({ subject: "Maths", value: 15 }))).toBe("");
    expect(gradeLabel(grade({ subject: "Maths", value: 15 }))).toBe("Maths");
    expect(gradeLabel(grade({ subject: "Maths", value: 15, label: "DS" }))).toBe("DS");
  });
});

describe("compteur de notes — les notes RETENUES (coefficient 0 exclu)", () => {
  // Le rapport natif publie `gradeCount` = notes retenues (coefficient 0 exclu) ;
  // l'écran doit afficher ce compte, pas le nombre de notes listées.
  const grades = [
    grade({ subject: "Maths", value: 12, coefficient: 1 }),
    grade({ subject: "Maths", value: 8, coefficient: 0 }),
  ];
  const report: AveragesReport = {
    algorithm: "subject",
    generalValue: 12,
    provided: true,
    subjectCount: 1,
    subjects: [{ subject: "Maths", value: 12, provided: true, gradeCount: 1 }],
    history: [],
    influences: [],
  };

  test("la carte d'une matière annonce le compte du rapport, pas la liste", () => {
    const groups = gradeGroups(grades, report.subjects);
    expect(groups[0]?.gradeCount).toBe(1);
    expect(groups[0]?.grades).toHaveLength(2);
    const html = renderToStaticMarkup(createElement(GradesSubjectSections, { groups, report }));
    expect(html).toContain("1 note");
    expect(html).not.toContain("2 notes");
  });

  test("sans rapport, le compte local exclut les coefficients nuls", () => {
    const groups = gradeGroups(grades, []);
    expect(groups[0]?.gradeCount).toBe(1);
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
    expect(sparklineAverageY([10, 14, 18], 88)).toBe(44);
    expect(sparklineAverageY([10, 18, 20], 88)).toBeCloseTo(35.2, 5);
    // Séries inexploitables : une seule valeur, série plate, hauteur nulle.
    expect(sparklineAverageY([12], 88)).toBeNull();
    expect(sparklineAverageY([12, 12, 12], 88)).toBeNull();
    expect(sparklineAverageY([10, 20], 0)).toBeNull();
    expect(sparklineAverageY([null, null], 88)).toBeNull();
  });
});

// Le `viewBox` doit suivre la largeur mesurée : un cadre fixe étiré par
// `preserveAspectRatio="none"` aplatit la courbe et transforme la pastille
// (remplissage, insensible à `vector-effect`) en ellipse. Le dessin est RENDU
// par `react-dom/server` : c'est ce que l'élève voit.
describe("sparkline — le dessin reste net, quelle que soit la largeur (#568)", () => {
  const VALUES = [10, 12, 11, 15, 14, 18];
  const CSS = readFileSync(join(ROOT, "web/src/features/grades/grades.css"), "utf8");

  function render(width: number): string {
    return renderToStaticMarkup(createElement(Sparkline, { values: VALUES, width }));
  }

  test("le viewBox suit la largeur mesurée : plus d'échelle non uniforme", () => {
    const html = render(480);
    expect(html).toContain('viewBox="0 0 480 96"');
    expect(html).toContain('cx="480"');
    // L'étirement non uniforme est la cause de la déformation.
    expect(html).not.toContain('preserveAspectRatio="none"');
  });

  test("la pastille et son halo ne s'appuient pas sur `vector-effect`", () => {
    const html = render(480);
    // `vector-effect` ne s'applique qu'aux TRAITS : sur un remplissage, il ne
    // fait rien et la pastille suivrait l'étirement.
    expect(html).not.toContain("vector-effect");
    expect(html).not.toContain("non-scaling-stroke");
    expect(html).toContain('class="grades-chart__dot"');
    expect(html).toContain('r="3.5"');
  });

  test("le tracé progressif couvre TOUTE la courbe", () => {
    const html = render(480);
    // `pathLength={1}` : une unité de trait = la courbe entière.
    expect(html).toContain('pathLength="1"');
    const rule = /\.grades-chart__line\s*\{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? "";
    // Les commentaires CSS ne sont pas des déclarations.
    const declarations = rule.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(declarations).toContain("stroke-dasharray: 1");
    expect(declarations).toContain("stroke-dashoffset: 1");
    // Un trait non scalable ramènerait les cotes à l'écran : le tracé ne
    // couvrirait plus la courbe entière.
    expect(declarations).not.toContain("non-scaling-stroke");
  });

  test("le graphe du héros ne déborde pas sur la moyenne", () => {
    const graph = /\.grades-hero__graph\s*\{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? "";
    // Le cadre ferme la courbe : le point du dernier relevé ne peut plus
    // chevaucher le chiffre de moyenne, même au plus bas.
    expect(graph).toContain("overflow: hidden");
    expect(graph).not.toContain("margin-bottom: -");
  });

  test("le graphique s'assemble en un seul geste", () => {
    const block = CSS.slice(CSS.indexOf(".grades-chart {"), CSS.indexOf("@keyframes chart-draw"));
    const delays = [...block.matchAll(/animation:\s*[^;]+;/g)].map((match) => {
      const times = [...match[0].matchAll(/(\d+)ms/g)].map((time) => Number(time[1]));
      return times[1] ?? 0;
    });
    expect(delays.length).toBe(5);
    // Toutes les pièces partent ensemble : plus de « montage » d'une seconde.
    expect(Math.max(...delays)).toBeLessThanOrEqual(600);
  });
});

// Un payload CORROMPU (JSON illisible) ne doit JAMAIS être présenté comme une
// absence de note (I14 : « invalide » n'est jamais « vide »). L'écran est RENDU
// par `react-dom/server` : c'est ce que l'élève voit.
describe("notes : un cache illisible est une ERREUR, pas un état vide (#537)", () => {
  function renderNoData(payload: string | null, loading = false): string {
    return renderToStaticMarkup(
      createElement(GradesNoData, { payload, loading, error: null, onRefresh: () => {} }),
    );
  }

  test("payload corrompu : une erreur, PAS « aucune note en cache »", () => {
    const html = renderNoData("{ceci n'est pas du json");
    expect(html).toContain("illisible");
    // L'état vide affirmerait un fait faux : les notes sont illisibles.
    expect(html).not.toContain("Aucune note en cache");
  });

  test("payload lisible sans note : l'état vide est honnête", () => {
    const html = renderNoData('{"grades":[]}');
    expect(html).toContain("Aucune note en cache");
    expect(html).not.toContain("illisible");
  });

  test("aucun payload : « Notes indisponibles », pas un cache vide", () => {
    expect(renderNoData(null, true)).toContain("Chargement des notes");
    const loaded = renderNoData(null);
    expect(loaded).toContain("Notes indisponibles");
    expect(loaded).not.toContain("Aucune note en cache");
  });

  test("le prédicat distingue le payload illisible du payload lisible", () => {
    expect(isGradesPayloadReadable("pas du json")).toBe(false);
    expect(isGradesPayloadReadable("[]")).toBe(false);
    expect(isGradesPayloadReadable("{}")).toBe(true);
    expect(isGradesPayloadReadable('{"grades":[]}')).toBe(true);
    expect(isGradesPayloadReadable(null)).toBe(false);
  });
});

// Un changement de requête INVALIDE le payload précédent : sinon l'écran recalcule
// le rapport sur l'ANCIEN payload avec la NOUVELLE période, et un chargement en
// échec laisse l'ancien rapport affiché indéfiniment. L'écran est RENDU par
// `react-dom/server` : c'est ce que l'élève voit.
describe("notes : un changement de requête invalide le payload précédent (#527)", () => {
  const PERIOD_1 = "algorithm=subject&periodId=p1";
  const PERIOD_2 = "algorithm=subject&periodId=p2";

  const payloadP1 = JSON.stringify({
    averages: {
      algorithm: "subject",
      general: { value: 12, origin: "provided", subjectCount: 1 },
      subjects: [{ subject: "Maths", value: 12, origin: "provided", gradeCount: 1 }],
      history: [{ date: "2026-10-01T00:00:00.000Z", value: 12 }],
      influences: [],
    },
    grades: [
      { id: "g1", subject: "Maths", value: 12, scale: 20, date: "2026-10-01T08:00:00.000Z", periodId: "p1" },
    ],
  });

  const payloadP2 = JSON.stringify({
    averages: {
      algorithm: "subject",
      general: { value: 16, origin: "provided", subjectCount: 1 },
      subjects: [{ subject: "Maths", value: 16, origin: "provided", gradeCount: 1 }],
      history: [{ date: "2026-10-08T00:00:00.000Z", value: 16 }],
      influences: [],
    },
    grades: [
      { id: "g2", subject: "Maths", value: 16, scale: 20, date: "2026-10-08T08:00:00.000Z", periodId: "p2" },
    ],
  });

  const periods = [{ id: "p1", name: "Trimestre 1", start: null, end: null }];

  function render(status: ResourceStatus, request: string, periodId: string | null): string {
    const view = visibleResource(status, request);
    return renderToStaticMarkup(
      createElement(GradesScreen, {
        payload: view.payload,
        loading: view.loading,
        error: view.error,
        stale: view.stale,
        periodsError: null,
        algorithm: "subject",
        periodId,
        periods,
        dark: false,
        onAlgorithm: () => {},
        onPeriod: () => {},
        onRefresh: () => {},
      }),
    );
  }

  test("changer de période : l'héro ne montre plus la moyenne de la période précédente", () => {
    const request1 = requestId("grades", PERIOD_1);
    const request2 = requestId("grades", PERIOD_2);
    const loaded: ResourceStatus = {
      request: request1,
      payload: payloadP1,
      fetchedAt: 1,
      stale: false,
      error: null,
      loading: false,
    };
    // La période 1 est bien affichée…
    expect(render(loaded, request1, "p1")).toContain("12,00");

    const changed = invalidateOnRequestChange(loaded, request2);
    const html = render(changed, request2, "p2");
    expect(html).not.toContain("12,00");
    expect(html).toContain("Chargement des notes");

    const reloaded: ResourceStatus = {
      request: request2,
      payload: payloadP2,
      fetchedAt: 2,
      stale: false,
      error: null,
      loading: false,
    };
    const after = render(reloaded, request2, "p2");
    expect(after).toContain("16,00");
    expect(after).not.toContain("12,00");
  });

  test("un chargement en échec n'affiche JAMAIS le payload d'une autre requête", () => {
    const request1 = requestId("grades", PERIOD_1);
    const request2 = requestId("grades", PERIOD_2);
    const loaded: ResourceStatus = {
      request: request1,
      payload: payloadP1,
      fetchedAt: 1,
      stale: false,
      error: null,
      loading: false,
    };
    // La requête change et le chargement échoue : l'ancien rapport ne doit pas
    // rester affiché sous la nouvelle période.
    const failed: ResourceStatus = {
      ...invalidateOnRequestChange(loaded, request2),
      loading: false,
      error: "Lecture indisponible.",
    };
    const html = render(failed, request2, "p2");
    expect(html).not.toContain("12,00");
    expect(html).toContain("Lecture indisponible.");
    expect(visibleResource(failed, request1).payload).toBeNull();
  });

  test("un rafraîchissement de la MÊME requête garde le cache affiché", () => {
    const request1 = requestId("grades", PERIOD_1);
    const loaded: ResourceStatus = {
      request: request1,
      payload: payloadP1,
      fetchedAt: 1,
      stale: false,
      error: null,
      loading: false,
    };
    // Le geste « Actualiser » ne change pas la requête : le cache reste là.
    expect(invalidateOnRequestChange(loaded, request1).payload).toBe(payloadP1);
    expect(visibleResource(loaded, request1).payload).toBe(payloadP1);
  });

  test("le câblage invalide le payload au changement de requête", () => {
    const source = readFileSync(join(ROOT, "web/src/ui/AppContext.tsx"), "utf8");
    expect(source).toContain("invalidateOnRequestChange");
    expect(source).toContain("visibleResource");
  });
});
