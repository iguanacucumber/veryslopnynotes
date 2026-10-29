import { useEffect, useId, useRef, type ReactNode } from "react";
import type { AiContextSourceMeta, TeacherMessage, TeacherMode } from "../../bridge/types";
import {
  Card,
  EmptyState,
  ErrorBox,
  Loading,
  Page,
  PageHeading,
  Section,
} from "../../ui/components";
import { IconBook, IconSend, IconSparkles, IconTrash } from "../../ui/icons";
import { MarkdownBody } from "../revisions/MarkdownBody";
import { aiContextTypeFr } from "../tasks/assignments";
import {
  historySources,
  teacherActionLabel,
  teacherModeHint,
  teacherModeLabel,
  TEACHER_MODES,
  turnSources,
  type TeacherTurnError,
} from "./teacher";
export interface TeacherViewProps {
  subjects: string[];
  subject: string;
  mode: TeacherMode;
  messages: TeacherMessage[];
  draft: string;
  loading: boolean;
  /** Erreur du dernier tour : message + « Réessayer » (jamais de bulle vide). */
  error: TeacherTurnError | null;
  /** Erreur de chargement du fil local : recharger, jamais un faux fil vide. */
  loadError?: string;
  onReload?: () => void;
  /** Refus déterministe du corpus vide (le pont a refusé AVANT tout appel). */
  refusal: { message: string; actions: string[] } | null;
  /** Compteur de tours : force le focus sur la réponse après succès. */
  focusTick: number;
  /** Onglet interne : discussion ou exercices du manuel (#632). */
  tab: "chat" | "exercises";
  onTabChange: (tab: "chat" | "exercises") => void;
  /** Panneau Exercices branché au pont (#632), rendu DANS l'onglet. */
  exercisesPanel?: ReactNode;
  busy: boolean;
  threadLoaded: boolean;
  onSubjectChange: (subject: string) => void;
  onModeChange: (mode: TeacherMode) => void;
  onDraftChange: (draft: string) => void;
  onSend: () => void;
  onRetry: () => void;
  onReject: (index: number) => void;
  onNewDiscussion: () => void;
  onDelete: () => void;
  onAction: (action: string) => void;
}

/**
 * Écran Prof (#633) : composant PRÉSENTATIONNEL. Il ne parle pas au pont, ce
 * qui rend l'envoi, le chargement, la réponse, les sources, l'erreur, la
 * suppression et le focus testables en rendu statique.
 */
