// Contrats + agrégat par compétence (#78). Aucun réseau, aucun secret.
import { describe, expect, test } from "bun:test";
import {
  CONTRACTS_VERSION,
  EVALUATION_LABEL_MAX_CHARS,
  SKILL_LABEL_MAX_CHARS,
  isCompetenceSummary,
  isEvaluation,
  isSkill,
} from "../../shared/contracts/models";
import type { Evaluation } from "../../shared/contracts/models";
import { isEvaluationsResponse } from "../../shared/contracts/api";
import { isContractEvent } from "../../shared/contracts/events";
import { CACHE_TTL_MS, cacheStatus, isCacheableResource } from "../../shared/contracts/cache";
import { buildCompetenceSummary, buildSkills } from "../../server/domain/competences";
import {
  syntheticEmptySkillEvaluation,
  syntheticEvaluation,
  syntheticEvaluations,
  syntheticScaledEvaluation,
  syntheticSkill,
  syntheticSkillNoColor,
  syntheticUngradedEvaluation,
} from "./fixtures/competences";

describe("unit contrats compétences (#78)", () => {
  test("Skill : hex borné, label borné, add-only", () => {
    expect(isSkill(syntheticSkill)).toBe(true);
    expect(isSkill(syntheticSkillNoColor)).toBe(true); // couleur absente = non publiée
    expect(isSkill({ ...syntheticSkill, color: "3f51b5" })).toBe(false);
    expect(isSkill({ ...syntheticSkill, color: "#GGGGGG" })).toBe(false);
    expect(isSkill({ ...syntheticSkill, color: 42 })).toBe(false);
    expect(isSkill({ ...syntheticSkill, label: "  " })).toBe(false);
    expect(isSkill({ ...syntheticSkill, label: "x".repeat(SKILL_LABEL_MAX_CHARS + 1) })).toBe(false);
    expect(isSkill({ ...syntheticSkill, id: "" })).toBe(false);
    expect(isSkill(null)).toBe(false);
    expect(isSkill([])).toBe(false);
  });

  test("Evaluation : note null = non notée, undefined = invalide", () => {
    expect(isEvaluation(syntheticEvaluation)).toBe(true);
    expect(isEvaluation(syntheticUngradedEvaluation)).toBe(true); // note: null
    expect(isEvaluation(syntheticEmptySkillEvaluation)).toBe(true);
    // Jamais de 0 substitué : le contrat distingue "non noté" (null) de 0.
    expect(isEvaluation({ ...syntheticEvaluation, note: 0 })).toBe(true);
    // Champ note absent (undefined) = non conforme, pas "non noté".
    expect(isEvaluation({ ...syntheticEvaluation, note: undefined } as unknown as Evaluation)).toBe(false);
    expect(isEvaluation({ ...syntheticEvaluation, note: "12" })).toBe(false);
    expect(isEvaluation({ ...syntheticEvaluation, note: -1 })).toBe(false);
    expect(isEvaluation({ ...syntheticEvaluation, scale: 0 })).toBe(false);
    expect(isEvaluation({ ...syntheticEvaluation, date: "hier" })).toBe(false);
    expect(isEvaluation({ ...syntheticEvaluation, skillId: "" })).toBe(false);
    expect(isEvaluation({ ...syntheticEvaluation, label: "x".repeat(EVALUATION_LABEL_MAX_CHARS + 1) })).toBe(false);
    expect(isEvaluation({ ...syntheticEvaluation, classAverage: "10" })).toBe(false);
    expect(isEvaluation({ ...syntheticEvaluation, periodId: "  " })).toBe(false);
    // Add-only : Grade reste valide tel quel (aucun contrat cassé).
    expect(isEvaluation({ ...syntheticEvaluation, classAverage: 10.5, color: "#3f51b5" })).toBe(true);
  });

  test("CompetenceSummary + EvaluationsResponse : valides, cache vide valide", () => {
    expect(isCompetenceSummary({ skillId: "sk", label: "L", subject: "S", value: null, evaluationCount: 0 })).toBe(true);
    expect(isCompetenceSummary({ skillId: "sk", label: "L", subject: "S", value: 12.5, evaluationCount: 2 })).toBe(true);
    expect(isCompetenceSummary({ skillId: "sk", label: "L", subject: "S", value: 12.5, evaluationCount: -1 })).toBe(false);
    const payload = { skills: buildSkills(syntheticEvaluations), evaluations: syntheticEvaluations, summary: buildCompetenceSummary(syntheticEvaluations) };
    expect(isEvaluationsResponse(payload)).toBe(true);
    // Établissement sans évaluations par compétences = cache propre (vide valide).
    expect(isEvaluationsResponse({ skills: [], evaluations: [], summary: [] })).toBe(true);
    expect(isEvaluationsResponse({ skills: [], evaluations: [] })).toBe(false);
    expect(isEvaluationsResponse({ ...payload, evaluations: [{ ...syntheticEvaluation, scale: 0 }] })).toBe(false);
    expect(isEvaluationsResponse({ ...payload, skills: [{ id: "sk", label: "L", color: "red" }] })).toBe(false);
  });

  test("cache evaluations : ressource cachable + TTL cohérent", () => {
    expect(isCacheableResource("evaluations")).toBe(true);
    expect(CACHE_TTL_MS.evaluations).toBeGreaterThan(0);
    const ttl = CACHE_TTL_MS.evaluations;
    expect(cacheStatus("evaluations", 1_000, 1_000 + ttl)).toBe("fresh");
    expect(cacheStatus("evaluations", 1_000, 1_000 + ttl + 1)).toBe("stale");
  });

  test("invalidation evaluations : CacheInvalidated déjà couvert (pas d'événement #78)", () => {
    expect(
      isContractEvent({
        v: CONTRACTS_VERSION,
        type: "CacheInvalidated",
        at: "2026-10-02T06:00:00.000Z",
        data: { resource: "evaluations", reason: "sync" },
      }),
    ).toBe(true);
  });
});

