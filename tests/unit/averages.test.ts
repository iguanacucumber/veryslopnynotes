import { describe, expect, test } from "bun:test";
import {
  MAX_AVERAGE_POINTS,
  averageWith,
  computeAverages,
  medianAlgorithmAverage,
  providedAveragesFor,
  subjectAlgorithmAverage,
  subjectAverage,
  subjectKey,
  weightedAlgorithmAverage,
} from "../../server/domain/averages";
import type { Grade } from "../../shared/contracts/models";

// Parité Papillon (#74). Les valeurs de référence ci-dessous sont produites par
// le code upstream papillon.bzh (utils/grades/algorithms/{subject,weighted,
// median,time}.ts + app/(tabs)/grades/hooks/useGradeInfluence.ts) exécuté sur
// la fixture `GRADES`. Recalcul : bun run tests/unit/averages.test.ts.
// Tolérance 1e-9 (arrondis upstream à 2 décimales côté UI uniquement).

const grade = (over: Partial<Grade> & Pick<Grade, "id" | "subject" | "value" | "scale">): Grade => ({
  accountId: "acc",
  date: "2026-09-20T10:00:00.000Z",
  coefficient: 1,
  ...over,
});

const GRADES: Grade[] = [
  grade({ id: "m1", subject: "Maths", value: 15, scale: 20, date: "2026-09-01T10:00:00.000Z" }),
  grade({ id: "m2", subject: "Maths", value: 10, scale: 20, date: "2026-09-10T10:00:00.000Z" }),
  grade({ id: "a1", subject: "Anglais", value: 12, scale: 20, coefficient: 2, date: "2026-09-05T10:00:00.000Z" }),
  grade({
    id: "f1",
    subject: "EPS",
    value: 18,
    scale: 20,
    optional: true,
    date: "2026-09-12T10:00:00.000Z",
  }),
  grade({ id: "s1", subject: "SVT", value: 7, scale: 10, date: "2026-09-15T10:00:00.000Z" }),
  grade({
    id: "b1",
    subject: "Arts",
    value: 20,
    scale: 20,
    bonus: true,
    date: "2026-09-20T10:00:00.000Z",
  }),
];

const EPS = 1e-9;

