import { useId } from "react";
import { IconChevronRight, IconGrades } from "../../ui/icons";
import { frDateShort, subjectColor, tint } from "../../lib/format";
import { EmptyState, ErrorBox, Loading, SubjectAvatar } from "../../ui/components";
import {
  algorithmChipLabel,
  algorithmHint,
  algorithmLabel,
  ALGORITHMS,
  averageLabel,
  formatMark,
  gradeContextLabel,
  gradeLabel,
  gradeValueLabel,
  historyNote,
  influenceLabel,
  influenceOf,
  isGradesPayloadReadable,
  originLabel,
  periodLabel,
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

const CHART_WIDTH = 320;
const CHART_HEIGHT = 96;

/**
 * Écran SANS donnée : distingue trois états, jamais deux (#537, I14).
 *
 * - pas de payload du tout = « Notes indisponibles » (erreur + Réessayer) ;
 * - payload CORROMPU (JSON illisible) = ERREUR : le cache n'est pas vide, il
 *   est illisible — dire « aucune note » affirmerait un fait faux ;
 * - payload lisible mais sans note = « Aucune note en cache » (état vide).
 *
 * Composant PUR (aucun état interne) : l'écran est donc rendu tel quel par
 * les tests (`tests/web/grades.test.ts`).
 */
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
        <button type="button" className="btn btn--ghost" style={{ marginTop: 10 }} onClick={onRefresh}>
          Réessayer
        </button>
      </ErrorBox>
    );
  }
  if (!isGradesPayloadReadable(payload)) {
    return (
      <ErrorBox message="Cache de notes illisible : la donnée n’a pas pu être lue.">
        <button type="button" className="btn btn--ghost" style={{ marginTop: 10 }} onClick={onRefresh}>
          Réessayer
        </button>
      </ErrorBox>
    );
  }
  return (
    <EmptyState
      icon={<IconGrades size={28} />}
      title="Aucune note en cache"
      body="Actualise pour lire les notes de l’établissement."
      action={
        <button type="button" className="btn" onClick={onRefresh}>
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

/** Pastille de couleur de matière (fond teinté, encre foncée/éclaircie). */
function subjectTint(hex: string, dark: boolean): { background: string; ink: string } {
  return {
    background: tint(hex, dark ? -0.62 : 0.86),
    ink: dark ? tint(hex, 0.4) : tint(hex, -0.45),
  };
}

/**
 * Sparkline de l'historique, dessinée en SVG inline (aucune dépendance).
 * Décorative pour le lecteur d'écran : la phrase `aria-label` porte le sens,
 * et le point final reprend le geste de la référence.
 */
export function Sparkline({ values }: { values: Array<number | null> }) {
  const points = sparklinePoints(values, CHART_WIDTH, CHART_HEIGHT);
  const averageY = sparklineAverageY(values, CHART_HEIGHT);
  const description = sparklineDescription(values);
  if (points.length === 0) return null;
  const line = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;
  const path = smoothPath(points);
  const area = `${path} L ${last.x.toFixed(1)} ${CHART_HEIGHT} L ${first.x.toFixed(1)} ${CHART_HEIGHT} Z`;
  return (
    <svg
      className="grades-chart"
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={description}
    >
      {averageY !== null && points.length > 1 ? (
        <line
          className="grades-chart__grid"
          x1={0}
          y1={averageY.toFixed(1)}
          x2={CHART_WIDTH}
          y2={averageY.toFixed(1)}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {points.length > 1 ? <path className="grades-chart__area" d={area} /> : null}
      {points.length > 1 ? (
        <path
          className="grades-chart__line"
          d={path}
          pathLength={1}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      <circle className="grades-chart__halo" cx={last.x} cy={last.y} r={8} vectorEffect="non-scaling-stroke" />
      <circle className="grades-chart__dot" cx={last.x} cy={last.y} r={3.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Carte moyenne générale : chiffre, provenance, courbe, mention d'historique. */
export function GradesHero({ report }: { report: AveragesReport }) {
  const titleId = useId();
  const value = report.generalValue;
  const lastHistory = report.history[report.history.length - 1]?.date ?? null;
  const note = historyNote(report.history.map((point) => point.value));
  return (
    <section className="card grades-hero" aria-labelledby={titleId}>
      <div className="grades-hero__top">
        <h2 id={titleId} className="grades-hero__title">
          {algorithmLabel(report.algorithm)}
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
      <p className="grades-hero__origin">{originLabel(report.provided, lastHistory)}</p>
      <Sparkline values={report.history.map((point) => point.value)} />
      {note ? <p className="grades-hero__note">{note}</p> : null}
    </section>
  );
}

/** Dernières notes : cartes horizontales, comme les « nouvelles notes » de Papillon. */
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
            <article className="grades-latest__card" key={grade.id}>
              <div className="grades-latest__head">
                <SubjectAvatar subject={grade.subject} size={28} dark={dark} />
                <span className="grades-latest__subject">{grade.subject}</span>
              </div>
              <p className="grades-latest__label">{gradeLabel(grade)}</p>
              <div className="grades-latest__foot">
                <span className="grades-latest__date">{frDateShort(grade.date)}</span>
                <span
                  className="grades-pill grades-pill--small"
                  style={{ background: palette.background, color: palette.ink }}
                >
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

/** Sélecteur de période natif + puces d'algorithme. */
export function GradesToolbar({
  algorithm,
  onAlgorithm,
  periods,
  periodId,
  onPeriod,
}: {
  algorithm: Algorithm;
  onAlgorithm: (algorithm: Algorithm) => void;
  periods: Period[];
  periodId: string | null;
  onPeriod: (periodId: string | null) => void;
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
        {algorithmHint(algorithm)}
      </p>
    </div>
  );
}

function GradeRow({ grade, influence, dark }: { grade: Grade; influence: number | null; dark: boolean }) {
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
            {influenceLabel(influence)}
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
    <details className="card grades-subject">
      <summary className="grades-subject__summary">
        <SubjectAvatar subject={group.subject} size={40} dark={dark} />
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
          return <GradeRow key={grade.id} grade={grade} influence={influence?.impact ?? null} dark={dark} />;
        })}
      </ul>
    </details>
  );
}

/** Sections par matière, notes dépliables (élément natif `details`). */
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
    <section className="stack" aria-label="Notes par matière">
      {groups.map((group) => (
        <SubjectSection key={group.subject} group={group} report={report} dark={dark} />
      ))}
    </section>
  );
}
