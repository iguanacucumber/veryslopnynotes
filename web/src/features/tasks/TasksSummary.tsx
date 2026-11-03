import type { CSSProperties } from "react";
import { IconCheck } from "../../ui/icons";

/** Résumé de la semaine. Le badge de retard affiche `overdueCount(sections)`,
 *  le compte de la section « En retard » elle-même. */
export function TasksSummary({
  percent,
  remaining,
  overdue,
  weekSuffix,
}: {
  percent: number;
  remaining: number;
  overdue: number;
  weekSuffix: string;
}) {
  return (
    <div className="tasks-summary" role="status">
      <span
        className="tasks-summary__ring"
        aria-hidden="true"
        style={{ "--task-progress": `${percent * 3.6}deg` } as CSSProperties}
      >
        {remaining === 0 ? <IconCheck size={16} /> : null}
      </span>
      <span className="tasks-summary__text">
        {remaining === 0
          ? "Toutes les tâches sont terminées !"
          : `${remaining} tâche${remaining > 1 ? "s" : ""} restante${
              remaining > 1 ? "s" : ""
            } ${weekSuffix}`}
      </span>
      {overdue > 0 ? (
        <span className="chip chip--danger">
          {overdue} devoir{overdue > 1 ? "s" : ""} en retard
        </span>
      ) : null}
    </div>
  );
}
