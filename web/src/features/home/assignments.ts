// Devoirs de l'accueil : une date seule est un jour de Paris, pas minuit local.
import {
  civilDayOffset,
  DATE_ONLY,
  allDayKeyOf,
  parisDayKeyOf,
  parisMidnightOfDayKey,
} from "./calendar";
import {
  asObject,
  boundedLimit,
  boundedText,
  millisOf,
  payloadRoot,
  rowsOf,
} from "./payload";

export interface Assignment {
  id: string;
  subject: string;
  title: string;
  /** Une date seule est minuit de l'établissement (Paris), pas celui de l'appareil. */
  due: number;
  dueRaw: string;
  done: boolean;
}

/** Devoirs lisibles, triés par échéance ; identifiant déjà vu = une seule fois. */
export function parseAssignments(payload: string | null): Assignment[] {
  const root = payloadRoot(payload);
  if (!root) return [];
  const out: Assignment[] = [];
  const seen = new Set<string>();
  const rows = rowsOf(root, "assignments");
  for (let index = 0; index < rows.length; index++) {
    const row = asObject(rows[index]);
    if (!row) continue;
    const subject = boundedText(row["subject"], 100);
    const title = boundedText(row["title"], 200);
    const dueRaw = boundedText(row["dueDate"], 64);
    const due = DATE_ONLY.test(dueRaw)
      ? parisMidnightOfDayKey(dueRaw)
      : millisOf(row["dueDate"]);
    if (!subject || !title || due === null) continue;
    const id = boundedText(row["id"], 64) || `assignment-${index}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      subject,
      title,
      due,
      dueRaw,
      done: row["done"] === true,
    });
  }
  return out.sort((a, b) => a.due - b.due);
}

/** Un devoir en retard reste à faire : il est compté. */
export function isPendingTask(task: Assignment): boolean {
  return !task.done && Number.isFinite(task.due);
}

export function isUpcomingTask(task: Assignment, now: number): boolean {
  if (!isPendingTask(task)) return false;
  const allDay = allDayKeyOf(task.due, task.dueRaw);
  if (allDay) {
    const today = parisDayKeyOf(now);
    return today !== null && civilDayOffset(allDay, today) >= 0;
  }
  return task.due > now;
}

export function pendingAssignments(
  assignments: Assignment[],
  now: number,
  limit = 3,
): Assignment[] {
  const max = boundedLimit(limit, 3);
  if (max === 0) return [];
  return assignments.filter((task) => isUpcomingTask(task, now)).slice(0, max);
}

/** Compteur SANS plafond ; un devoir en retard reste un devoir à faire. */
export function pendingCount(assignments: Assignment[]): number {
  return assignments.filter((task) => isPendingTask(task)).length;
}
