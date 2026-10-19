// Parité du regroupement des matières entre le web et le rapport natif (#370).
//
// Le natif (`android/core/.../Averages.kt`) regroupe par clé NORMALISÉE
// (`subjectKey`) : « Mathématiques » et « MATHEMATIQUES » sont UNE matière, et
// le rapport publié n'en contient qu'une entrée. Le web regroupait par nom
// brut : deux cartes, dont une « Pas de moyenne », en désaccord avec la
// moyenne générale affichée en tête d'écran.
//
// Les références Kotlin ci-dessous sont calculées par
// `BigDecimal(value).setScale(2, RoundingMode.HALF_UP)` (`twoDecimals`) et par
// `Normalizer.normalize(subject, Form.NFKD)` (`subjectKey`) : le web doit
// rendre exactement la même valeur.
import { describe, expect, test } from "bun:test";
import {
  computeAverages,
  gradeGroups,
  twoDecimals,
  type Grade,
  type SubjectAverage,
} from "../../web/src/features/grades/model";
import { subjectKey } from "../../web/src/lib/subject";

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

describe("regroupement par matière (parité du rapport natif)", () => {
  test("deux graphies d'une matière : UNE carte, la moyenne du rapport", () => {
    const grades = [
      grade({ subject: "Mathématiques", value: 15 }),
      grade({ subject: "MATHEMATIQUES", value: 10 }),
    ];
    // Le rapport natif : une seule matière, moyenne publiée 12,50.
    const report: SubjectAverage[] = [
      { subject: "Mathématiques", value: 12.5, provided: true, gradeCount: 2 },
    ];
    const groups = gradeGroups(grades, report);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.subject).toBe("Mathématiques");
    expect(groups[0]?.average).toBe(12.5);
    expect(groups[0]?.provided).toBe(true);
    expect(groups[0]?.grades).toHaveLength(2);
  });

  test("la moyenne publiée l'emporte sur l'estimation locale", () => {
    // L'école publie 12,50 alors que les notes donneraient 10,50 : c'est le
    // rapport qui fait foi, pas le recalcul du web.
    const grades = [
      grade({ subject: "Mathématiques", value: 15 }),
      grade({ subject: "MATHEMATIQUES", value: 6 }),
    ];
    const report: SubjectAverage[] = [
      { subject: "Mathématiques", value: 12.5, provided: true, gradeCount: 2 },
    ];
    expect(gradeGroups(grades, report)[0]?.average).toBe(12.5);
    // Sans rapport, le calcul local regroupe pareil : une matière, deux notes.
    const local = computeAverages(grades, "subject");
    expect(local.subjects).toHaveLength(1);
    expect(local.subjects[0]?.subject).toBe("Mathématiques");
    expect(local.subjects[0]?.gradeCount).toBe(2);
    expect(local.subjects[0]?.value).toBe(10.5);
  });

  test("les matières sans moyenne se trient par nom", () => {
    const grades = [
      grade({ subject: "Zoologie", value: 10, coefficient: 0 }),
      grade({ subject: "Astronomie", value: 10, coefficient: 0 }),
      grade({ subject: "Maths", value: 12 }),
    ];
    // Le rapport arrive dans l'ordre du collateur natif, pas dans l'ordre
    // alphabétique : le tri par nom doit malgré tout s'exécuter.
    const report: SubjectAverage[] = [
      { subject: "Zoologie", value: null, provided: false, gradeCount: 0 },
      { subject: "Astronomie", value: null, provided: false, gradeCount: 0 },
      { subject: "Maths", value: 12, provided: false, gradeCount: 1 },
    ];
    const groups = gradeGroups(grades, report);
    expect(groups.map((group) => group.subject)).toEqual(["Maths", "Astronomie", "Zoologie"]);
    expect(groups[1]?.average).toBeNull();
  });
});

describe("clé normalisée (parité `subjectKey` du Kotlin)", () => {
  test("sans accents, en minuscules, sans bords", () => {
    expect(subjectKey("Mathématiques")).toBe("mathematiques");
    expect(subjectKey("MATHEMATIQUES")).toBe("mathematiques");
    expect(subjectKey("  Épreuve  ")).toBe("epreuve");
  });

  test("NFKD comme le natif : les caractères de compatibilité sont décomposés", () => {
    // NFD laisserait « ① » intact ; NFKD (le choix du Kotlin) donne « 1 ».
    expect(subjectKey("① Numérique")).toBe("1 numerique");
    expect(subjectKey("ﬁ Sciences")).toBe("fi sciences");
    expect(subjectKey("Ａ")).toBe("a");
  });
});

describe("arrondi (parité `twoDecimals` du Kotlin)", () => {
  test("mêmes valeurs que `BigDecimal(v).setScale(2, HALF_UP)`", () => {
    expect(twoDecimals(2.675)).toBe(2.67);
    expect(twoDecimals(1.115)).toBe(1.11);
    expect(twoDecimals(0.015)).toBe(0.01);
    // Moitié AU LOIN de zéro, symétrique (`-0.125` -> `-0.13` des deux côtés).
    expect(twoDecimals(-0.125)).toBe(-0.13);
    expect(twoDecimals(0.125)).toBe(0.13);
    expect(twoDecimals(12.345)).toBe(12.35);
  });
});
