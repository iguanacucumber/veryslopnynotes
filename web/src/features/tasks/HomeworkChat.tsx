import { useEffect, useId, useState, type CSSProperties } from "react";
import { Dialog } from "../../ui/Dialog";
import { useApp } from "../../ui/AppContext";
import {
  IconArrowUp,
  IconBook,
  IconCamera,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconRefresh,
  IconSparkles,
} from "../../ui/icons";
import { CopyTextButton } from "../../ui/CopyTextButton";
import { ThinkingLine } from "../../ui/ThinkingLine";
import { useStickToBottom } from "../../ui/useStickToBottom";
import { MarkdownBody } from "../revisions/MarkdownBody";
import { relativeLongFr, subjectColor, tint } from "../../lib/format";
import { subjectEmoji } from "../../lib/subjectVisual";
import type { AiContextSourceMeta } from "../../bridge/types";
import {
  subjectDisplayFr,
  type Assignment,
  type AssignmentAttachment,
  type HomeworkAction,
} from "./assignments";

export type HomeworkPhase = {
  phase: string;
  at: number;
  sources?: number;
  chars?: number;
};

export type HomeworkTurn = {
  question: string;
  answer: string | null;
  steps: string[];
  sources: string[];
  refusal: string | null;
  actions: HomeworkAction[];
  error: string | null;
  context?: AiContextSourceMeta[];
};

export type HomeworkChatState = {
  id: string;
  photo: boolean;
  photoSource?: "camera" | "gallery";
  /** Nombre de photos lues (absent tant que le pont n'a pas répondu). */
  photoCount?: number;
  loading: boolean;
  allowUnsourced: boolean;
  phases: HomeworkPhase[];
  turns: HomeworkTurn[];
  current: HomeworkTurn;
};

const PHASES = ["prepare", "context", "photo", "model", "verify"] as const;
type PhaseKey = (typeof PHASES)[number];

function phaseLabel(phase: PhaseKey, event?: HomeworkPhase): string {
  switch (phase) {
    case "prepare":
      return "Lecture du devoir";
    case "context":
      if (event?.sources === 0) return "Contexte prêt — sans document";
      if (typeof event?.sources === "number") {
        return `Contexte prêt — ${event.sources} source${event.sources > 1 ? "s" : ""}`;
      }
      return "Contexte prêt";
    case "photo":
      return "Lecture de la photo";
    case "model":
      return "Le modèle rédige";
    case "verify":
      return "Vérification des sources";
  }
}

