import { useId } from "react";
import type { ExerciseHelpMode, ExerciseItem, ExerciseProposal, TeacherMessage } from "../../bridge/types";
import { Card, EmptyState, ErrorBox, Loading, Page, PageHeading, Section } from "../../ui/components";
import { IconBook, IconCamera, IconImage, IconSparkles } from "../../ui/icons";
import { MarkdownBody } from "../revisions/MarkdownBody";
import {
  EXERCISE_MODES,
  exerciseDifficultyLabel,
  exerciseModeHint,
  exerciseModeLabel,
  exercisePageLabel,
  exerciseSources,
} from "./exercises";
import { teacherActionLabel, type TeacherTurnError } from "./teacher";

export interface ExerciseProposalState {
  loading: boolean;
  error: string;
  data: ExerciseProposal | null;
}

export interface ExerciseHelpState {
  loading: boolean;
  /** Dernier niveau demandé (affiché tel quel : correction = choix explicite). */
  mode: ExerciseHelpMode | null;
  message: TeacherMessage | null;
  error: TeacherTurnError | null;
  refusal: { message: string; actions: string[] } | null;
  answer: string;
}

/**
 * Une réponse d'aide ne s'applique qu'à la demande COURANTE et à l'exercice
 * encore sélectionné. Un clic sur un autre énoncé pendant le vol jette la
 * réponse tardive (correction et sources comprises) au lieu de l'afficher sous
 * le nouvel exercice ; l'exercice choisi reste donc vide.
 */
export function helpAnswerApplies(
  request: { seq: number; number: string },
  current: { seq: number; number: string | null },
): boolean {
  return request.seq === current.seq && request.number === current.number;
}

export interface ExercisesViewProps {
  subjects: string[];
  subject: string;
  hint: string;
  proposal: ExerciseProposalState;
  selected: ExerciseItem | null;
  help: ExerciseHelpState;
  onSubjectChange: (subject: string) => void;
  onHintChange: (hint: string) => void;
  onPropose: () => void;
  onSelect: (exercise: ExerciseItem) => void;
  onHelp: (mode: ExerciseHelpMode) => void;
  onAnswerChange: (answer: string) => void;
  onPhoto: (source: "camera" | "gallery") => void;
  onRetry: () => void;
  onAction: (action: string) => void;
  /** true = rendu DANS l'écran Prof (pas de second `<Page>`/titre). */
  embedded?: boolean;
}

/** PRÉSENTATIONNEL : ne parle pas au pont, donc testable en rendu statique.
 *  La correction complète n'est JAMAIS demandée automatiquement. */
