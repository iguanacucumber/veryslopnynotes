import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { IconChevronRight, IconGrades } from "../../ui/icons";
import { frDateShort, subjectColor, tint } from "../../lib/format";
import { subjectEmoji } from "../../lib/subjectVisual";
import { EmptyState, ErrorBox, Loading, Page, StaleBadge } from "../../ui/components";
import {
  algorithmChipLabel,
  algorithmHint,
  ALGORITHMS,
  averageLabel,
  coverageLabel,
  formatMark,
  gradeContextLabel,
  gradeGroups,
  gradeLabel,
  gradeValueLabel,
  gradesForPeriod,
  historyNote,
  influenceLabel,
  influenceOf,
  isGradesPayloadReadable,
  originLabel,
  parseGradesPayload,
  periodLabel,
  reportTitle,
  scaleSuffix,
  sparklineAverageY,
  sparklineDescription,
  sparklinePoints,
  type Algorithm,
  type AveragesReport,
  type Grade,
  type GradeGroup,
  type Period,
} from "./model";

const CHART_HEIGHT = 96;
/** Largeur de repli avant la première mesure ; recalculée à la taille réelle. */
const CHART_FALLBACK_WIDTH = 320;

/** Écran SANS donnée : un payload illisible est une ERREUR, jamais « aucune note » (I14). */
export function GradesNoData({
  payload,
  loading,
  error,
  onRefresh,
}: {
  payload: string | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  if (loading && payload === null) {
    return <Loading label="Chargement des notes…" />;
  }
  if (payload === null) {
    return (
      <ErrorBox message={error ?? "Notes indisponibles."}>
        <button type="button" className="btn btn--small" onClick={onRefresh}>
          Réessayer
        </button>
      </ErrorBox>
    );
  }
  if (!isGradesPayloadReadable(payload)) {
    return (
      <ErrorBox message="Cache de notes illisible : la donnée n’a pas pu être lue.">
        <button type="button" className="btn btn--small" onClick={onRefresh}>
          Réessayer
        </button>
      </ErrorBox>
    );
  }
  return (
    <EmptyState
      icon={<IconGrades size={30} />}
      title="Aucune note en cache"
      body="Actualise pour lire les notes de l’établissement."
      action={
        <button type="button" className="btn btn--small" onClick={onRefresh}>
          Actualiser
        </button>
      }
    />
  );
}

interface ChartPoint {
  x: number;
  y: number;
}

/** Courbe de Catmull-Rom convertie en Bézier cubiques : pas de cassure. */
function smoothPath(points: ChartPoint[]): string {
  if (points.length === 0) return "";
  const first = points[0]!;
  if (points.length === 1) return `M ${first.x.toFixed(1)} ${first.y.toFixed(1)}`;
  let path = `M ${first.x.toFixed(1)} ${first.y.toFixed(1)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] ?? points[index]!;
    const p1 = points[index]!;
    const p2 = points[index + 1]!;
    const p3 = points[index + 2] ?? p2;
    const tension = 0.18;
    const c1x = p1.x + (p2.x - p0.x) * tension;
    const c1y = p1.y + (p2.y - p0.y) * tension;
    const c2x = p2.x - (p3.x - p1.x) * tension;
    const c2y = p2.y - (p3.y - p1.y) * tension;
    path += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return path;
}

function subjectTint(hex: string, dark: boolean): { background: string; ink: string } {
  return {
    background: tint(hex, dark ? -0.62 : 0.86),
    ink: dark ? tint(hex, 0.4) : tint(hex, -0.45),
  };
}

/** Géométrie ISOTROPE : `viewBox` en pixels réels, sinon un cadre étiré déforme
 *  la courbe et la pastille en ellipses. */
export function Sparkline({
  values,
  width,
  provided = false,
}: {
  values: Array<number | null>;
  width?: number;
  provided?: boolean;
}) {
  const ref = useRef<SVGSVGElement | null>(null);
  const [measured, setMeasured] = useState(0);

  // Largeur réelle : `viewBox` suit le conteneur, échelle 1:1 du téléphone à
  // la tablette.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      // La taille de MISE EN PAGE (pas la boîte transformée) : le cadre reste
      // dans les mêmes unités que l'écran.
      const next = entries[0]?.contentRect.width ?? 0;
      if (next > 0) setMeasured(next);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const chartWidth = width ?? (measured > 0 ? measured : CHART_FALLBACK_WIDTH);
  const points = sparklinePoints(values, chartWidth, CHART_HEIGHT);
  const averageY = sparklineAverageY(values, CHART_HEIGHT);
  const description = sparklineDescription(values, provided);
  if (points.length === 0) return null;
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;
  const path = smoothPath(points);
  const area = `${path} L ${last.x.toFixed(1)} ${CHART_HEIGHT} L ${first.x.toFixed(1)} ${CHART_HEIGHT} Z`;
  return (
    <svg
      ref={ref}
      className="grades-chart"
      viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT}`}
      role="img"
      aria-label={description}
    >
      {averageY !== null && points.length > 1 ? (
        <line
          className="grades-chart__grid"
          x1={0}
          y1={averageY.toFixed(1)}
          x2={chartWidth}
          y2={averageY.toFixed(1)}
        />
      ) : null}
      {points.length > 1 ? <path className="grades-chart__area" d={area} /> : null}
      {points.length > 1 ? <path className="grades-chart__line" d={path} pathLength={1} /> : null}
      {/* Remplissages : `vector-effect` ne s'applique qu'aux traits — ici
          l'échelle est uniforme, les cercles restent ronds. */}
      <circle className="grades-chart__halo" cx={last.x} cy={last.y} r={8} />
      <circle className="grades-chart__dot" cx={last.x} cy={last.y} r={3.5} />
    </svg>
  );
}

