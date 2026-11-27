import { isoDay } from "../../lib/format";
import type { Assignment } from "./assignment-parse";
import { foldFr } from "./assignment-labels";
import {
  assignmentDate,
  assignmentDayKey,
  dayKeyShift,
  isAllDayDue,
  parisDayOf,
  weekLabelFr,
  weekStartOf,
} from "./assignment-time";

export type AssignmentSectionId = "overdue" | "today" | "week" | "later" | "undated" | "done";

export interface AssignmentSection {
  id: AssignmentSectionId;
  title: string;
  items: Assignment[];
}

/** Ordre d'affichage : stable, que la semaine affichée soit la semaine
 *  courante ou une autre. */
const SECTION_ORDER: AssignmentSectionId[] = [
  "overdue",
  "today",
  "week",
  "later",
  "undated",
  "done",
];

/** Titres fixes ; celui de la semaine est calculé (il nomme la semaine
 *  AFFICHÉE). */
const SECTION_TITLES: Record<Exclude<AssignmentSectionId, "week">, string> = {
  overdue: "En retard",
  today: "Aujourd'hui",
  later: "Plus tard",
  undated: "Sans échéance",
  done: "Terminés",
};

/** Fenêtre de la semaine affichée : lundi → dimanche, en JOURS civils de Paris
 *  — les mêmes clés que [assignmentsInWeek]. Une semaine illisible retombe sur
 *  la semaine courante : la partition reste exhaustive (aucun devoir ne
 *  disparaît, aucun ne se retrouve deux fois). */
function weekWindow(weekStart: string, now: Date): { start: string; end: string } {
  const start = assignmentDayKey(weekStart) ?? assignmentDayKey(weekStartOf(now)) ?? isoDay(now);
  return { start, end: dayKeyShift(start, 6) ?? start };
}

/** Titre de la section de semaine : il nomme la semaine AFFICHÉE, pas
 *  « maintenant » — « Cette semaine » pour la semaine courante, « Semaine 43 »
 *  pour une autre. */
function weekSectionTitle(weekStart: string, now: Date): string {
  const { start } = weekWindow(weekStart, now);
  return start === weekStartOf(now) ? "Cette semaine" : weekLabelFr(start);
}

/** Une échéance datée du jour et DÉJÀ PASSÉE est « en retard ». Une échéance
 *  sans heure est un rendez-vous de la journée entière : elle n'est jamais
 *  « plus tôt que maintenant », sinon la moitié des devoirs du jour
 *  signaleraient à tort un retard. */
function isEarlierToday(assignment: Assignment, now: Date): boolean {
  if (isAllDayDue(assignment.dueDate)) return false;
  const date = assignmentDate(assignment.dueDate);
  return date !== null && date.getTime() < now.getTime();
}

/**
 * Section d'un devoir, RELATIVE À LA SEMAINE AFFICHÉE (`weekStart`, un lundi).
 *
 * Semaine courante (celle d'aujourd'hui) :
 * - « En retard » : échéance d'AVANT aujourd'hui — un devoir dû hier est en
 *   retard, il ne repasse pas dans « Cette semaine » ; et, pour une
 *   échéance du jour dont l'heure est déjà passée, retard également ;
 * - « Aujourd'hui » : échéance du jour qu'il reste à faire (une échéance SANS
 *   heure est un rendez-vous de la journée entière : jamais en retard) ;
 * - section de semaine : échéances des jours qui viennent, jusqu'au
 *   dimanche (titre : « Cette semaine ») ;
 * - « Plus tard » : échéances après la fin de la semaine (hors de l'écran :
 *   la liste affichée ne contient que la semaine choisie).
 *
 * Autre semaine (passée ou à venir) :
 * - « En retard » : échéance avant le début de la semaine affichée ;
 * - section de semaine : échéances du lundi au dimanche de la semaine
 *   affichée (titre : « Semaine 43 ») ;
 * - « Plus tard » : échéances après la fin de la semaine affichée ;
 * - pas de section « Aujourd'hui » : elle n'aurait aucun sens hors de la
 *   semaine en cours.
 *
 * Le FAIT prime sur la date (« Terminés ») ; une dueDate illisible n'est
 * jamais « en retard » : elle a sa propre section (« Sans échéance »), un
 * devoir sans échéance reste visible.
 *
 * Tous les jours comparés sont des JOURS civils de Paris : l'appareil peut
 * être ailleurs, la section et la fenêtre de semaine restent d'accord.
 */
export function assignmentSectionOf(
  assignment: Assignment,
  weekStart: string,
  now: Date,
): AssignmentSectionId {
  if (assignment.done) return "done";
  const day = assignmentDayKey(assignment.dueDate);
  if (!day) return "undated";
  const { start, end } = weekWindow(weekStart, now);
  if (start === weekStartOf(now)) {
    // Semaine en cours : « En retard » = ce qui aurait déjà dû être rendu.
    const today = parisDayOf(now) ?? start;
    if (day < today) return "overdue";
    if (day === today) return isEarlierToday(assignment, now) ? "overdue" : "today";
    if (day > end) return "later";
    return "week";
  }
  // Autre semaine : les sections décrivent la fenêtre affichée.
  if (day < start) return "overdue";
  if (day > end) return "later";
  return "week";
}

function byDate(a: Assignment, b: Assignment): number {
  const left = assignmentDate(a.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const right = assignmentDate(b.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  return left - right;
}

/** Sections non vides, dans l'ordre d'affichage, triées par échéance. Les
 *  devoirs sans date lisible restent visibles dans « Sans échéance ». Les
 *  sections suivent la semaine AFFICHÉE (`weekStart`), pas « aujourd'hui ». */
export function assignmentSections(
  items: Assignment[],
  weekStart: string,
  now: Date,
): AssignmentSection[] {
  const sections: AssignmentSection[] = [];
  for (const id of SECTION_ORDER) {
    const sectionItems = items
      .filter((item) => assignmentSectionOf(item, weekStart, now) === id)
      .sort(byDate);
    if (sectionItems.length === 0) continue;
    const title = id === "week" ? weekSectionTitle(weekStart, now) : SECTION_TITLES[id];
    sections.push({ id, title, items: sectionItems });
  }
  return sections;
}

/** Nombre de devoirs en retard, lu dans les sections RENDUES : le badge et la
 *  liste ne peuvent pas diverger. */
export function overdueCount(sections: readonly AssignmentSection[]): number {
  return sections.find((section) => section.id === "overdue")?.items.length ?? 0;
}

/** Recherche de la semaine : matière, titre, consigne ou titre de cours, sans
 *  accent ni casse. La semaine reste bornée AVANT le filtre. */
export function assignmentsMatching(items: Assignment[], query: string): Assignment[] {
  const needle = foldFr(query);
  if (!needle) return items;
  return items.filter((item) =>
    [item.subject, item.title, item.description, item.lessonContent?.title ?? ""].some((field) =>
      foldFr(field).includes(needle),
    ),
  );
}

/** Avancement de la semaine, y compris les devoirs en retard restés à faire. */
export function taskProgress(items: readonly Assignment[]): {
  total: number;
  done: number;
  remaining: number;
  percent: number;
} {
  const total = items.length;
  const done = items.filter((item) => item.done).length;
  return {
    total,
    done,
    remaining: total - done,
    percent: total > 0 ? Math.round((done / total) * 100) : 0,
  };
}
