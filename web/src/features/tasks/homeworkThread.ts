import type { HomeworkChatState, HomeworkTurn } from "./HomeworkChat";

export function emptyTurn(question: string): HomeworkTurn {
  return {
    question,
    answer: null,
    steps: [],
    sources: [],
    refusal: null,
    actions: [],
    error: null,
  };
}

/**
 * Instantané gardé à la fermeture : une demande encore en vol n'a pas de
 * réponse, elle ne doit pas rouvrir en chargement perpétuel. Sans tour
 * complet, rien n'est gardé et la prochaine ouverture redemandera.
 */
export function storedThread(state: HomeworkChatState | null): HomeworkChatState | null {
  if (!state) return null;
  const current = state.loading ? emptyTurn("") : state.current;
  const hasContent =
    state.turns.length > 0 ||
    current.answer !== null ||
    current.refusal !== null ||
    current.error !== null;
  if (!hasContent) return null;
  return { ...state, loading: false, phases: [], current };
}
