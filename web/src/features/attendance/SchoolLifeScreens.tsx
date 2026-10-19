import { useId } from "react";
import { Link } from "react-router-dom";
import { Card, EmptyState, ErrorBox, Loading, StaleBadge } from "../../ui/components";
import { IconCheck, IconRefresh, IconShield, IconWarning } from "../../ui/icons";
import {
  absenceTitle,
  attendanceSections,
  attendanceStatus,
  durationLongFr,
  formatDateSpan,
  formatLongDate,
  gravityLabel,
  isUnjustified,
  justifiedLabel,
  type Absence,
  type Punishment,
} from "./model";

interface AttendanceProps {
  rows: Absence[];
  loading: boolean;
  error: string | null;
  stale: boolean;
  onlyPending: boolean;
  canSeeSanctions: boolean;
  onOnlyPendingChange: (value: boolean) => void;
  onRefresh: () => void;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count > 1 ? many : one}`;
}

export function AttendanceScreen({
  rows,
  loading,
  error,
  stale,
  onlyPending,
  canSeeSanctions,
  onOnlyPendingChange,
  onRefresh,
}: AttendanceProps) {
  const filterId = useId();
  const status = attendanceStatus(rows);
  const shown = onlyPending ? rows.filter(isUnjustified) : rows;
  const sections = attendanceSections(shown);
  const unjustifiedCount = status.unjustifiedCount;

  if (loading && rows.length === 0) return <Loading label="Chargement de la vie scolaire…" />;

  if (error && rows.length === 0) {
    return (
      <ErrorBox message={error}>
        <button type="button" className="btn btn--ghost btn--small" style={{ minHeight: 48 }} onClick={onRefresh}>
          Réessayer
        </button>
      </ErrorBox>
    );
  }

  return (
    <div className="stack">
      <div className="row row--wrap">
        <h2 className="t-title grow" style={{ margin: 0 }}>
          Absences et retards
        </h2>
        {stale ? <StaleBadge /> : null}
        <button type="button" className="icon-btn" aria-label="Actualiser la vie scolaire" onClick={onRefresh}>
          <IconRefresh />
        </button>
      </div>

      {error ? (
        <ErrorBox message={error}>
          <button type="button" className="btn btn--ghost btn--small" style={{ minHeight: 48 }} onClick={onRefresh}>
            Réessayer
          </button>
        </ErrorBox>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon={<IconCheck size={30} />}
          title="Aucune absence ni retard"
          body="L’établissement n’a rien publié sur cette période."
          action={
            <button type="button" className="btn btn--ghost btn--small" style={{ minHeight: 48 }} onClick={onRefresh}>
              Actualiser
            </button>
          }
        />
      ) : (
        <>
          <Card
            className={`school-summary${status.clean ? " school-summary--clean" : " school-summary--alert"}`}
            as="article"
          >
            <div className="row" style={{ alignItems: "flex-start" }}>
              <span style={{ color: status.clean ? "var(--brand-deep)" : "var(--danger-ink)" }}>
                {status.clean ? <IconCheck size={26} /> : <IconWarning size={26} />}
              </span>
              <div className="grow">
                <h3 className="t-body" style={{ margin: 0 }}>
                  {status.title}
                </h3>
                <p className="tiny muted" style={{ margin: "4px 0 0" }}>
                  {status.detail}
                </p>
                <p className="tiny muted" style={{ margin: "6px 0 0" }}>
                  {plural(status.eventCount, "événement", "événements")} ·{" "}
                  {plural(status.absenceCount, "absence", "absences")} ·{" "}
                  {plural(status.lateCount, "retard", "retards")}
                </p>
                <p className="tiny muted" style={{ margin: "2px 0 0" }}>
                  {plural(status.justifiedCount, "justifié", "justifiés")} ·{" "}
                  {plural(unjustifiedCount, "à justifier", "à justifier")}
                </p>
              </div>
            </div>
            <div className="row row--between" style={{ marginTop: 12 }}>
              <span className="t-body-m muted">Heures manquées</span>
              <strong className="t-body">{durationLongFr(status.totalMinutes)}</strong>
            </div>
          </Card>

          <div className="row" role="group" aria-labelledby={filterId}>
            <span className="sr-only" id={filterId}>
              Filtrer les événements
            </span>
            <button
              type="button"
              className={`chip${onlyPending ? "" : " chip--active"}`}
              style={{ minHeight: 48 }}
              aria-pressed={!onlyPending}
              onClick={() => onOnlyPendingChange(false)}
            >
              Tout ({rows.length})
            </button>
            <button
              type="button"
              className={`chip${onlyPending ? " chip--active" : ""}`}
              style={{ minHeight: 48 }}
              aria-pressed={onlyPending}
              onClick={() => onOnlyPendingChange(true)}
            >
              À justifier ({unjustifiedCount})
            </button>
          </div>

          {canSeeSanctions ? (
            <Card className="card--flat" as="article">
              <div className="row">
                <IconShield size={24} />
                <div className="grow">
                  <strong className="t-body-m">Sanctions</strong>
                  <p className="tiny muted" style={{ margin: 0 }}>
                    Les sanctions publiées par l’établissement.
                  </p>
                </div>
                <Link to="/sanctions" className="btn btn--ghost btn--small" style={{ minHeight: 48 }}>
                  Voir
                </Link>
              </div>
            </Card>
          ) : null}

          {sections.length === 0 ? (
            <EmptyState
              icon={<IconCheck size={30} />}
              title="Aucun événement à justifier"
              body="Toutes les absences et tous les retards publiés sont justifiés."
              action={
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  style={{ minHeight: 48 }}
                  onClick={() => onOnlyPendingChange(false)}
                >
                  Voir tout
                </button>
              }
            />
          ) : (
            sections.map((section) => (
              <section key={section.kind} aria-labelledby={`section-${section.kind}`}>
                <h3 className="t-title" id={`section-${section.kind}`} style={{ margin: "8px 0" }}>
                  {section.title} ({section.rows.length})
                </h3>
                <div className="list">
                  {section.rows.map((row) => (
                    <AttendanceRow key={row.id} row={row} />
                  ))}
                </div>
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
}

function AttendanceRow({ row }: { row: Absence }) {
  const span = formatDateSpan(row);
  const badge = justifiedLabel(row.justified);
  const unjustified = isUnjustified(row);
  return (
    <Card as="article" className="card--flat">
      <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <h4 className="t-body" style={{ margin: 0, overflowWrap: "anywhere" }}>
            {absenceTitle(row)}
          </h4>
          {span ? (
            <p className="tiny muted" style={{ margin: "2px 0 0", overflowWrap: "anywhere" }}>
              {span}
            </p>
          ) : null}
        </div>
        {row.minutes !== null ? (
          <strong
            className="t-body"
            style={{ color: unjustified ? "var(--danger-ink)" : "inherit", whiteSpace: "nowrap" }}
          >
            {durationLongFr(row.minutes)}
          </strong>
        ) : null}
      </div>
      {badge || row.subject ? (
        <div className="row row--wrap" style={{ marginTop: 8, gap: 8 }}>
          {badge ? (
            <span className={`chip${unjustified ? " chip--danger" : ""}`} aria-label={`Justificatif : ${badge}`}>
              {badge}
            </span>
          ) : null}
          {row.subject ? <span className="tiny muted">{row.subject}</span> : null}
        </div>
      ) : null}
    </Card>
  );
}

interface SanctionsProps {
  rows: Punishment[];
  loading: boolean;
  error: string | null;
  stale: boolean;
  onRefresh: () => void;
}

export function SanctionsScreen({ rows, loading, error, stale, onRefresh }: SanctionsProps) {
  return (
    <div className="stack">
      <div className="row row--wrap">
        <h2 className="t-title grow" style={{ margin: 0 }}>
          Sanctions déclarées ({rows.length})
        </h2>
        {stale ? <StaleBadge /> : null}
        <button type="button" className="icon-btn" aria-label="Actualiser les sanctions" onClick={onRefresh}>
          <IconRefresh />
        </button>
      </div>

      {error ? (
        <ErrorBox message={error}>
          <button type="button" className="btn btn--ghost btn--small" style={{ minHeight: 48 }} onClick={onRefresh}>
            Réessayer
          </button>
        </ErrorBox>
      ) : null}

      {loading && rows.length === 0 ? (
        <Loading label="Chargement des sanctions…" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<IconShield size={30} />}
          title="Aucune sanction publiée"
          body="L’établissement n’a publié aucune sanction."
          action={
            <button type="button" className="btn btn--ghost btn--small" style={{ minHeight: 48 }} onClick={onRefresh}>
              Actualiser
            </button>
          }
        />
      ) : (
        <div className="list">
          {rows.map((row, index) => {
            const gravity = gravityLabel(row.gravity);
            const date = formatLongDate(row.date);
            return (
              <Card key={row.id || `punition-${index}`} as="article" className="card--flat">
                <h3 className="t-body" style={{ margin: 0, overflowWrap: "anywhere" }}>
                  {row.type}
                </h3>
                {date ? (
                  <p className="tiny muted" style={{ margin: "2px 0 0" }}>
                    {date}
                  </p>
                ) : null}
                <div className="row row--wrap" style={{ marginTop: 8, gap: 8 }}>
                  {gravity ? (
                    <span className="chip chip--danger" aria-label={`Gravité publiée : ${gravity}`}>
                      {gravity}
                    </span>
                  ) : null}
                  {row.durationMinutes !== null ? (
                    <span className="chip" aria-label={`Durée : ${durationLongFr(row.durationMinutes)}`}>
                      Durée : {durationLongFr(row.durationMinutes)}
                    </span>
                  ) : null}
                </div>
                <p className="t-body-m" style={{ margin: "8px 0 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                  {row.motif}
                </p>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
