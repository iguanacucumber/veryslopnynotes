import { describe, expect, test } from "bun:test";
import { isNearBottom, isScrollable } from "../../web/src/ui/useStickToBottom";
import { emptyTurn, storedThread } from "../../web/src/features/tasks/homeworkThread";
import type { HomeworkChatState } from "../../web/src/features/tasks/HomeworkChat";

function state(overrides: Partial<HomeworkChatState> = {}): HomeworkChatState {
  return {
    id: "a1",
    photo: false,
    loading: false,
    allowUnsourced: false,
    phases: [],
    turns: [],
    current: emptyTurn(""),
    ...overrides,
  };
}

describe("suivi du bas du fil", () => {
  test("collé = distance au bas sous le seuil", () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 900, clientHeight: 100 })).toBe(true);
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 800, clientHeight: 100 })).toBe(false);
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 800, clientHeight: 100 }, 120)).toBe(true);
  });

  test("un fil plus court que son cadre n'est jamais « ailleurs »", () => {
    expect(isScrollable({ scrollHeight: 100, clientHeight: 100 })).toBe(false);
    expect(isScrollable({ scrollHeight: 101, clientHeight: 100 })).toBe(false);
    expect(isScrollable({ scrollHeight: 102, clientHeight: 100 })).toBe(true);
  });
});

describe("fil d'aide devoirs gardé à la fermeture", () => {
  test("une demande encore en vol ne s'ouvre pas en chargement perpétuel", () => {
    const kept = storedThread(
      state({ loading: true, phases: [{ phase: "model", at: 1 }], current: emptyTurn("Explique") }),
    );
    expect(kept).toBeNull();
  });

  test("les tours complets sont gardés, sans phase ni chargement", () => {
    const kept = storedThread(
      state({
        loading: true,
        phases: [{ phase: "model", at: 1 }],
        turns: [
          {
            ...emptyTurn("D'abord"),
            answer: "Une réponse",
          },
        ],
        current: emptyTurn("Encore"),
      }),
    );
    expect(kept?.loading).toBe(false);
    expect(kept?.phases).toEqual([]);
    expect(kept?.turns).toHaveLength(1);
    expect(kept?.current.answer).toBeNull();
  });

  test("une réponse terminée reste lisible à la réouverture", () => {
    const kept = storedThread(
      state({ current: { ...emptyTurn("Explique"), answer: "Voilà", sources: ["Cours"] } }),
    );
    expect(kept?.current.answer).toBe("Voilà");
    expect(kept?.current.sources).toEqual(["Cours"]);
  });

  test("un refus ou une erreur se rouvre tel quel", () => {
    expect(storedThread(state({ current: { ...emptyTurn(""), refusal: "Aucune source" } }))?.current.refusal).toBe(
      "Aucune source",
    );
    expect(storedThread(state({ current: { ...emptyTurn(""), error: "Réseau" } }))?.current.error).toBe(
      "Réseau",
    );
  });
});