export function ExercisesView({
  subjects,
  subject,
  hint,
  proposal,
  selected,
  help,
  onSubjectChange,
  onHintChange,
  onPropose,
  onSelect,
  onHelp,
  onAnswerChange,
  onPhoto,
  onRetry,
  onAction,
  embedded = false,
}: ExercisesViewProps) {
  const subjectId = useId();
  const hintId = useId();
  const answerId = useId();
  const data = proposal.data;
  const content = (
    <>
      <Section title="Matière">
        <Card className="teacher-subject">
          <label className="tiny muted" htmlFor={subjectId}>
            Matière du manuel
          </label>
          <select
            id={subjectId}
            className="field"
            value={subject}
            onChange={(event) => onSubjectChange(event.target.value)}
            disabled={proposal.loading}
          >
            <option value="">Choisir une matière…</option>
            {subjects.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <label className="tiny muted" htmlFor={hintId}>
            Page ou chapitre (facultatif)
          </label>
          <input
            id={hintId}
            className="field"
            value={hint}
            maxLength={120}
            placeholder="ex. 84, chapitre 5, suites…"
            onChange={(event) => onHintChange(event.target.value)}
            disabled={proposal.loading}
          />
          <button
            type="button"
            className="btn"
            onClick={onPropose}
            disabled={!subject || proposal.loading}
          >
            <IconSparkles size={16} />
            Propose-moi un exercice
          </button>
          <p className="tiny muted">
            Les énoncés viennent du texte du manuel ou de ton cahier. Aucun exercice n’est inventé.
          </p>
        </Card>
      </Section>

      <Section title="Exercices">
        <Card>
          {proposal.loading ? <Loading label="Recherche des exercices…" /> : null}
          {!proposal.loading && proposal.error ? (
            <ErrorBox message={proposal.error}>
              <button type="button" className="btn btn--small" onClick={onPropose}>
                Réessayer
              </button>
            </ErrorBox>
          ) : null}
          {!proposal.loading && !proposal.error && !data ? (
            <EmptyState
              icon={<IconBook size={30} />}
              title={subject ? "Prêt à chercher un exercice." : "Choisis d’abord une matière."}
              body="Le manuel de la matière est lu sur ton appareil ; sans manuel, le cahier de cours prend le relais."
            />
          ) : null}
          {!proposal.loading && data && data.exercises.length === 0 ? (
            <div className="teacher-refusal" role="status">
              <p>{data.message || "Aucun exercice lisible dans cette source."}</p>
              {!data.manualReady ? (
                <p className="tiny muted">
                  Le manuel n’est pas activé pour cette matière : ajoute un cours au cahier ou
                  enregistre ton manuel.
                </p>
              ) : null}
              <div className="teacher-refusal__actions">
                {(data.actions ?? []).map((action) => (
                  <button
                    key={action}
                    type="button"
                    className="btn btn--ghost btn--small"
                    onClick={() => onAction(action)}
                  >
                    {teacherActionLabel(action)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {!proposal.loading && data && data.exercises.length > 0 ? (
            <ul className="exercise-list" aria-label="Exercices proposés">
              {data.exercises.map((exercise) => {
                const active = selected?.number === exercise.number && selected.statement === exercise.statement;
                return (
                  <li key={`${exercise.number}:${exercise.statement.slice(0, 40)}`}>
                    <button
                      type="button"
                      className={`exercise-item${active ? " exercise-item--active" : ""}`}
                      aria-pressed={active}
                      onClick={() => onSelect(exercise)}
                    >
                      <span className="exercise-item__number">Exercice {exercise.number}</span>
                      <span className="exercise-item__statement">{exercise.statement}</span>
                      <span className="exercise-item__meta tiny muted">
                        {[exercisePageLabel(exercise), exerciseDifficultyLabel(exercise.difficulty)]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {selected ? (
            <div className="exercise-detail">
              <h3 className="exercise-detail__title">Exercice {selected.number}</h3>
              <p className="exercise-detail__statement">{selected.statement}</p>
              <p className="tiny muted">
                {[selected.source, exercisePageLabel(selected)].filter(Boolean).join(" · ")}
              </p>

              <label className="tiny muted" htmlFor={answerId}>
                Ta réponse (facultative pour un indice)
              </label>
              <textarea
                id={answerId}
                className="field field--area"
                value={help.answer}
                rows={3}
                maxLength={2000}
                placeholder="Écris ta réponse, ou photographie-la."
                onChange={(event) => onAnswerChange(event.target.value)}
                disabled={help.loading}
              />
              <div className="exercise-photo">
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() => onPhoto("camera")}
                  disabled={help.loading}
                >
                  <IconCamera size={16} />
                  Photographier ma réponse
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() => onPhoto("gallery")}
                  disabled={help.loading}
                >
                  <IconImage size={16} />
                  Depuis la galerie
                </button>
              </div>

              <div className="exercise-modes" role="group" aria-label="Niveau d’aide">
                {EXERCISE_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className="btn btn--ghost btn--small"
                    onClick={() => onHelp(mode)}
                    disabled={help.loading}
                  >
                    {exerciseModeLabel(mode)}
                  </button>
                ))}
              </div>
              <p className="tiny muted">{exerciseModeHint(help.mode ?? "hint")}</p>

              {help.loading ? (
                <p className="exercise-help__status">
                  <span className="spinner" aria-hidden="true" />
                  <span>{help.mode === "correction" ? "Correction en cours…" : "Le professeur réfléchit…"}</span>
                </p>
              ) : null}
              {help.message ? (
                <div className="exercise-answer">
                  <MarkdownBody text={help.message.text} />
                  {help.message.sources.length > 0 ? (
                    <div className="teacher-bubble__citations">
                      <span className="tiny muted">Sources :</span>
                      <ul className="teacher-sources">
                        {help.message.sources.map((source) => (
                          <li key={source} className="teacher-source">
                            {source}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="teacher-unsourced">
                      <span className="teacher-unsourced__badge">non sourcée</span>
                    </p>
                  )}
                  {exerciseSources(help.message.context).length > 0 ? (
                    <details className="exercise-help__privacy">
                      <summary>Ce qui est envoyé</summary>
                      <ul className="exercise-help__context tiny muted">
                        {exerciseSources(help.message.context).map((source, index) => (
                          <li key={`${source.type}:${source.label}:${index}`}>
                            {source.label} ({source.chars} caractères{source.truncated ? ", tronquée" : ""})
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
              ) : null}
              {help.refusal ? (
                <div className="teacher-refusal" role="status">
                  <p>{help.refusal.message}</p>
                  <div className="teacher-refusal__actions">
                    {help.refusal.actions.map((action) => (
                      <button
                        key={action}
                        type="button"
                        className="btn btn--ghost btn--small"
                        onClick={() => onAction(action)}
                      >
                        {teacherActionLabel(action)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {help.error ? (
                <ErrorBox message={help.error.message}>
                  <button type="button" className="btn btn--small" onClick={onRetry} disabled={help.loading}>
                    Réessayer
                  </button>
                </ErrorBox>
              ) : null}
            </div>
          ) : null}
        </Card>
      </Section>
    </>
  );
  if (embedded) return content;
  return (
    <Page>
      <PageHeading title="Exercices" eyebrow="Des exercices de ton manuel, corrigés pas à pas." />
      {content}
    </Page>
  );
}