function Activity({
  phases,
  loading,
  photo,
}: {
  phases: HomeworkPhase[];
  loading: boolean;
  photo: boolean;
}) {
  const events = new Map<string, HomeworkPhase>();
  for (const phase of phases) events.set(phase.phase, phase);
  const visible = PHASES.filter((phase) => phase !== "photo" || photo || events.has("photo"));
  const latest = phases.reduce(
    (index, phase) => Math.max(index, visible.indexOf(phase.phase as PhaseKey)),
    -1,
  );
  return (
    <div className="hw-activity" role="status" aria-live="polite">
      <ThinkingLine title="L’assistant travaille" startedAt={phases[0]?.at} />
      <ol className="hw-activity__list">
        {visible.map((phase, index) => {
          const event = events.get(phase);
          const done = !loading || latest > index;
          const active = loading && latest === index;
          if (!loading && latest >= 0 && index > latest) return null;
          return (
            <li
              key={phase}
              className="hw-activity__step"
              data-state={done ? "done" : active ? "active" : "pending"}
            >
              <span className="hw-activity__marker" aria-hidden="true">
                {done ? <IconCheck size={13} /> : active ? <span className="spinner" /> : null}
              </span>
              <span className="hw-activity__label">{phaseLabel(phase, event)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function actionLabel(action: HomeworkAction): string | null {
  switch (action) {
    case "add_course":
      return "Ajouter un cours au cahier";
    case "enable_manual":
      return "Enregistrer mon manuel";
    case "open_attachment":
      return "Ouvrir la pièce jointe";
    case "proceed_anyway":
      return "Procéder quand même";
  }
}

function AssistantTurn({
  turn,
  loading,
  phases,
  photo,
  onProceed,
  onRetry,
  onAddCourse,
  onEnableManual,
  onOpenAttachment,
  attachment,
  interactive = true,
}: {
  turn: HomeworkTurn;
  loading: boolean;
  phases: HomeworkPhase[];
  photo: boolean;
  onProceed: () => void;
  onRetry: () => void;
  onAddCourse: () => void;
  onEnableManual: () => void;
  onOpenAttachment: (attachment: AssignmentAttachment) => void;
  attachment?: AssignmentAttachment;
  interactive?: boolean;
}) {
  const unsourced = !loading && turn.answer !== null && turn.sources.length === 0;
  return (
    <div className="hw-assistant ai-turn ai-turn--assistant">
      <div className="hw-assistant__head ai-turn__head">
        <span className="hw-assistant__avatar ai-mark" aria-hidden="true">
          <IconSparkles size={15} />
        </span>
        <span className="hw-assistant__who ai-turn__who">Assistant devoirs</span>
        {unsourced ? <span className="hw-assistant__badge">non sourcée</span> : null}
      </div>

      {loading ? <Activity phases={phases} loading photo={photo} /> : null}

      {turn.answer ? (
        <div className="hw-assistant__answer ai-turn__body">
          <MarkdownBody text={turn.answer} />
        </div>
      ) : null}

      {unsourced ? (
        <p className="hw-unsourced">
          Cette réponse vient des connaissances générales du modèle : aucun document ne la soutient.
        </p>
      ) : null}

      {turn.sources.length > 0 ? (
        <div className="hw-sources">
          <span className="hw-sources__label">Sources citées</span>
          <ul className="hw-sources__list ai-sources__list">
            {turn.sources.map((source, index) => (
              <li key={`${index}:${source}`} className="ai-source">
                {source}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {turn.refusal ? (
        <div className="hw-refusal" role="status">
          <p>{turn.refusal}</p>
          {interactive ? (
            <div className="hw-actions">
              {turn.actions.map((action) => {
                const label = actionLabel(action);
                if (!label) return null;
                if (action === "add_course") {
                  return (
                    <button key={action} type="button" className="btn btn--ghost btn--small" onClick={onAddCourse}>
                      <IconBook size={16} />
                      {label}
                    </button>
                  );
                }
                if (action === "enable_manual") {
                  return (
                    <button key={action} type="button" className="btn btn--ghost btn--small" onClick={onEnableManual}>
                      {label}
                    </button>
                  );
                }
                if (action === "open_attachment" && attachment) {
                  return (
                    <button
                      key={action}
                      type="button"
                      className="btn btn--ghost btn--small"
                      onClick={() => onOpenAttachment(attachment)}
                    >
                      {label}
                    </button>
                  );
                }
                if (action === "proceed_anyway") {
                  return (
                    <button key={action} type="button" className="btn btn--ghost btn--small" onClick={onProceed}>
                      {label}
                    </button>
                  );
                }
                return null;
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {turn.error ? (
        <div className="hw-error" role="alert">
          <p>{turn.error}</p>
          {interactive ? (
            <button type="button" className="btn btn--small" onClick={onRetry}>
              Réessayer
            </button>
          ) : null}
        </div>
      ) : null}

      {turn.answer ? (
        <div className="hw-turn-actions ai-actions">
          <CopyTextButton text={turn.answer} />
          {interactive ? (
            <button type="button" className="ai-action" onClick={onRetry}>
              <IconRefresh size={16} />
              Régénérer
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function HomeworkChat({
  assignment,
  state,
  manualReady,
  lessonReady,
  onClose,
  onSend,
  onProceed,
  onRetry,
  onAddCourse,
  onEnableManual,
  onOpenAttachment,
}: {
  assignment: Assignment;
  state: HomeworkChatState;
  manualReady: boolean;
  lessonReady: boolean;
  onClose: () => void;
  onSend: (question: string) => void;
  onProceed: () => void;
  onRetry: () => void;
  onAddCourse: () => void;
  onEnableManual: () => void;
  onOpenAttachment: (attachment: AssignmentAttachment) => void;
}) {
  const composerId = useId();
  const [draft, setDraft] = useState("");
  const { ref: logRef, onScroll, away, toBottom } = useStickToBottom([
    state.current,
    state.turns,
    state.phases,
    state.loading,
  ]);
  const { dark } = useApp();
  const tinted = tint(subjectColor(assignment.subject), dark ? 0.3 : -0.3);
  const due = relativeLongFr(assignment.dueDate, Date.now());
  const last = state.current;
  const canSend = !state.loading && draft.trim().length > 0;

  useEffect(() => {
    setDraft("");
  }, [state.id]);

  function send() {
    const question = draft.trim();
    if (!question || state.loading) return;
    setDraft("");
    toBottom();
    onSend(question);
  }

  const photoChip =
    state.photo && (state.photoCount ?? 0) > 1 ? `${state.photoCount} photos` : "Photo";

  return (
    <Dialog
      open
      title="Aide devoirs"
      icon={<IconSparkles size={20} />}
      className="dialog--chat"
      onClose={onClose}
      actions={null}
    >
      <div className="hw-chat ai" style={{ "--hw-tint": tinted } as CSSProperties}>
        <div className="ai-log-wrap hw-log-wrap">
          <div
            ref={logRef}
            className="hw-log ai-log"
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            aria-busy={state.loading}
            aria-label={`Conversation d’aide devoirs — ${assignment.subject}`}
            onScroll={onScroll}
          >
            <div className="hw-context">
              <span className="hw-context__emoji" aria-hidden="true">
                {subjectEmoji(assignment.subject)}
              </span>
              <span className="hw-context__subject">{subjectDisplayFr(assignment.subject)}</span>
              {due ? <span className="hw-context__due">{due}</span> : null}
              {lessonReady ? (
                <span className="hw-context__chip">
                  <IconBook size={13} />
                  Cahier
                </span>
              ) : null}
              {manualReady ? <span className="hw-context__chip">Manuel</span> : null}
              {state.photo ? (
                <span className="hw-context__chip">
                  <IconCamera size={13} />
                  {photoChip}
                </span>
              ) : null}
            </div>

            <div className="hw-user hw-user--assignment">
              <span className="hw-user__who">Ton devoir</span>
              <div className="hw-user__bubble">
                {assignment.title ? <p className="hw-user__title">{assignment.title}</p> : null}
                {assignment.description ? <MarkdownBody text={assignment.description} /> : null}
              </div>
            </div>

            {state.turns.map((turn, index) => (
              <div key={`${turn.question}:${index}`} className="hw-exchange">
                {turn.question ? (
                  <div className="hw-user">
                    <span className="hw-user__who">Toi</span>
                    <div className="hw-user__bubble">{turn.question}</div>
                  </div>
                ) : null}
                <AssistantTurn
                  turn={turn}
                  loading={false}
                  phases={[]}
                  photo={state.photo}
                  onProceed={onProceed}
                  onRetry={onRetry}
                  onAddCourse={onAddCourse}
                  onEnableManual={onEnableManual}
                  onOpenAttachment={onOpenAttachment}
                  attachment={assignment.attachments[0]}
                  interactive={false}
                />
              </div>
            ))}

            <div className="hw-exchange">
              {last.question ? (
                <div className="hw-user">
                  <span className="hw-user__who">Toi</span>
                  <div className="hw-user__bubble">{last.question}</div>
                </div>
              ) : null}
              <AssistantTurn
                turn={last}
                loading={state.loading}
                phases={state.phases}
                photo={state.photo}
                onProceed={onProceed}
                onRetry={onRetry}
                onAddCourse={onAddCourse}
                onEnableManual={onEnableManual}
                onOpenAttachment={onOpenAttachment}
                attachment={assignment.attachments[0]}
              />
            </div>

            {!state.loading && !last.answer && !last.refusal && !last.error ? (
              <div className="hw-starters">
                <p className="hw-empty tiny muted">Pose une question pour démarrer l’explication.</p>
                <div className="ai-prompts">
                  {[
                    "Explique-moi la consigne",
                    "Donne-moi juste un indice",
                    "Aide-moi à commencer",
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="ai-prompt"
                      onClick={() => {
                        toBottom();
                        onSend(suggestion);
                      }}
                    >
                      {suggestion}
                      <IconChevronRight size={16} />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {!state.loading && last.answer ? (
              <div className="hw-suggestions" aria-label="Questions rapides">
                {[
                  "Explique plus simplement",
                  "Détaille les étapes",
                  "Donne un exemple",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="hw-suggestion"
                    onClick={() => {
                      toBottom();
                      onSend(suggestion);
                    }}
                  >
                    {suggestion}
                    <IconChevronRight size={14} />
                  </button>
                ))}
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

        <div className="hw-foot hw-foot--ai">
          <form
            className="hw-composer ai-composer"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <label className="sr-only" htmlFor={composerId}>
              Ta question sur ce devoir
            </label>
            <textarea
              id={composerId}
              className="hw-composer__input ai-composer__input"
              rows={1}
              maxLength={900}
              value={draft}
              placeholder={
                state.loading
                  ? "L’assistant répond…"
                  : last.error
                    ? "Reformule ta question ou réessaie…"
                    : "Pose une question sur ce devoir…"
              }
              disabled={state.loading}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  send();
                }
              }}
            />
            <button
              type="submit"
              className="hw-composer__send ai-composer__send"
              disabled={!canSend}
              aria-label="Envoyer la question"
            >
              <IconArrowUp size={20} />
            </button>
          </form>

          <div className="hw-foot__meta ai-meta">
            <span className="tiny muted hw-foot__paid">1 question = 1 appel.</span>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
