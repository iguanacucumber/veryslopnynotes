import { useMemo, useState } from "react";
import { useApp, useResource } from "../ui/AppContext";
import {
  gradesQuery,
  parsePeriods,
  type Algorithm,
} from "../features/grades/model";
import { GradesScreen } from "../features/grades/components";
import "../features/grades/grades.css";

/**
 * Onglet Notes : moyenne générale, historique, sélecteurs de période et
 * d'algorithme, puis notes groupées par matière.
 *
 * Changer de période ou d'algorithme change la QUERY de la ressource : le
 * natif recalcule moyennes, historique et influences, l'écran ne fait que
 * demander une autre tranche. Sans rapport dans le payload (cache ancien,
 * pont de développement), le calcul est refait localement par `model.ts`.
 *
 * Le payload affiché est celui de la requête COURANTE : `useResource`
 * invalide le précédent au changement de requête (#527) — l'écran ne
 * montre jamais les chiffres d'une autre période.
 */
export default function GradesRoute() {
  const { dark } = useApp();
  const [algorithm, setAlgorithm] = useState<Algorithm>("subject");
  const [periodId, setPeriodId] = useState<string | null>(null);

  const query = gradesQuery(algorithm, periodId);
  const gradesResource = useResource("grades", query);
  const periodsResource = useResource("periods");
  const periods = useMemo(() => parsePeriods(periodsResource.payload), [periodsResource.payload]);

  return (
    <GradesScreen
      payload={gradesResource.payload}
      loading={gradesResource.loading}
      error={gradesResource.error}
      stale={gradesResource.stale}
      periodsError={periodsResource.error}
      algorithm={algorithm}
      periodId={periodId}
      periods={periods}
      dark={dark}
      onAlgorithm={setAlgorithm}
      onPeriod={setPeriodId}
      onRefresh={gradesResource.refresh}
    />
  );
}
