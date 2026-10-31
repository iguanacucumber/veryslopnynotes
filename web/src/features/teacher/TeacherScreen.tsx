import { useEffect, useId, useRef, type ReactNode } from "react";
import type { AiContextSourceMeta, TeacherMessage, TeacherMode } from "../../bridge/types";
import { Card, EmptyState, ErrorBox, Loading, Page, Section } from "../../ui/components";
import { CopyTextButton } from "../../ui/CopyTextButton";
import { ThinkingLine } from "../../ui/ThinkingLine";
import { useStickToBottom } from "../../ui/useStickToBottom";
import {
  IconArrowUp,
  IconBook,
  IconChevronDown,
  IconChevronRight,
  IconMessage,
  IconSparkles,
  IconTrash,
} from "../../ui/icons";
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
  /** Refus déterministe du corpus vide : le pont a refusé AVANT tout appel. */
  refusal: { message: string; actions: string[] } | null;
  focusTick: number;
  /** Onglet interne : discussion ou exercices du manuel. */
  tab: "chat" | "exercises";
  onTabChange: (tab: "chat" | "exercises") => void;
  /** Panneau Exercices, rendu DANS l'onglet. */
  exercisesPanel?: ReactNode;
  busy: boolean;
  threadLoaded: boolean;
  onSubjectChange: (subject: string) => void;
  onModeChange: (mode: TeacherMode) => void;
  onDraftChange: (draft: string) => void;
  onSend: () => void;
  /** Envoie directement une suggestion ; sans lui, elle remplit le brouillon. */
  onAsk?: (question: string) => void;
  onRetry: () => void;
  onReject: (index: number) => void;
  onNewDiscussion: () => void;
  onDelete: () => void;
  onAction: (action: string) => void;
}

const TEACHER_PROMPTS: Record<TeacherMode, readonly string[]> = {
  explain: [
    "Explique-moi ce chapitre avec un exemple",
    "Quels pièges éviter en contrôle ?",
    "Fais-moi un plan de révision",
    "Pose-moi une question pour vérifier",
  ],
  correct: [
    "Corrige ma réponse étape par étape",
    "Où est mon erreur exactement ?",
    "Donne-moi un indice, pas la réponse",
    "Refais l’exercice avec moi",
  ],
};

