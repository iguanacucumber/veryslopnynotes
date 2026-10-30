import type { AiContextSourceMeta, TeacherMessage, TeacherMode, TeacherThread, TeacherTurnResult } from "../../bridge/types";
import { parseAiContext } from "../tasks/assignments";

// Professeur IA contextualisé (#633) : modèle PUR de l'écran Prof.
// Aucun réseau ici : les bornes protègent le pont (le natif revalide tout) et
// le rendu (jamais une bulle vide, jamais une source inventée).

/** Causes affichables d'un tour raté : message + « Réessayer » dans l'UI. */
export type TeacherErrorKind = "key" | "quota" | "timeout" | "empty" | "refused" | "unavailable";

export interface TeacherTurnError {
  kind: TeacherErrorKind;
  message: string;
}

export function teacherActionLabel(action: string): string {
  switch (action) {
    case "add_course":
      return "Ajouter un cours au cahier";
    case "enable_manual":
      return "Activer le manuel";
    case "open_attachment":
      return "Ouvrir une pièce jointe";
    default:
      return "Continuer";
  }
}

/** Miroirs des bornes de `core/TeacherChat.kt` (le natif revalide). */
export const TEACHER_MAX_SUBJECT = 64;
export const TEACHER_MAX_MESSAGE = 2000;
export const TEACHER_MAX_ANSWER = 8000;
export const TEACHER_MAX_MESSAGES = 40;
export const TEACHER_MAX_HISTORY = 6;
export const TEACHER_MAX_SOURCES = 8;
export const TEACHER_MAX_LABEL = 200;
export const TEACHER_MAX_SUMMARY = 1000;

export const TEACHER_MODES: readonly TeacherMode[] = ["explain", "correct"];

export function teacherModeLabel(mode: TeacherMode): string {
  return mode === "correct" ? "Corrige-moi" : "Explique-moi";
}

export function teacherModeHint(mode: TeacherMode): string {
  return mode === "correct"
    ? "Le professeur corrige ton travail et explique chaque erreur."
    : "Le professeur explique, questionne et donne des indices, sans faire le travail à ta place.";
}

function boundedString(raw: unknown, max: number): string {
  return typeof raw === "string" ? raw.trim().slice(0, max) : "";
}

function boundedCount(raw: unknown, max: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  return Math.min(max, Math.max(0, Math.floor(raw)));
}

function parseSources(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const label = boundedString(item, TEACHER_MAX_LABEL);
    if (!label || out.includes(label)) continue;
    out.push(label);
    if (out.length >= TEACHER_MAX_SOURCES) break;
  }
  return out;
}

/** Lit un tour local (stockage ou réponse du pont), borné et validé. */
export function parseTeacherMessage(raw: unknown): TeacherMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const role = value["role"] === "teacher" ? "teacher" : value["role"] === "student" ? "student" : null;
  if (!role) return null;
  const text = boundedString(value["text"], role === "student" ? TEACHER_MAX_MESSAGE : TEACHER_MAX_ANSWER);
  if (!text) return null;
  const sources = role === "student" ? [] : parseSources(value["sources"]);
  const context = role === "student" ? [] : parseAiContext(value["context"]).slice(0, TEACHER_MAX_SOURCES);
  const summaryChars = role === "student" ? 0 : boundedCount(value["summaryChars"], TEACHER_MAX_SUMMARY);
  return {
    role,
    text,
    sources,
    // La règle du produit : aucun libellé cité = réponse non sourcée.
    unsourced: role === "teacher" && sources.length === 0,
    context,
    summaryChars,
  };
}

/** Lit le fil local renvoyé par `teacher.load`. */
export function parseTeacherThread(raw: unknown): TeacherThread {
  const empty: TeacherThread = { subject: "", messages: [] };
  if (typeof raw !== "object" || raw === null) return empty;
  const value = raw as Record<string, unknown>;
  const subject = boundedString(value["subject"], TEACHER_MAX_SUBJECT);
  const messages = Array.isArray(value["messages"])
    ? value["messages"].map(parseTeacherMessage).filter((message): message is TeacherMessage => message !== null)
    : [];
  return { subject, messages: trimTeacherMessages(messages) };
}

