// e2e compétences (#78) : reader Pronote (client injecté) -> store -> API ->
// payload consommé par l'app. Zéro réseau externe, zéro secret, fixtures
// synthétiques. Contenu externe = donnée marquée untrusted (I6), aucun effet
// métier (I7).
import { describe, expect, test } from "bun:test";
import { PronoteClientReader } from "../../server/integrations/pronote-client-reader";
import { createHandler } from "../../server/api/router";
import { createMemoryStore } from "../../server/api/store";
import type { ReadStore } from "../../server/api/store";
import { isEvaluationsResponse } from "../../shared/contracts/api";
import type { EvaluationsResponse } from "../../shared/contracts/api";
import type { Evaluation } from "../../shared/contracts/models";
import {
  syntheticAccountId,
  syntheticClientWithoutEvaluations,
  syntheticCompetencyClient,
} from "../unit/fixtures/competences";

async function serveEvaluations(seed?: Evaluation[]): Promise<EvaluationsResponse> {
  const reader = new PronoteClientReader({
    sessions: { requireClient: () => syntheticCompetencyClient() },
  });
  const page = await reader.getEvaluations(syntheticAccountId);
  // Le contenu externe Untrusted est repris tel quel, jamais interprété.
  const evaluations = page.items.value as Evaluation[];
  const handler = createHandler(createMemoryStore({ evaluations: seed ?? evaluations }));
  const res = await handler(new Request("http://127.0.0.1/v1/evaluations"));
  expect(res.status).toBe(200);
  const body = (await res.json()) as EvaluationsResponse;
  expect(isEvaluationsResponse(body)).toBe(true);
  return body;
}

describe("e2e compétences (#78)", () => {
  test("reader -> store -> API : chips compétences cohérentes, notes vides ignorées", async () => {
    const body = await serveEvaluations();
    // 3 évaluations mappées (note 12/20, non notée, champs minimaux).
    expect(body.evaluations).toHaveLength(3);
    // Deux compétences distinctes, ordre stable (libellé : Géométrie < Nombres).
    expect(body.skills.map((s) => s.id)).toEqual(["skill-4", "sk-nombres"]);
    // Compétence notée : 12/20 -> 12 sur /20, la non notée est ignorée (count 1).
    const notee = body.summary.find((s) => s.skillId === "sk-nombres");
    expect(notee?.value).toBe(12);
    expect(notee?.evaluationCount).toBe(1);
    // Compétence jamais notée : null partout (jamais 0 = fausse maîtrise).
    const other = body.summary.find((s) => s.skillId === "skill-4");
    expect(other?.value).toBeNull();
    expect(other?.evaluationCount).toBe(0);
  });

  test("modale stable : deux lectures successives donnent le même ordre et les mêmes chips", async () => {
    const a = await serveEvaluations();
    const b = await serveEvaluations();
    expect(b.skills).toEqual(a.skills);
    expect(b.summary).toEqual(a.summary);
    expect(b.evaluations.map((e) => e.id)).toEqual(a.evaluations.map((e) => e.id));
  });

  test("établissement sans évaluations par compétences -> cache propre (3 listes vides)", async () => {
    const reader = new PronoteClientReader({
      sessions: { requireClient: () => syntheticClientWithoutEvaluations() },
    });
    const page = await reader.getEvaluations(syntheticAccountId);
    const handler = createHandler(createMemoryStore({ evaluations: page.items.value as Evaluation[] }));
    const res = await handler(new Request("http://127.0.0.1/v1/evaluations"));
    expect(await res.json()).toEqual({ skills: [], evaluations: [], summary: [] });
  });

  test("store legacy (sans évaluations) -> 200 + état vide, pas d'écran cassé", async () => {
    const full = createMemoryStore();
    const legacy: ReadStore = {
      grades: full.grades,
      assignments: full.assignments,
      entries: full.entries,
      securityAlerts: full.securityAlerts,
      periods: full.periods,
      providedAverages: full.providedAverages,
    };
    const res = await createHandler(legacy)(new Request("http://127.0.0.1/v1/evaluations"));
    expect(res.status).toBe(200);
    expect(isEvaluationsResponse(await res.json())).toBe(true);
  });

  test("méthode absente sur la route : 404, pas de 500", async () => {
    const res = await createHandler(createMemoryStore())(new Request("http://127.0.0.1/v1/competences"));
    expect(res.status).toBe(404);
  });
});