/** Écran PRÉSENTATIONNEL : ne parle pas au pont, donc testable en rendu statique. */
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
  onAsk,
  onRetry,
  onReject,
  onNewDiscussion,
  onDelete,
  onAction,
}: TeacherViewProps) {
  const subjectId = useId();
  const messageId = useId();
  const { ref: logRef, onScroll, away, toBottom } = useStickToBottom([messages.length, loading]);
  const answerRef = useRef<HTMLDivElement | null>(null);
  const hasTeacher = messages.some((message) => message.role === "teacher");

  // Focus après réponse : on vise le DERNIER tour du professeur, jamais le
  // composer. Le `tabIndex=-1` rend le conteneur focusable par programme.
  useEffect(() => {
    // Le fil a déjà fait défiler son propre journal : voler le scroll de la
    // page cacherait le compositeur sous le dock.
    if (focusTick > 0 && hasTeacher && answerRef.current) {
      answerRef.current.focus({ preventScroll: true });
    }
  }, [focusTick, hasTeacher]);

  const lastTeacher = messages.reduce<number>(
    (found, message, index) => (message.role === "teacher" ? index : found),
    -1,
  );

  return (
    <Page className={tab === "chat" ? "teacher teacher--chat" : "teacher"}>
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
        <div id="teacher-panel-chat" role="tabpanel" aria-labelledby="teacher-tab-chat" className="teacher-workspace ai">
          <section aria-labelledby="teacher-chat-title" className="teacher-chat">
            <h2 id="teacher-chat-title" className="sr-only">
              Conversation
            </h2>

            <div className="teacher-controls">
              <div className="teacher-controls__top">
                <label className="teacher-subject" htmlFor={subjectId}>
                  <span className="sr-only">Matière du cours</span>
                  <select
                    id={subjectId}
                    className="teacher-subject__select"
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
                </label>
                <div className="teacher-chat__actions">
                  <button
                    type="button"
                    className="teacher-action"
                    aria-label="Nouvelle discussion"
                    title="Nouvelle discussion"
                    onClick={onNewDiscussion}
                    disabled={busy || !threadLoaded || messages.length === 0}
                  >
                    <IconMessage size={20} />
                  </button>
                  <button
                    type="button"
                    className="teacher-action teacher-chat__delete"
                    aria-label="Supprimer la discussion"
                    title="Supprimer la discussion"
                    onClick={onDelete}
                    disabled={busy || !threadLoaded || messages.length === 0}
                  >
                    <IconTrash size={19} />
                  </button>
                </div>
              </div>

              <fieldset className="teacher-modes">
                <legend className="sr-only">Mode</legend>
                <div className="teacher-modes__options">
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
                </div>
              </fieldset>
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

            <div className="ai-log-wrap">
              <div
                ref={logRef}
                className="teacher-log"
                role="log"
                aria-live="polite"
                aria-relevant="additions text"
                aria-label="Conversation avec le professeur"
                onScroll={onScroll}
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
                  <div className="ai-hero teacher-empty">
                    <span className="ai-mark ai-mark--lg" aria-hidden="true">
                      <IconSparkles size={24} />
                    </span>
                    <strong className="ai-hero__title">
                      {subject
                        ? "Pose ta première question."
                        : "Choisis une matière pour commencer."}
                    </strong>
                    <p className="ai-hero__body">
                      {subject
                        ? teacherModeHint(mode)
                        : "Le professeur répond à partir de ton cahier, de tes pièces jointes, du manuel et de la page web de la matière."}
                    </p>
                    {subject ? (
                      <div className="ai-prompts" aria-label="Questions pour démarrer">
                        {TEACHER_PROMPTS[mode].slice(0, 3).map((suggestion) => (
                          <button
                            key={suggestion}
                            type="button"
                            className="ai-prompt"
                            onClick={() => {
                              if (onAsk) onAsk(suggestion);
                              else onDraftChange(suggestion);
                            }}
                          >
                            {suggestion}
                            <IconChevronRight size={16} />
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  messages.map((message, index) => (
                    <div
                      key={`${message.role}-${index}`}
                      ref={index === lastTeacher ? answerRef : undefined}
                      tabIndex={message.role === "teacher" ? -1 : undefined}
                      className={`teacher-bubble teacher-bubble--${message.role}`}
                    >
                      <div className="teacher-bubble__head">
                        {message.role === "teacher" ? (
                          <span className="teacher-bubble__mark ai-mark" aria-hidden="true">
                            <IconSparkles size={15} />
                          </span>
                        ) : null}
                        <span className="teacher-bubble__who">
                          {message.role === "teacher" ? "Le professeur" : "Toi"}
                        </span>
                      </div>
                      {message.role === "teacher" ? (
                        <div className="teacher-bubble__answer ai-turn__body">
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
                                <ul className="teacher-sources ai-sources__list">
                                  {message.sources.map((source) => (
                                    <li key={source} className="teacher-source ai-source">
                                      {source}
                                    </li>
                                  ))}
                                </ul>
                              </>
                            ) : (
                              <div className="teacher-unsourced">
                                <span className="teacher-unsourced__badge">non sourcée</span>
                              </div>
                            )}
                          </div>
                          <SentDetails message={message} />
                          <div className="teacher-bubble__actions ai-actions">
                            <CopyTextButton text={message.text} />
                            {message.unsourced ? (
                              <button
                                type="button"
                                className="ai-action ai-action--danger"
                                onClick={() => onReject(index)}
                                aria-label="Rejeter cette réponse non sourcée"
                              >
                                Rejeter la réponse
                              </button>
                            ) : null}
                          </div>
                        </>
                      ) : null}
                    </div>
                  ))
                )}
                {loading ? (
                  <div className="teacher-thinking" role="status">
                    <ThinkingLine title="Le professeur réfléchit…" />
                  </div>
                ) : null}
              </div>
              {away ? (
                <button type="button" className="ai-jump" onClick={toBottom}>
                  Dernière réponse
                  <IconChevronDown size={16} />
                </button>
              ) : null}
            </div>

            <div className="teacher-composer-block">
              <form
                className="teacher-composer ai-composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  toBottom();
                  onSend();
                }}
              >
                <label className="sr-only" htmlFor={messageId}>
                  Ta question au professeur
                </label>
                <textarea
                  id={messageId}
                  className="teacher-composer__input ai-composer__input"
                  value={draft}
                  maxLength={2000}
                  rows={1}
                  placeholder={subject ? "Pose ta question…" : "Choisis d’abord une matière."}
                  onChange={(event) => onDraftChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      if (busy || !threadLoaded || !subject || draft.trim() === "") return;
                      toBottom();
                      onSend();
                    }
                  }}
                  disabled={busy || !threadLoaded}
                />
                <button
                  type="submit"
                  className="teacher-composer__send ai-composer__send"
                  disabled={busy || !threadLoaded || !subject || draft.trim() === ""}
                  aria-label="Envoyer la question"
                >
                  <IconArrowUp size={20} />
                </button>
              </form>
              <details className="teacher-footnote">
                <summary>Fil local et confidentialité</summary>
                <p className="tiny muted">
                  Le fil de discussion reste sur cet appareil, pour ce compte. Il est supprimé à la
                  déconnexion. Aucun entraînement : rien n’est envoyé sans ton action, avec ta clé.
                </p>
              </details>
            </div>
          </section>
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
    </Page>
  );
}

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
