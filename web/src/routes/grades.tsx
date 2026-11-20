import { useMemo, useState } from "react";
import { useApp, useResource } from "../ui/AppContext";
import {
  gradesQuery,
  isPeriodsPayloadReadable,
  parsePeriods,
  type Algorithm,
} from "../features/grades/model";
import { GradesScreen } from "../features/grades/components";
import "../features/grades/grades.css";

/** Changer de période ou d'algorithme change la QUERY : le natif recalcule.
 *  Sans rapport dans le payload (cache ancien, pont de dev), `model.ts`
 *  recalcule localement. `useResource` invalide le payload au changement. */
export default function GradesRoute() {
  const { dark } = useApp();
  const [algorithm, setAlgorithm] = useState<Algorithm>("subject");
  const [periodId, setPeriodId] = useState<string | null>(null);

  const query = gradesQuery(algorithm, periodId);
  const gradesResource = useResource("grades", query);
  const periodsResource = useResource("periods");
  const periods = useMemo(() => parsePeriods(periodsResource.payload), [periodsResource.payload]);
  const periodsError =
    periodsResource.error ??
    (!periodsResource.loading
      ? periodsResource.payload === null
        ? "Périodes indisponibles : aucune donnée n’a été lue."
        : !isPeriodsPayloadReadable(periodsResource.payload)
          ? "Périodes illisibles : la donnée n’a pas pu être lue."
          : null
      : null);

  return (
    <GradesScreen
      payload={gradesResource.payload}
      loading={gradesResource.loading}
      error={gradesResource.error}
      stale={gradesResource.stale}
      fetchedAt={gradesResource.fetchedAt}
      cause={gradesResource.cause}
      periodsError={periodsError}
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
