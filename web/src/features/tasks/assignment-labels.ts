import { frDate } from "../../lib/format";
import type { Assignment } from "./assignment-parse";
import { assignmentDate, isAllDayDue, parisClock, parisDayKey } from "./assignment-time";

/** « dimanche 25 octobre · 20:00 », à l'heure de l'établissement ; une
 *  échéance sans heure n'affiche pas d'heure. */
export function dueLabel(value: unknown): string {
  const day = typeof value === "string" ? parisDayKey(value) : null;
  if (!day) return "";
  const label = frDate(day);
  if (isAllDayDue(value)) return label;
  const date = assignmentDate(value);
  const time = date ? parisClock(date).slice(0, 5) : "";
  return time ? `${label} · ${time}` : label;
}

/** Minuscules sans accent, pour la recherche et la comparaison de titres. */
export function foldFr(value: string): string {
  return value
    .toLocaleLowerCase("fr-FR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/**
 * Pronote n'expose qu'un champ descriptif : le `title` du payload est souvent
 * ses 200 premiers caractères. La carte n'affiche le titre séparément que
 * s'il apporte autre chose, et montre toujours la consigne entière.
 */
export function assignmentCardText(assignment: Assignment): { title: string; body: string } {
  const title = assignment.title.trim();
  const body = assignment.description.trim();
  if (!body) return { title, body: "" };
  const foldedTitle = foldFr(title);
  if (foldedTitle && foldFr(body).startsWith(foldedTitle)) return { title: "", body };
  return { title, body };
}

/** « ALLEMAND LV2 » → « Allemand LV2 » ; une casse déjà mixte est conservée. */
export function subjectDisplayFr(name: string): string {
  const trimmed = name.trim();
  const letters = trimmed.replace(/[^\p{L}]/gu, "");
  if (!letters || letters !== letters.toLocaleUpperCase("fr-FR")) return trimmed;
  const [head = "", ...tail] = trimmed.split(" ");
  const capitalised = head.toLocaleLowerCase("fr-FR").replace(/^./u, (c) => c.toLocaleUpperCase("fr-FR"));
  return tail.length > 0 ? `${capitalised} ${tail.join(" ")}` : capitalised;
}

export function subjectInitial(subject: string): string {
  const first = subject.trim().match(/[\p{L}\p{N}]/u)?.[0];
  return first ? first.toLocaleUpperCase("fr-FR") : "?";
}

/**
 * Le devoir a-t-il du texte exploitable par l'assistant ?
 *
 * Le natif refuse AVANT l'appel quand ni la consigne ni le cours
 * n'existent : proposer « Aide devoirs » ou « Fiche de révision » ne mènerait
 * qu'à une erreur. Le titre seul ne suffit pas. Un manuel utilisable ou un
 * cours du cahier pour CETTE matière est une source supplémentaire : il
 * suffit à lui seul.
 */
export function assignmentHasAssistantMaterial(
  assignment: Pick<Assignment, "description" | "lessonContent"> & {
    /** #631 : plusieurs cours et leurs pièces jointes sont des sources. */
    readonly lessonContents?: Assignment["lessonContents"];
    readonly attachments?: Assignment["attachments"];
  },
  manualReady = false,
  lessonReady = false,
): boolean {
  return (
    manualReady ||
    lessonReady ||
    assignment.description.trim() !== "" ||
    (assignment.lessonContents ?? []).some((lesson) => lesson.excerpt.trim() !== "") ||
    (assignment.lessonContents ?? []).some((lesson) => (lesson.attachments?.length ?? 0) > 0) ||
    (assignment.lessonContent?.excerpt.trim() ?? "") !== "" ||
    (assignment.attachments?.length ?? 0) > 0
  );
}
