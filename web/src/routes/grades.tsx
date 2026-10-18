import { useMemo, useState } from "react";
import { useApp, useResource } from "../ui/AppContext";
import { EmptyState, ErrorBox, Loading, Page, StaleBadge } from "../ui/components";
import { IconGrades } from "../ui/icons";
import {
  gradeGroups,
  gradesForPeriod,
  gradesQuery,
  parseGradesPayload,
  parsePeriods,
  type Algorithm,
} from "../features/grades/model";
import { GradesHero, GradesSubjectSections, GradesToolbar } from "../features/grades/components";
import "../features/grades/grades.css";

/**
 * Onglet Notes : moyenne générale, historique, sélecteurs de période et
 * d'algorithme, puis notes groupées par matière.
 *
 * Changer de période ou d'algorithme change la QUERY de la ressource : le
 * natif recalcule moyennes, historique et influences, l'écran ne fait que
 * demander une autre tranche. Sans rapport dans le payload (cache ancien,
 * pont de développement), le calcul est refait localement par `model.ts`.
 */
export default function GradesRoute() {
  const { dark } = useApp();
  const [algorithm, setAlgorithm] = useState<Algorithm>("subject");
  const [periodId, setPeriodId] = useState<string | null>(null);

  const query = gradesQuery(algorithm, periodId);
  const gradesResource = useResource("grades", query);
  const periodsResource = useResource("periods");

  const data = useMemo(
    () => parseGradesPayload(gradesResource.payload, algorithm, periodId),
    [gradesResource.payload, algorithm, periodId],
  );
  const periods = useMemo(() => parsePeriods(periodsResource.payload), [periodsResource.payload]);
  const visibleGrades = useMemo(() => gradesForPeriod(data.grades, periodId), [data.grades, periodId]);
  const groups = useMemo(
    () => gradeGroups(visibleGrades, data.report?.subjects ?? []),
    [visibleGrades, data.report],
  );

  const hasPayload = gradesResource.payload !== null;
  const hasData = data.report !== null || data.grades.length > 0;

  if (gradesResource.loading && !hasPayload) {
    return (
      <Page>
        <Loading label="Chargement des notes…" />
      </Page>
    );
  }

  if (!hasData && !hasPayload) {
    return (
      <Page>
        <ErrorBox message={gradesResource.error ?? "Notes indisponibles."}>
          <button type="button" className="btn btn--ghost" style={{ marginTop: 10 }} onClick={gradesResource.refresh}>
            Réessayer
          </button>
        </ErrorBox>
      </Page>
    );
  }

  if (!hasData) {
    return (
      <Page>
        <EmptyState
          icon={<IconGrades size={28} />}
          title="Aucune note en cache"
          body="Actualise pour lire les notes de l’établissement."
          action={
            <button type="button" className="btn" onClick={gradesResource.refresh}>
              Actualiser
            </button>
          }
        />
      </Page>
    );
  }

  return (
    <Page className="grades">
      <div className="grades-headline">
        {gradesResource.stale && !gradesResource.loading ? <StaleBadge /> : null}
        {periodsResource.error ? <span className="grades-caption">{periodsResource.error}</span> : null}
      </div>

      {gradesResource.error ? (
        <p className="grades-error-line" role="alert">
          {gradesResource.error}
        </p>
      ) : null}

      <GradesToolbar
        algorithm={algorithm}
        onAlgorithm={setAlgorithm}
        periods={periods}
        periodId={periodId}
        onPeriod={setPeriodId}
      />

      {data.report ? <GradesHero report={data.report} /> : null}

      {groups.length > 0 && data.report ? (
        <GradesSubjectSections groups={groups} report={data.report} dark={dark} />
      ) : (
        <EmptyState
          icon={<IconGrades size={28} />}
          title="Aucune note sur cette période"
          body="L’établissement n’a publié aucune note ici."
        />
      )}
    </Page>
  );
}