export function GradesHero({ report }: { report: AveragesReport }) {
  const titleId = useId();
  const value = report.generalValue;
  const lastHistory = report.history[report.history.length - 1]?.date ?? null;
  const note = historyNote(
    report.history.map((point) => point.value),
    report.provided,
  );
  const coverage = coverageLabel(report);
  return (
    <section className="card grades-hero" aria-labelledby={titleId}>
      <div className="grades-hero__top">
        <h2 id={titleId} className="grades-hero__title">
          {reportTitle(report)}
        </h2>
        <span className="grades-tag">{report.provided ? "établissement" : "estimée"}</span>
      </div>
      <div className="grades-hero__figure" role="img" aria-label={averageLabel(value, report.provided, report.algorithm)}>
        {value === null ? (
          <span className="grades-hero__empty">Aucune moyenne sur cette période</span>
        ) : (
          <>
            <span className="grades-hero__value">{formatMark(value)}</span>
            <span className="grades-hero__scale">/20</span>
          </>
        )}
      </div>
      <p className="grades-hero__origin">
        {originLabel(report.provided, lastHistory)}
        {coverage ? ` · ${coverage}` : ""}
      </p>
      <Sparkline values={report.history.map((point) => point.value)} provided={report.provided} />
      {note ? <p className="grades-hero__note">{note}</p> : null}
    </section>
  );
}

