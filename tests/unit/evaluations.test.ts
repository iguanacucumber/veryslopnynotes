// Reader Pronote + route /v1/evaluations (#78). Client injecté : zéro réseau,
// zéro secret, fixtures synthétiques.
import { describe, expect, test } from "bun:test";
import { PronoteClientReader } from "../../server/integrations/pronote-client-reader";
import { PronoteReadError } from "../../server/domain/ports";
import { isEvaluationsResponse } from "../../shared/contracts/api";
import { isEvaluation } from "../../shared/contracts/models";
import { createHandler } from "../../server/api/router";
import { pairedDevice } from "./fixtures/pairing";
import { createMemoryStore } from "../../server/api/store";
import type { ReadStore } from "../../server/api/store";
import {
  syntheticAccountId,
  syntheticClientWithoutEvaluations,
  syntheticCompetencyClient,
  syntheticEvaluations,
} from "./fixtures/competences";

function readerWith(client: unknown, logs: string[] = []) {
  return new PronoteClientReader({
    sessions: { requireClient: () => client },
    logger: (m) => logs.push(m),
  });
}

describe("unit reader évaluations (#78)", () => {
  test("mapping défensif : champs absents omis, note absente = null", async () => {
    const logs: string[] = [];
    const reader = readerWith(syntheticCompetencyClient(), logs);
    const page = await reader.getEvaluations(syntheticAccountId);
    expect(page.items.__untrusted).toBe(true); // I6 : donnée, jamais instruction
    expect(page.nextCursor).toBeNull();
    expect(page.items.value).toHaveLength(3);
    expect(page.items.value.every(isEvaluation)).toBe(true);

    const [notee, vide, minimal] = page.items.value;
    expect(notee?.note).toBe(12);
    expect(notee?.scale).toBe(20);
    expect(notee?.skillId).toBe("sk-nombres");
    expect(notee?.periodId).toBe("p-1");
    expect(notee?.color).toBe("#3f51b5"); // normalisé en minuscules
    expect(notee?.classAverage).toBeUndefined(); // non publié = absent, pas 0
    // Non notée : null, jamais 0.
    expect(vide?.note).toBeNull();
    expect(vide?.color).toBeUndefined();
    // Champs minimaux : compétence de repli + libellé par défaut, pas de crash.
    expect(minimal?.skillId).toBe("skill-4");
    expect(minimal?.label).toBe("Géométrie");
    expect(minimal?.note).toBeNull();
    expect(minimal?.periodId).toBe("p-1");
    expect(logs.join("\n")).toContain("evaluations -> ok 3");
  });

  test("onglet évaluations absent de l'établissement -> page vide, pas d'erreur", async () => {
    const reader = readerWith(syntheticClientWithoutEvaluations());
    const page = await reader.getEvaluations(syntheticAccountId);
    expect(page.items.value).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  test("onglet présent mais en erreur -> ignoré (le reste du périmètre reste lisible)", async () => {
    const reader = readerWith({
      periods: [
        { id: "p-1", evaluations: async () => { throw new Error("onglet indisponible"); } },
        {
          id: "p-2",
          evaluations: async () => [{ id: "ev-ok", name: "Nombres", subject: { name: "Maths-Fake" }, acquisitions: [{ domainId: "sk-nombres" }], grade: "8" }],
        },
      ],
    });
    const page = await reader.getEvaluations(syntheticAccountId);
    expect(page.items.value).toHaveLength(1);
    expect(page.items.value[0]?.periodId).toBe("p-2");
    expect(page.items.value[0]?.note).toBe(8);
  });

  test("pagination bornée + session absente -> session_expired", async () => {
    const reader = readerWith(syntheticCompetencyClient());
    const first = await reader.getEvaluations(syntheticAccountId, { limit: 1 });
    expect(first.items.value).toHaveLength(1);
    expect(first.nextCursor).toBe("1");
    const second = await reader.getEvaluations(syntheticAccountId, { limit: 1, cursor: first.nextCursor ?? undefined });
    expect(second.items.value).toHaveLength(1);
    expect(second.nextCursor).toBe("2");
    const empty = new PronoteClientReader({
      sessions: {
        requireClient: () => {
          throw new PronoteReadError("evaluations session expired", "session_expired");
        },
      },
    });
    const err = await empty.getEvaluations("acc-inconnu").catch((e: unknown) => e);
    expect((err as PronoteReadError).code).toBe("session_expired");
    const errEmpty = await empty.getEvaluations("  ").catch((e: unknown) => e);
    expect((errEmpty as PronoteReadError).code).toBe("session_expired");
  });
});

describe("unit route /v1/evaluations (#78)", () => {
  test("payload servi depuis le store, validé par le garde-fou", async () => {
    const { pairing, auth } = pairedDevice();
    const handler = createHandler(createMemoryStore({ evaluations: syntheticEvaluations }), pairing);
    const res = await handler(new Request("http://localhost/v1/evaluations", { headers: auth }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { evaluations: unknown[]; summary: { evaluationCount: number }[] };
    expect(isEvaluationsResponse(body)).toBe(true);
    expect(body.evaluations.every(isEvaluation)).toBe(true);
    // La note non notée ne compte pas dans le compteur de la compétence notée.
    const notee = body.summary.find((s) => s.evaluationCount > 0);
    expect(notee?.evaluationCount).toBe(2);
  });

  test("store sans la méthode evaluations (optionnelle) -> cache propre, pas d'écran cassé", async () => {
    const full = createMemoryStore();
    // Store legacy : pas de méthode evaluations() du tout.
    const legacy: ReadStore = {
      grades: full.grades,
      assignments: full.assignments,
      entries: full.entries,
      securityAlerts: full.securityAlerts,
      periods: full.periods,
      providedAverages: full.providedAverages,
    };
    const { pairing, auth } = pairedDevice();
    const res = await createHandler(legacy, pairing)(new Request("http://localhost/v1/evaluations", { headers: auth }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ skills: [], evaluations: [], summary: [] });
    // Store implémentant la méthode mais sans donnée = même réponse vide.
    const other = createHandler(createMemoryStore({ evaluations: [] }), pairing);
    expect(await (await other(new Request("http://localhost/v1/evaluations", { headers: auth }))).json()).toEqual({
      skills: [],
      evaluations: [],
      summary: [],
    });
  });
});