describe("moyennes parité Papillon (#74)", () => {
  test("moyenne par matière : pondération coef, /10 ramené sur /20", () => {
    const bySubject = (s: string) => GRADES.filter((g) => g.subject === s);
    expect(subjectAverage(bySubject("Maths"))).toBeCloseTo(12.5, 9);
    expect(subjectAverage(bySubject("Anglais"))).toBeCloseTo(12, 9);
    expect(subjectAverage(bySubject("EPS"))).toBeCloseTo(18, 9);
    // 7/10 -> 14/20 (ramené, Papillon garde la valeur en clair : 7/10 puis *20/10)
    expect(subjectAverage(bySubject("SVT"))).toBeCloseTo(14, 9);
    // bonus 20/20 -> (20 - 20/2) = 10 sur 1 point de barème
    expect(subjectAverage(bySubject("Arts"))).toBeCloseTo(20, 9);
  });

  test("3 algorithmes : valeurs de référence upstream", () => {
    expect(subjectAlgorithmAverage(GRADES)).toBeCloseTo(15.3, 9);
    expect(weightedAlgorithmAverage(GRADES)).toBeCloseTo(15.135135135135137, 9);
    // Médiane : la majoration `b1` est IGNORÉE (une majoration n'est pas une
    // note /20 ordinaire, cf. docstring averages.ts) -> médiane des 5 notes
    // restantes [10, 12, 14, 15, 18] = 14. L'ancienne référence 14.5 incluait
    // la majoration à tort (cf. tests/unit/bugs-domain-jobs.test.ts).
    expect(medianAlgorithmAverage(GRADES)).toBeCloseTo(14, 9);
    expect(averageWith("subject", GRADES)).toBeCloseTo(15.3, 9);
    expect(averageWith("weighted", GRADES)).toBeCloseTo(15.135135135135137, 9);
    expect(averageWith("median", GRADES)).toBeCloseTo(14, 9);
  });

  test("historique : moyenne recalculée note par note (ordre chronologique)", () => {
    const history = computeAverages(GRADES, { algorithm: "subject" }).history;
    expect(history.map((p) => p.date)).toEqual([
      "2026-09-01T10:00:00.000Z",
      "2026-09-05T10:00:00.000Z",
      "2026-09-10T10:00:00.000Z",
      "2026-09-12T10:00:00.000Z",
      "2026-09-15T10:00:00.000Z",
      "2026-09-20T10:00:00.000Z",
    ]);
    const values = history.map((p) => p.value ?? NaN);
    const expected = [15, 13.5, 12.25, 14.166667, 14.125, 15.3];
    for (let i = 0; i < expected.length; i++) expect(values[i]).toBeCloseTo(expected[i], 5);
  });

  test("influence par note : écart de moyenne générale avec/sans la note", () => {
    const influences = computeAverages(GRADES, { algorithm: "subject" }).influences;
    const byId = Object.fromEntries(influences.map((i) => [i.gradeId, i.impact]));
    // Références upstream (useGradeInfluence, getAvgInfluence studentScore).
    expect(byId["m1"]).toBeCloseTo(0.5, 2);
    expect(byId["m2"]).toBeCloseTo(-0.5, 2);
    expect(byId["a1"]).toBeCloseTo(-0.82, 2);
    expect(byId["f1"]).toBeCloseTo(0.68, 2);
    expect(byId["s1"]).toBeCloseTo(-0.32, 2);
    expect(byId["b1"]).toBeCloseTo(1.18, 2);
    expect(influences.every((i) => i.subject.length > 0)).toBe(true);
  });

  test("rapport : fournie si l'établissement publie, estimée sinon", () => {
    const estimated = computeAverages(GRADES);
    expect(estimated.algorithm).toBe("subject");
    expect(estimated.general.origin).toBe("estimated");
    expect(estimated.general.value).toBeCloseTo(15.3, 9);
    expect(estimated.general.subjectCount).toBe(5);
    expect(estimated.subjects.map((s) => s.subject)).toEqual(["Anglais", "Arts", "EPS", "Maths", "SVT"]);

    const provided = computeAverages(GRADES, {
      provided: { general: 13.75, subjects: { maths: 12.5 } },
    });
    expect(provided.general.origin).toBe("provided");
    expect(provided.general.value).toBe(13.75);
    const maths = provided.subjects.find((s) => s.subject === "Maths");
    expect(maths?.origin).toBe("provided");
    // Sujet sans moyenne fournie : estimation conservée.
    expect(provided.subjects.find((s) => s.subject === "SVT")?.origin).toBe("estimated");
  });

  test("moyennes fournies : hors périmètre = estimation, jamais appliquées à tort", () => {
    const provided = { periodId: "p1" as const, general: 15, subjects: { maths: 14 } };
    const p = (id: string) => grade({ id, subject: "Maths", value: 12, scale: 20, periodId: id });
    const grades = [p("p1"), p("p2")];
    // Scope p1 : fournies appliquées.
    const inScope = computeAverages(grades, { periodId: "p1", provided });
    expect(inScope.general.origin).toBe("provided");
    expect(inScope.general.value).toBe(15);
    expect(inScope.subjects[0].origin).toBe("provided");
    // Scope p2 ou ensemble : les fourchettes de p1 ne s'appliquent pas.
    for (const scope of [{ periodId: "p2" }, {}]) {
      const out = computeAverages(grades, { ...scope, provided });
      expect(out.general.origin).toBe("estimated");
      expect(out.general.value).toBeCloseTo(12, 9);
      expect(out.subjects[0].origin).toBe("estimated");
    }
    // provided sans periodId = ensemble seulement.
    const allOnly = computeAverages(grades, { provided: { general: 13 } });
    expect(allOnly.general.origin).toBe("provided");
    expect(computeAverages(grades, { periodId: "p1", provided: { general: 13 } }).general.origin).toBe("estimated");
  });

  test("période : filtre par periodId, null = toutes périodes", () => {
    const p1 = GRADES.map((g) => ({ ...g, periodId: g.id === "b1" ? "p2" : "p1" }));
    const all = computeAverages(p1);
    expect(all.periodId).toBeNull();
    expect(all.subjects.length).toBe(5);

    const scoped = computeAverages(p1, { periodId: "p1" });
    expect(scoped.periodId).toBe("p1");
    expect(scoped.subjects.map((s) => s.subject)).toEqual(["Anglais", "EPS", "Maths", "SVT"]);
    // Papillon ne filtre pas par période dans l'algorithme : le regroupement
    // est fait en amont (ici periodId), la formule reste moyenne des matières.
    // Maths 12.5 / Anglais 12 / EPS 18 / SVT 14 -> 14.125.
    expect(scoped.general.value).toBeCloseTo(14.125, 9);
    expect(scoped.influences.every((i) => i.gradeId !== "b1")).toBe(true);
  });

  test("cas limites : vide, coef 0, zéro, hors échelle, une seule note", () => {
    expect(subjectAlgorithmAverage([])).toBeNull();
    expect(weightedAlgorithmAverage([])).toBeNull();
    expect(medianAlgorithmAverage([])).toBeNull();
    expect(computeAverages([]).general.value).toBeNull();
    expect(computeAverages([]).influences).toEqual([]);
    expect(computeAverages([]).subjects).toEqual([]);

    const zero = [grade({ id: "z", subject: "Maths", value: 0, scale: 20 })];
    expect(subjectAlgorithmAverage(zero)).toBe(0);
    expect(medianAlgorithmAverage(zero)).toBe(0);
    // Zéro = vraie note, pas « pas de donnée ».
    expect(computeAverages(zero).general.origin).toBe("estimated");

    // Coefficient 0 : Papillon l'ignore partout.
    const zeroCoef = [
      grade({ id: "c0", subject: "Maths", value: 4, scale: 20, coefficient: 0 }),
      grade({ id: "c1", subject: "Maths", value: 16, scale: 20 }),
    ];
    expect(subjectAverage(zeroCoef)).toBeCloseTo(16, 9);
    // Coefficient ABSENT = poids 1 (Papillon `coefficient || 1`), pas « ignorée ».
    const noCoef = [
      grade({ id: "n1", subject: "Maths", value: 12, scale: 20, coefficient: undefined }),
      grade({ id: "n2", subject: "Maths", value: 18, scale: 20, coefficient: undefined }),
    ];
    expect(subjectAverage(noCoef)).toBeCloseTo(15, 9);
    expect(weightedAlgorithmAverage(noCoef)).toBeCloseTo(15, 9);
    expect(medianAlgorithmAverage(noCoef)).toBeCloseTo(15, 9);
    expect(computeAverages(noCoef).subjects[0].gradeCount).toBe(2);
    // Une seule note sans coef ne doit pas disparaître de la moyenne.
    const onlyNoCoef = [grade({ id: "n1", subject: "Maths", value: 11, scale: 20, coefficient: undefined })];
    expect(subjectAverage(onlyNoCoef)).toBeCloseTo(11, 9);
    expect(computeAverages(onlyNoCoef).general.value).toBeCloseTo(11, 9);

    // Barème hors /20 : 40/40 -> 20/20, 15/40 -> 7.5/20.
    const big = [grade({ id: "b40", subject: "EPS", value: 40, scale: 40 })];
    expect(subjectAverage(big)).toBeCloseTo(20, 9);
    const small = [grade({ id: "b15", subject: "EPS", value: 15, scale: 40 })];
    expect(subjectAverage(small)).toBeCloseTo(7.5, 9);

    const single = [grade({ id: "one", subject: "Maths", value: 11, scale: 20 })];
    expect(subjectAlgorithmAverage(single)).toBeCloseTo(11, 9);
    // Papillon : sans cette note il ne reste aucune matière, référence 0,
    // donc l'influence vaut la moyenne entière.
    expect(computeAverages(single).influences[0].impact).toBeCloseTo(11, 9);
  });

  test("facultative : conservée si elle améliore, écartée si elle dégrade", () => {
    const withGood = [
      grade({ id: "g1", subject: "EPS", value: 10, scale: 20 }),
      grade({ id: "g2", subject: "EPS", value: 18, scale: 20, optional: true }),
    ];
    // Moyenne avec la facultative = 14 > 10 sans : elle compte.
    expect(subjectAverage(withGood)).toBeCloseTo(14, 9);

    const withBad = [
      grade({ id: "b1", subject: "EPS", value: 18, scale: 20 }),
      grade({ id: "b2", subject: "EPS", value: 4, scale: 20, optional: true }),
    ];
    // 18 sans, 11 avec : la facultative dégrade donc elle est écartée.
    expect(subjectAverage(withBad)).toBeCloseTo(18, 9);
  });

  test("bonus : négatif ou nul = ignoré, jamais négatif", () => {
    const bonusOk = [grade({ id: "x1", subject: "Arts", value: 20, scale: 20, bonus: true })];
    expect(subjectAverage(bonusOk)).toBeCloseTo(20, 9);
    // 5/20 -> 5-10 < 0 : ignoré, matière sans note exploitable.
    const bonusKo = [grade({ id: "x2", subject: "Arts", value: 5, scale: 20, bonus: true })];
    expect(subjectAverage(bonusKo)).toBeNull();
    expect(computeAverages(bonusKo).general.value).toBeNull();
  });

  test("subjectKey : clé canonique partagée par l'adaptateur et les algos", () => {
    expect(subjectKey("Mathématiques")).toBe("mathematiques");
    expect(subjectKey("  PHYSIQUE  ")).toBe("physique");
    expect(subjectKey("SVT")).toBe(subjectKey("svt"));
    // La moyenne fournie se retrouve par cette clé, pas par la casse d'origine.
    const provided = computeAverages([grade({ id: "k", subject: "Mathématiques", value: 10, scale: 20 })], {
      provided: { subjects: { [subjectKey("Mathématiques")]: 9 } },
    });
    expect(provided.subjects[0].origin).toBe("provided");
    expect(provided.subjects[0].value).toBe(9);
  });

  test("providedAveragesFor : la table par période, et rien d'autre", () => {
    const table = { "p-1": { periodId: "p-1", general: 14 }, "p-2": { periodId: "p-2", general: 11 } };
    expect(providedAveragesFor(table, "p-2")?.general).toBe(11);
    // Période non publiée / aucune période demandée : estimation, jamais la
    // moyenne d'une autre période.
    expect(providedAveragesFor(table, "p-9")).toBeNull();
    expect(providedAveragesFor(table, null)).toBeNull();
    expect(providedAveragesFor(table, "  ")).toBeNull();
    expect(providedAveragesFor(null, "p-1")).toBeNull();
    // `periodId` vient de l'URL : `__proto__` ne doit pas résoudre une moyenne
    // via Object.prototype.
    expect(providedAveragesFor(table, "__proto__")).toBeNull();
  });

  test("accents et casse : même matière regroupée", () => {
    const accented = [
      grade({ id: "a", subject: "Mathématiques", value: 12, scale: 20 }),
      grade({ id: "b", subject: "mathematiques", value: 16, scale: 20 }),
    ];
    expect(subjectAverage(accented)).toBeCloseTo(14, 9);
    const report = computeAverages(accented);
    expect(report.subjects.length).toBe(1);
    expect(report.subjects[0].subject).toBe("Mathématiques");
    expect(report.subjects[0].gradeCount).toBe(2);
  });

  test("charge bornée : historique/influence fenêtrés sur les notes récentes", () => {
    const many = Array.from({ length: MAX_AVERAGE_POINTS + 40 }, (_, i) =>
      grade({ id: `x${i}`, subject: i % 2 === 0 ? "Maths" : "Anglais", value: 10 + (i % 5), scale: 20, date: new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString() }),
    );
    const report = computeAverages(many);
    expect(report.general.value).not.toBeNull();
    expect(report.subjects.length).toBe(2);
    // Fenêtre : la moyenne générale reste exacte sur TOUTES les notes.
    expect(report.general.value).toBeCloseTo(subjectAlgorithmAverage(many) as number, 9);
    expect(report.history.length).toBe(MAX_AVERAGE_POINTS);
    expect(report.influences.length).toBe(MAX_AVERAGE_POINTS);
    // Les points conservés sont les plus récents, les impacts restants sont ignorés.
    expect(report.influences.every((i) => i.gradeId !== "x0")).toBe(true);
    expect(report.influences.some((i) => i.gradeId === `x${many.length - 1}`)).toBe(true);
    expect(report.influences.every((i) => Number.isFinite(i.impact))).toBe(true);
  });

  test("aucun effet de bord : entrées non mutées", () => {
    const before = JSON.stringify(GRADES);
    computeAverages(GRADES, { algorithm: "median" });
    subjectAverage(GRADES);
    expect(JSON.stringify(GRADES)).toBe(before);
  });
});