export function LatestGrades({ groups, dark }: { groups: GradeGroup[]; dark: boolean }) {
  const latest = groups
    .flatMap((group) => group.grades)
    .slice()
    .sort((a, b) => (b.millis ?? 0) - (a.millis ?? 0))
    .slice(0, 6);
  if (latest.length === 0) return null;
  return (
    <section className="grades-latest" aria-label="Dernières notes">
      <h2 className="grades-latest__title">Dernières notes</h2>
      <div className="h-scroll grades-latest__track">
        {latest.map((grade) => {
          const color = subjectColor(grade.subject);
          const palette = subjectTint(color, dark);
          return (
            <article
              className="grades-latest__card"
              key={grade.id}
              style={{ background: palette.background, color: palette.ink }}
            >
              <div className="grades-latest__head">
                <span className="grades-latest__emoji" aria-hidden="true">
                  {subjectEmoji(grade.subject)}
                </span>
                <span className="grades-latest__subject">{grade.subject}</span>
              </div>
              <p className="grades-latest__label">{gradeLabel(grade)}</p>
              <div className="grades-latest__foot">
                <span className="grades-latest__date">{frDateShort(grade.date)}</span>
                <span className="grades-pill grades-pill--small grades-latest__value">
                  {gradeValueLabel(grade.value)}
                  {scaleSuffix(grade.scale)}
                </span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function GradesToolbar({
  algorithm,
  onAlgorithm,
  periods,
  periodId,
  onPeriod,
  provided,
}: {
  algorithm: Algorithm;
  onAlgorithm: (algorithm: Algorithm) => void;
  periods: Period[];
  periodId: string | null;
  onPeriod: (periodId: string | null) => void;
  provided: boolean;
}) {
  const selected = periods.find((period) => period.id === periodId) ?? null;
  return (
    <div className="stack grades-toolbar">
      {periods.length > 0 ? (
        <label className="grades-field">
          <span>Période</span>
          <select
            value={periodId ?? ""}
            onChange={(event) => onPeriod(event.target.value || null)}
            aria-describedby={selected ? "grades-period-caption" : undefined}
          >
            <option value="">Année</option>
            {periods.map((period) => (
              <option key={period.id} value={period.id}>
                {period.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {selected ? (
        <p id="grades-period-caption" className="grades-caption">
          {periodLabel(selected)}
        </p>
      ) : null}
      <div className="grades-algorithms" role="group" aria-label="Calcul de la moyenne">
        {ALGORITHMS.map((choice) => (
          <button
            key={choice}
            type="button"
            className={`grades-chip${choice === algorithm ? " grades-chip--active" : ""}`}
            aria-pressed={choice === algorithm}
            onClick={() => onAlgorithm(choice)}
          >
            {algorithmChipLabel(choice)}
          </button>
        ))}
      </div>
      <p className="grades-caption" aria-live="polite">
        {algorithmHint(algorithm, provided)}
      </p>
    </div>
  );
}

function GradeRow({
  grade,
  influence,
  estimated,
  dark,
}: {
  grade: Grade;
  influence: number | null;
  estimated: boolean;
  dark: boolean;
}) {
  const color = subjectColor(grade.subject);
  const palette = subjectTint(color, dark);
  const context = gradeContextLabel(grade);
  return (
    <li className="grades-grade">
      <div className="grades-grade__body">
        <p className="grades-grade__title">{gradeLabel(grade)}</p>
        <p className="grades-grade__meta">
          {frDateShort(grade.date)}
          {context ? ` · ${context}` : ""}
        </p>
        {influence !== null ? (
          <p className={`grades-grade__influence${influence < 0 ? " grades-grade__influence--down" : ""}`}>
            {influenceLabel(influence, estimated)}
          </p>
        ) : null}
      </div>
      <span
        className="grades-pill"
        style={{ background: palette.background, color: palette.ink }}
        aria-label={`Note ${gradeValueLabel(grade.value)} sur ${gradeValueLabel(grade.scale)}`}
      >
        <span aria-hidden="true">
          {gradeValueLabel(grade.value)}
          {scaleSuffix(grade.scale)}
        </span>
      </span>
    </li>
  );
}

function SubjectSection({
  group,
  report,
  dark,
}: {
  group: GradeGroup;
  report: AveragesReport;
  dark: boolean;
}) {
  const color = subjectColor(group.subject);
  const palette = subjectTint(color, dark);
  return (
    <details className="grades-subject">
      <summary className="grades-subject__summary">
        <span className="grades-subject__emoji" aria-hidden="true">
          {subjectEmoji(group.subject)}
        </span>
        <span className="grades-subject__name">
          <span className="grades-subject__title">{group.subject}</span>
          <span className="grades-subject__meter" aria-hidden="true">
            <span
              className="grades-subject__meter-fill"
              style={{
                width: `${group.average === null ? 0 : Math.max(0, Math.min(1, group.average / 20)) * 100}%`,
                background: color,
              }}
            />
          </span>
          <span className="grades-caption">
            {group.gradeCount} note{group.gradeCount > 1 ? "s" : ""}
            {group.provided ? " · établissement" : ""}
          </span>
        </span>
        {group.average !== null ? (
          <span className="grades-subject__average" style={{ color: palette.ink }}>
            {formatMark(group.average)}
            <span className="grades-subject__scale">{scaleSuffix(20)}</span>
          </span>
        ) : (
          <span className="grades-caption grades-subject__none">Pas de moyenne</span>
        )}
        <IconChevronRight className="grades-chevron" size={18} />
      </summary>
      <ul className="grades-list">
        {group.grades.map((grade) => {
          const influence = influenceOf(report.influences, grade.id);
          return (
            <GradeRow
              key={grade.id}
              grade={grade}
              influence={influence?.impact ?? null}
              estimated={report.provided}
              dark={dark}
            />
          );
        })}
      </ul>
    </details>
  );
}

export function GradesSubjectSections({
  groups,
  report,
  dark,
}: {
  groups: GradeGroup[];
  report: AveragesReport;
  dark: boolean;
}) {
  return (
    <section className="grades-ledger" aria-label="Notes par matière">
      {groups.map((group) => (
        <SubjectSection key={group.subject} group={group} report={report} dark={dark} />
      ))}
    </section>
  );
}

/** Écran PUR : il ne lit que ce qu'on lui donne. Le payload porte déjà la
 *  requête à laquelle il appartient (invalidé par `useResource`). */
export function GradesScreen({
  payload,
  loading,
  error,
  stale,
  periodsError,
  algorithm,
  periodId,
  periods,
  dark,
  onAlgorithm,
  onPeriod,
  onRefresh,
}: {
  payload: string | null;
  loading: boolean;
  error: string | null;
  stale: boolean;
  periodsError: string | null;
  algorithm: Algorithm;
  periodId: string | null;
  periods: Period[];
  dark: boolean;
  onAlgorithm: (algorithm: Algorithm) => void;
  onPeriod: (periodId: string | null) => void;
  onRefresh: () => void;
}) {
  const data = useMemo(() => parseGradesPayload(payload, algorithm, periodId), [payload, algorithm, periodId]);
  const visibleGrades = useMemo(() => gradesForPeriod(data.grades, periodId), [data.grades, periodId]);
  const groups = useMemo(
    () => gradeGroups(visibleGrades, data.report?.subjects ?? []),
    [visibleGrades, data.report],
  );

  const hasData = data.report !== null || data.grades.length > 0;

  if (!hasData) {
    return (
      <Page>
        <GradesNoData payload={payload} loading={loading} error={error} onRefresh={onRefresh} />
      </Page>
    );
  }

  return (
    <Page className="grades">
      <div className="grades-headline">
        {stale && !loading ? <StaleBadge /> : null}
        {periodsError ? <span className="grades-caption">{periodsError}</span> : null}
      </div>

      {error ? (
        <p className="grades-error-line" role="alert">
          {error}
        </p>
      ) : null}

      <GradesToolbar
        algorithm={algorithm}
        onAlgorithm={onAlgorithm}
        periods={periods}
        periodId={periodId}
        onPeriod={onPeriod}
        provided={data.report?.provided ?? false}
      />

      {data.report ? <GradesHero report={data.report} /> : null}

      {groups.length > 0 ? <LatestGrades groups={groups} dark={dark} /> : null}

      {groups.length > 0 && data.report ? (
        <GradesSubjectSections groups={groups} report={data.report} dark={dark} />
      ) : (
        <EmptyState
          icon={<IconGrades size={30} />}
          title="Aucune note sur cette période"
          body="L’établissement n’a publié aucune note ici."
        />
      )}
    </Page>
  );
}