export function TeacherView({
  subjects,
  subject,
  mode,
  messages,
  draft,
  loading,
  error,
  loadError,
  onReload,
  refusal,
  focusTick,
  tab,
  onTabChange,
  exercisesPanel,
  busy,
  threadLoaded,
  onSubjectChange,
  onModeChange,
  onDraftChange,
  onSend,
  onRetry,
  onReject,
  onNewDiscussion,
  onDelete,
  onAction,
}: TeacherViewProps) {
  const subjectId = useId();
  const messageId = useId();
  const logRef = useRef<HTMLDivElement | null>(null);
  const answerRef = useRef<HTMLDivElement | null>(null);
  const hasTeacher = messages.some((message) => message.role === "teacher");

  // Focus après réponse : on vise le DERNIER tour du professeur, jamais le
  // composer. Le `tabIndex=-1` rend le conteneur focusable par programme.
  useEffect(() => {
    if (focusTick > 0 && hasTeacher && answerRef.current) answerRef.current.focus();
  }, [focusTick, hasTeacher]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages.length, loading]);

  const lastTeacher = messages.reduce<number>(
    (found, message, index) => (message.role === "teacher" ? index : found),
    -1,
  );

  return (
    <Page>
      <PageHeading title="Prof" eyebrow="Ton professeur IA, à partir de tes cours." />

      <div className="teacher-tabs" role="tablist" aria-label="Professeur">
        <button
          type="button"
          role="tab"
          id="teacher-tab-chat"
          aria-selected={tab === "chat"}
          aria-controls="teacher-panel-chat"
          className={`teacher-tab${tab === "chat" ? " teacher-tab--active" : ""}`}
          onClick={() => onTabChange("chat")}
        >
          Discussion
        </button>
        <button
          type="button"
          role="tab"
          id="teacher-tab-exercises"
          aria-selected={tab === "exercises"}
          aria-controls="teacher-panel-exercises"
          className={`teacher-tab${tab === "exercises" ? " teacher-tab--active" : ""}`}
          onClick={() => onTabChange("exercises")}
        >
          Exercices
        </button>
      </div>

      {tab === "chat" ? (
        <div id="teacher-panel-chat" role="tabpanel" aria-labelledby="teacher-tab-chat" className="stack">
          <Section title="Matière">
        <Card className="teacher-subject">
          <label className="tiny muted" htmlFor={subjectId}>
            Matière du cours
          </label>
          <select
            id={subjectId}
            className="field"
            value={subject}
            onChange={(event) => onSubjectChange(event.target.value)}
            disabled={busy}
          >
            <option value="">Choisir une matière…</option>
            {subjects.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <fieldset className="teacher-modes">
            <legend className="tiny muted">Mode</legend>
            {TEACHER_MODES.map((item) => (
              <label key={item} className="teacher-mode">
                <input
                  type="radio"
                  name="teacher-mode"
                  value={item}
                  checked={mode === item}
                  onChange={() => onModeChange(item)}
                  disabled={busy}
                />
                <span>{teacherModeLabel(item)}</span>
              </label>
            ))}
          </fieldset>
          <p className="tiny muted teacher-mode__hint">{teacherModeHint(mode)}</p>
          {messages.length > 0 ? (
            <p className="tiny muted">Changer de matière démarre une nouvelle discussion.</p>
          ) : null}
        </Card>
      </Section>

      <Section title="Conversation">
        <Card className="teacher-chat">
          <div className="teacher-chat__actions">
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={onNewDiscussion}
              disabled={busy || !threadLoaded}
            >
              <IconSparkles size={16} />
              Nouvelle discussion
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--small teacher-chat__delete"
              onClick={onDelete}
              disabled={busy || !threadLoaded}
            >
              <IconTrash size={16} />
              Supprimer
            </button>
          </div>

          <div
            ref={logRef}
            className="teacher-log"
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            aria-label="Conversation avec le professeur"
          >
            {loadError ? (
              <ErrorBox message={loadError}>
                <button type="button" className="btn btn--small" onClick={onReload}>
                  Recharger
                </button>
              </ErrorBox>
            ) : null}
            {!threadLoaded ? (
              <Loading label="Chargement de la discussion…" />
            ) : messages.length === 0 && !loading && !error && !refusal && !loadError ? (
              <EmptyState
                icon={<IconSparkles size={30} />}
                title="Pose ta première question."
                body="Le professeur répond à partir de ton cahier, de tes pièces jointes, du manuel et de la page web de la matière."
              />
            ) : (
              messages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  ref={index === lastTeacher ? answerRef : undefined}
                  tabIndex={message.role === "teacher" ? -1 : undefined}
                  className={`teacher-bubble teacher-bubble--${message.role}`}
                >
                  <div className="teacher-bubble__head">
                    <span className="teacher-bubble__who">
                      {message.role === "teacher" ? "Le professeur" : "Toi"}
                    </span>
                  </div>
                  {message.role === "teacher" ? (
                    <div className="teacher-bubble__answer">
                      <MarkdownBody text={message.text} />
                    </div>
                  ) : (
                    <p className="teacher-bubble__text">{message.text}</p>
                  )}
                  {message.role === "teacher" ? (
                    <>
                      <div className="teacher-bubble__citations">
                        {message.sources.length > 0 ? (
                          <>
                            <span className="tiny muted">Sources :</span>
                            <ul className="teacher-sources">
                              {message.sources.map((source) => (
                                <li key={source} className="teacher-source">
                                  {source}
                                </li>
                              ))}
                            </ul>
                          </>
                        ) : (
                          <div className="teacher-unsourced">
                            <span className="teacher-unsourced__badge">non sourcée</span>
                            <button
                              type="button"
                              className="btn btn--ghost btn--small"
                              onClick={() => onReject(index)}
                              aria-label="Rejeter cette réponse non sourcée"
                            >
                              Rejeter la réponse
                            </button>
                          </div>
                        )}
                      </div>
                      <SentDetails message={message} />
                    </>
                  ) : null}
                </div>
              ))
            )}
            {loading ? (
              <div className="teacher-bubble teacher-bubble--teacher" role="status">
                <span className="spinner" aria-hidden="true" />
                <span>Le professeur réfléchit…</span>
              </div>
            ) : null}
          </div>

          {refusal ? (
            <div className="teacher-refusal" role="status">
              <p>{refusal.message}</p>
              <div className="teacher-refusal__actions">
                {refusal.actions.map((action) => (
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

          {error ? (
            <ErrorBox message={error.message}>
              <button type="button" className="btn btn--small" onClick={onRetry} disabled={busy}>
                Réessayer
              </button>
            </ErrorBox>
          ) : null}

          <form
            className="teacher-composer"
            onSubmit={(event) => {
              event.preventDefault();
              onSend();
            }}
          >
            <label className="sr-only" htmlFor={messageId}>
              Ta question au professeur
            </label>
            <textarea
              id={messageId}
              className="field field--area teacher-composer__input"
              value={draft}
              maxLength={2000}
              rows={3}
              placeholder={
                subject ? "Pose ta question sur cette matière…" : "Choisis d’abord une matière."
              }
              onChange={(event) => onDraftChange(event.target.value)}
              disabled={busy || !threadLoaded}
            />
            <button
              type="submit"
              className="btn teacher-composer__send"
              disabled={busy || !threadLoaded || !subject || draft.trim() === ""}
            >
              <IconSend size={16} />
              Envoyer
            </button>
          </form>
        </Card>
      </Section>
        </div>
      ) : exercisesPanel ? (
        <div id="teacher-panel-exercises" role="tabpanel" aria-labelledby="teacher-tab-exercises" className="stack">
          {exercisesPanel}
        </div>
      ) : (
        <Section title="Exercices">
          <Card>
            <EmptyState
              icon={<IconBook size={30} />}
              title="Les exercices arrivent bientôt."
              body="Cet onglet sera livré avec le ticket exercices."
            />
          </Card>
        </Section>
      )}

      <p className="tiny muted teacher-footnote">
        Le fil de discussion reste sur cet appareil, pour ce compte. Il est supprimé à la
        déconnexion. Aucun entraînement : rien n’est envoyé sans ton action, avec ta clé.
      </p>
    </Page>
  );
}

/** « Ce qui est envoyé » : sources du tour, historique, tailles, troncatures. */
function SentDetails({ message }: { message: TeacherMessage }) {
  const tour = turnSources(message);
  const history = historySources(message);
  const summary = message.summaryChars ?? 0;
  return (
    <details className="teacher-sent">
      <summary>Ce qui est envoyé</summary>
      <p className="tiny muted">
        Ta question, les sources de cette matière et les derniers tours partent directement au
        fournisseur, avec ta clé. Aucun outil, aucun secret.
      </p>
      {tour.length > 0 ? (
        <ul className="teacher-sent__list tiny muted">
          {tour.map((source, index) => (
            <li key={`${source.type}:${source.label}:${index}`}>{sourceLine(source)}</li>
          ))}
        </ul>
      ) : null}
      <p className="tiny muted">
        Historique : {history.length > 0 ? `${history.length} source(s)` : "aucun tour"}
        {summary > 0 ? ` + résumé local (${summary} caractères)` : ""}.
      </p>
      {history.length > 0 ? (
        <ul className="teacher-sent__list tiny muted">
          {history.map((source, index) => (
            <li key={`h:${source.label}:${index}`}>{sourceLine(source)}</li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}

function sourceLine(source: AiContextSourceMeta): string {
  return `${aiContextTypeFr(source.type)} — ${source.label} (${source.chars} caractères${
    source.truncated ? ", tronquée" : ""
  })`;
}