/** Borne le fil local aux derniers tours (le natif applique la même borne). */
export function trimTeacherMessages(messages: TeacherMessage[]): TeacherMessage[] {
  return messages.filter((message) => parseTeacherMessage(message) !== null).slice(-TEACHER_MAX_MESSAGES);
}

/**
 * Tours d'historique envoyés au pont : le fil borné (≤ 40), pas seulement les
 * 6 derniers. Le natif garde les 6 récents pour le prompt et résume les plus
 * anciens (`TeacherChat.summaryOf`) ; couper ici rendait ce résumé inatteignable.
 *
 * `sources`/`unsourced` sont OBLIGATOIRES : sans eux, `parseTeacherThreadOrNull`
 * rejette chaque tour professeur (`unsourced == sources.isEmpty()`) et le
 * modèle perd ses réponses précédentes (#706).
 */
export function teacherHistory(
  messages: TeacherMessage[],
): Array<Pick<TeacherMessage, "role" | "text" | "sources" | "unsourced">> {
  return trimTeacherMessages(messages).map((message) => ({
    role: message.role,
    text: message.text,
    sources: [...message.sources],
    unsourced: message.unsourced,
  }));
}

/** Payload d'un tour : borné AVANT le pont (qui revalide). */
export function buildTeacherTurn(
  subject: string,
  message: string,
  mode: TeacherMode,
  messages: TeacherMessage[],
): {
  subject: string;
  message: string;
  mode: TeacherMode;
  history: Array<Pick<TeacherMessage, "role" | "text" | "sources" | "unsourced">>;
} | null {
  const cleanSubject = boundedString(subject, TEACHER_MAX_SUBJECT);
  const cleanMessage = boundedString(message, TEACHER_MAX_MESSAGE);
  if (!cleanSubject || !cleanMessage) return null;
  return {
    subject: cleanSubject,
    message: cleanMessage,
    mode: TEACHER_MODES.includes(mode) ? mode : "explain",
    history: teacherHistory(messages),
  };
}

/**
 * Lit la réponse du pont. Une réponse `ok` SANS texte devient une erreur
 * explicite : jamais une bulle vide. Les sources restent les libellés fournis
 * par le natif ; une réponse sans libellé est marquée non sourcée.
 */
export function parseTeacherTurnResult(raw: unknown): TeacherTurnResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, message: "Le professeur n’a pas répondu : réessaie." };
  }
  const value = raw as Record<string, unknown>;
  const refused = value["refused"] === true;
  const ok = value["ok"] === true;
  const message = boundedString(value["message"], 400);
  if (!ok && !refused) {
    return { ok: false, message: message || "Le professeur est indisponible : réessaie." };
  }
  const answer = boundedString(value["answer"], TEACHER_MAX_ANSWER);
  if (ok && !answer) {
    return { ok: false, message: message || "Le professeur n’a pas répondu : réessaie." };
  }
  const sources = parseSources(value["sources"]);
  const context = parseAiContext(value["context"]).slice(0, TEACHER_MAX_SOURCES);
  const computedChars = context.reduce((sum, source) => sum + source.chars, 0);
  const contextChars =
    typeof value["contextChars"] === "number" && Number.isFinite(value["contextChars"])
      ? boundedCount(value["contextChars"], 12000)
      : computedChars;
  return {
    ok,
    refused,
    answer: answer || undefined,
    sources,
    unsourced: ok && sources.length === 0,
    message: message || undefined,
    code: boundedString(value["code"], 40) || undefined,
    refusal: boundedString(value["refusal"], 80) || undefined,
    actions: Array.isArray(value["actions"])
      ? value["actions"].filter((item): item is string => typeof item === "string").slice(0, 8)
      : [],
    context,
    contextChars,
    contextOmitted: boundedCount(value["contextOmitted"], 64),
    historyCount: boundedCount(value["historyCount"], TEACHER_MAX_HISTORY),
    historyChars: boundedCount(value["historyChars"], 12000),
    summaryChars: boundedCount(value["summaryChars"], TEACHER_MAX_SUMMARY),
  };
}

