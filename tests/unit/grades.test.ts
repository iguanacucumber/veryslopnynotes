import { describe, expect, test } from "bun:test";
import type { Grade } from "../../shared/contracts/models";
import { diffAgainstPrints, diffGrades, fingerprint } from "../../server/jobs/grades";

const grade = (id: string, value = 14): Grade => ({
  id,
  accountId: "acc",
  subject: "Maths",
  value,
  scale: 20,
  date: "2026-09-20T10:00:00.000Z",
});

describe("unit grade diff", () => {
  test("ajout / correction / suppression détectés", () => {
    const before = [grade("g1"), grade("g2"), grade("g3")];
    const after = [grade("g1"), grade("g2", 16), grade("g4")];
    const diff = diffGrades(before, after);
    expect(diff.added.map((g) => g.id)).toEqual(["g4"]);
    expect(diff.changed.map((g) => g.id)).toEqual(["g2"]);
    expect(diff.removed).toEqual(["g3"]);
  });

  test("correction de contexte (#74) : bonus/facultatif/coefficient détectés", () => {
    const before = [grade("g1")];
    const madeOptional = diffGrades(before, [{ ...grade("g1"), optional: true }]);
    expect(madeOptional.changed.map((g) => g.id)).toEqual(["g1"]);

    const madeBonus = diffGrades(before, [{ ...grade("g1"), bonus: true }]);
    expect(madeBonus.changed.map((g) => g.id)).toEqual(["g1"]);

    const newClassAverage = diffGrades(before, [{ ...grade("g1"), classAverage: 11 }]);
    expect(newClassAverage.changed.map((g) => g.id)).toEqual(["g1"]);

    const sameOptional = diffGrades(
      [{ ...grade("g1"), optional: true }],
      [{ ...grade("g1"), optional: true }],
    );
    expect(sameOptional).toEqual({ added: [], changed: [], removed: [] });
  });

  test("identique → diff vide ; contre empreintes équivalent", () => {
    const before = [grade("g1")];
    const empty = diffGrades(before, [grade("g1")]);
    expect(empty).toEqual({ added: [], changed: [], removed: [] });

    const prints: Record<string, string> = { g1: fingerprint(grade("g1")) };
    const same = diffAgainstPrints(prints, [grade("g1")]);
    expect(same.added).toEqual([]);
    expect(same.changed).toEqual([]);
    const added = diffAgainstPrints(prints, [grade("g1"), grade("g9")]);
    expect(added.added.map((g) => g.id)).toEqual(["g9"]);
  });
});