describe("unit agrégat compétences (#78)", () => {
  test("compétences distinctes, tri stable, couleur si publiée", () => {
    const skills = buildSkills(syntheticEvaluations);
    // Ordre = libellé (fr) : Géométrie avant Nombres décimaux, indépendant de l'ordre du payload.
    expect(skills.map((s) => s.id)).toEqual([syntheticSkillNoColor.id, syntheticSkill.id]);
    expect(skills[1].color).toBe("#3f51b5");
    expect(skills[0].color).toBeUndefined();
    // Ordre stable : deux appels successifs donnent le même ordre.
    expect(buildSkills(syntheticEvaluations).map((s) => s.id)).toEqual(skills.map((s) => s.id));
    expect(buildSkills([])).toEqual([]);
  });

  test("note indéfinie ignorée : ni moyenne, ni compteur", () => {
    const summary = buildCompetenceSummary(syntheticEvaluations);
    const nums = summary.find((s) => s.skillId === syntheticSkill.id);
    // 12/20 -> 12, 15/10 -> 30, la non notée est ignorée (pas de 0).
    expect(nums?.evaluationCount).toBe(2);
    expect(nums?.value).toBe(21);
    const geo = summary.find((s) => s.skillId === syntheticSkillNoColor.id);
    expect(geo?.value).toBeNull();
    expect(geo?.evaluationCount).toBe(0);
  });

  test("toutes notes indéfinies -> value null (jamais 0 = fausse maîtrise)", () => {
    const summary = buildCompetenceSummary([syntheticUngradedEvaluation, syntheticEmptySkillEvaluation]);
    expect(summary.every((s) => s.value === null)).toBe(true);
    expect(summary.every((s) => s.evaluationCount === 0)).toBe(true);
    expect(buildCompetenceSummary([])).toEqual([]);
  });

  test("échelle incohérente : ramenée sur /20 comme Papillon", () => {
    const only: Evaluation[] = [syntheticScaledEvaluation, syntheticUngradedEvaluation];
    expect(buildCompetenceSummary(only)[0]?.value).toBe(30);
  });

  test("défensif : NaN/barème nul ignorés (store corrompu ne casse pas l'agrégat)", () => {
    const broken: Evaluation[] = [
      { ...syntheticEvaluation, note: Number.NaN },
      { ...syntheticEvaluation, id: "ev-x", scale: 0 },
      { ...syntheticUngradedEvaluation, id: "ev-y" },
    ];
    const summary = buildCompetenceSummary(broken);
    expect(summary[0]?.evaluationCount).toBe(0);
    expect(summary[0]?.value).toBeNull();
  });
});