/**
 * Classe un échec de tour : clé absente, quota, timeout, réponse vide, refus
 * ou indisponible. Le message du pont fait foi ; le repli est explicite.
 */
export function classifyTeacherFailure(result: TeacherTurnResult): TeacherTurnError {
  if (result.refused) {
    return { kind: "refused", message: result.message || "Aucune source exploitable pour cette matière." };
  }
  const code = (result.code ?? "").toLowerCase();
  const message = result.message || "";
  const lower = message.toLowerCase();
  if (code === "key" || lower.includes("clé llm") || lower.includes("clé absente")) {
    return { kind: "key", message: message || "Clé LLM absente : renseigne-la dans Réglages." };
  }
  if (code === "quota" || lower.includes("quota") || lower.includes("crédits")) {
    return { kind: "quota", message: message || "Quota LLM dépassé : réessaie dans quelques minutes." };
  }
  if (code === "timeout" || lower.includes("timeout") || lower.includes("délai")) {
    return { kind: "timeout", message: message || "Le professeur a mis trop de temps : réessaie." };
  }
  if (code === "empty" || result.ok) {
    return { kind: "empty", message: "Le professeur n’a pas répondu : réessaie." };
  }
  return { kind: "unavailable", message: message || "Le professeur est indisponible : réessaie." };
}

/** Tour élève local (aucune source : c'est une question). */export function studentMessage(text: string): TeacherMessage | null {
  const body = boundedString(text, TEACHER_MAX_MESSAGE);
  if (!body) return null;
  return { role: "student", text: body, sources: [], unsourced: false, context: [], summaryChars: 0 };
}

/** Tour professeur depuis une réponse validée du pont. */
export function teacherMessage(result: TeacherTurnResult): TeacherMessage | null {
  const answer = boundedString(result.answer, TEACHER_MAX_ANSWER);
  if (!result.ok || !answer) return null;
  const sources = parseSources(result.sources);
  return {
    role: "teacher",
    text: answer,
    sources,
    unsourced: sources.length === 0,
    context: parseAiContext(result.context).slice(0, TEACHER_MAX_SOURCES),
    summaryChars: boundedCount(result.summaryChars, TEACHER_MAX_SUMMARY),
  };
}

/** Rejeter une réponse non sourcée : elle disparaît du fil local. */
export function rejectTeacherAnswer(messages: TeacherMessage[], index: number): TeacherMessage[] {
  if (index < 0 || index >= messages.length) return messages;
  if (messages[index]?.role !== "teacher") return messages;
  return messages.filter((_, position) => position !== index);
}

/**
 * Fil après une réponse : elle s'ajoute à la DISCUSSION COURANTE, jamais à
 * l'instantané capturé avant l'envoi. Un tour rejeté pendant le vol reste donc
 * rejeté, et l'enregistrement qui suit ne le ressuscite pas.
 */
export function appendTeacherAnswer(thread: TeacherMessage[], answer: TeacherMessage): TeacherMessage[] {
  return trimTeacherMessages([...thread, answer]);
}

export type TeacherWriteQueue = <T>(task: () => Promise<T>) => Promise<T>;

/**
 * Sérialise les écritures du fil local (enregistrement, suppression) : un
 * enregistrement ne peut pas arriver APRÈS la suppression qui le suit, sinon
 * le fil supprimé réapparaît sur le disque. Une tâche en échec n'arrête pas la
 * file : l'erreur reste à l'appelant, la suivante s'exécute quand même.
 */
export function teacherWriteQueue(): TeacherWriteQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}

export function teacherThreadPayload(subject: string, messages: TeacherMessage[]): TeacherThread {
  return {
    subject: boundedString(subject, TEACHER_MAX_SUBJECT),
    messages: trimTeacherMessages(messages),
  };
}

/** Sources du TOUR (hors historique) pour « Ce qui est envoyé ». */
export function turnSources(message: TeacherMessage): AiContextSourceMeta[] {
  return (message.context ?? []).filter((source) => source.type !== "history");
}

/** Tours d'historique réellement envoyés avec ce tour. */
export function historySources(message: TeacherMessage): AiContextSourceMeta[] {
  return (message.context ?? []).filter((source) => source.type === "history");
}
