import type {
  AiContextSourceMeta,
  ExerciseHelpMode,
  ExerciseItem,
  ExerciseProposal,
} from "../../bridge/types";
import { parseTeacherTurnResult, classifyTeacherFailure, type TeacherTurnError } from "./teacher";

// Exercices du manuel : modèle PUR de l'onglet. Aucun réseau ici ; les bornes
// protègent le pont (qui revalide) et le rendu : un énoncé vide ne devient jamais
// une carte cliquable.

/** Miroirs des bornes de `core/Exercises.kt`. */
export const EXERCISES_MAX_ITEMS = 8;
export const EXERCISE_MAX_STATEMENT = 800;
export const EXERCISE_MAX_NUMBER = 12;
export const EXERCISE_MAX_DIFFICULTY = 16;
export const EXERCISE_MAX_LABEL = 200;

const ACTIONS = new Set<string>(["add_course", "enable_manual", "open_attachment"]);

function boundedString(raw: unknown, max: number): string {
  return typeof raw === "string" ? raw.trim().slice(0, max) : "";
}

function boundedCount(raw: unknown, max: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  return Math.min(max, Math.max(0, Math.floor(raw)));
}

export function parseExercise(raw: unknown): ExerciseItem | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const number = boundedString(value["number"], EXERCISE_MAX_NUMBER);
  const statement = boundedString(value["statement"], EXERCISE_MAX_STATEMENT);
  const source = boundedString(value["source"], EXERCISE_MAX_LABEL);
  if (!number || !statement) return null;
  return {
    number,
    statement,
    page: boundedCount(value["page"], 9_999),
    difficulty: boundedString(value["difficulty"], EXERCISE_MAX_DIFFICULTY),
    source,
  };
}

/** Un lot hors contrat est écarté, jamais rendu en carte vide ; `manualReady`
 *  distingue « pas de manuel » de « manuel en échec ». */
export function parseExerciseProposal(raw: unknown): ExerciseProposal {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, exercises: [], manual: false, manualReady: false, message: "Proposition illisible." };
  }
  const value = raw as Record<string, unknown>;
  const exercises = Array.isArray(value["exercises"])
    ? value["exercises"]
        .map(parseExercise)
        .filter((item): item is ExerciseItem => item !== null)
        .slice(0, EXERCISES_MAX_ITEMS)
    : [];
  const actions = Array.isArray(value["actions"])
    ? value["actions"].filter((item): item is string => typeof item === "string" && ACTIONS.has(item))
    : [];
  return {
    ok: value["ok"] === true,
    exercises,
    manual: value["manual"] === true,
    manualReady: value["manualReady"] === true,
    manualTitle: boundedString(value["manualTitle"], EXERCISE_MAX_LABEL) || undefined,
    manualPage: boundedCount(value["manualPage"], 9_999),
    message: boundedString(value["message"], 400) || undefined,
    actions,
  };
}

export const EXERCISE_MODES: readonly ExerciseHelpMode[] = ["hint", "method", "correction"];

export function exerciseModeLabel(mode: ExerciseHelpMode): string {
  switch (mode) {
    case "hint":
      return "Indice";
    case "method":
      return "Méthode";
    case "correction":
      return "Correction complète";
  }
}

export function exerciseModeHint(mode: ExerciseHelpMode): string {
  switch (mode) {
    case "hint":
      return "Un seul indice, sans la solution.";
    case "method":
      return "Les étapes de la méthode, sans le résultat final.";
    case "correction":
      return "Corrige ta réponse et signale chaque erreur. À demander quand tu as essayé.";
  }
}

export function exerciseDifficultyLabel(difficulty: string): string {
  return difficulty === "facile" || difficulty === "moyen" || difficulty === "difficile" ? difficulty : "";
}

export function exercisePageLabel(exercise: ExerciseItem): string {
  return exercise.page > 0 ? `p. ${exercise.page}` : "";
}

export function exerciseSources(context: AiContextSourceMeta[] | undefined): AiContextSourceMeta[] {
  return (context ?? []).filter((source) => source.type !== "history");
}

/** Même schéma validé que le professeur. */
export function parseExerciseHelp(raw: unknown): ReturnType<typeof parseTeacherTurnResult> {
  return parseTeacherTurnResult(raw);
}

/** Classe un échec d'aide : mêmes causes et messages que le professeur. */
export function classifyExerciseFailure(result: ReturnType<typeof parseTeacherTurnResult>): TeacherTurnError {
  if (result.refused) {
    return { kind: "refused", message: result.message || "Aucune source pour cet exercice." };
  }
  return classifyTeacherFailure(result);
}
