import { useEffect, useMemo, useRef, useState } from "react";
import { bridge } from "../../bridge/client";
import { useApp, useResource } from "../../ui/AppContext";
import { useViewNavigate } from "../../ui/viewTransition";
import {
  Card,
  EmptyState,
  ErrorBox,
  Loading,
  Page,
  Section,
  StaleBadge,
  SubjectAvatar,
} from "../../ui/components";
import { IconAttach, IconCheck, IconChevronLeft, IconChevronRight, IconSparkles } from "../../ui/icons";
import { parseDate } from "../../lib/format";
import {
  assignmentCardText,
  assignmentSections,
  assignmentsInWeek,
  dueLabel,
  homeworkRefusalText,
  parseAssignmentsPayload,
  shiftWeek,
  subjectDisplayFr,
  weekEndOf,
  weekLabelFr,
  weekRangeFr,
  weekStartOf,
  type Assignment,
  type AssignmentAttachment,
} from "./assignments";
import "./tasks.css";

type HelpState = {
  id: string;
  loading: boolean;
  answer: string | null;
  refusal: string | null;
  error: string | null;
};

type LlmState = { configured: boolean | null; error: string | null };

/** La semaine est TOUJOURS bornée localement : sans elle, un payload sans
 *  `weekStart` rendrait la navigation impossible et l'écran piégerait
 *  l'utilisateur sur une semaine qu'il ne peut plus quitter. */
export function TasksScreen() {
  const [week, setWeek] = useState(() => weekStartOf(new Date()));
  const currentWeek = weekStartOf(new Date());
  const end = weekEndOf(week);
  const range = weekRangeFr(week, end);

  return (
    <Page>
      <Card className="tasks-week">
        <div className="tasks-week__row">
          <button
            type="button"
            className="tasks-week__nav"
            aria-label="Semaine précédente"
            onClick={() => setWeek((value) => shiftWeek(value, -1))}
          >
            <IconChevronLeft />
          </button>
          <span className="tasks-week__label">
            <strong>{weekLabelFr(week)}</strong>
            {range ? <small>{range}</small> : null}
          </span>
          <button
            type="button"
            className="tasks-week__nav"
            aria-label="Semaine suivante"
            onClick={() => setWeek((value) => shiftWeek(value, 1))}
          >
            <IconChevronRight />
          </button>
        </div>
        {week !== currentWeek ? (
          <button
            type="button"
            className="tasks-week__today"
            onClick={() => setWeek(currentWeek)}
          >
            Revenir à cette semaine
          </button>
        ) : null}
      </Card>

      <TasksWeek key={week} week={week} />
    </Page>
  );
}

function TasksWeek({ week }: { week: string }) {
  const { notify, refreshTick } = useApp();
  const navigate = useViewNavigate();
  const currentWeek = weekStartOf(new Date());
  const query = `weekStart=${week}`;
  const resource = useResource("assignments", query);
  const parsed = useMemo(() => parseAssignmentsPayload(resource.payload), [resource.payload]);
  // Un payload en cache peut appartenir à une autre semaine : on ne garde que
  // les échéances de la semaine affichée. Une semaine sans devoir est un état
  // vide, pas un chargement sans fin.
  const visible = useMemo(() => assignmentsInWeek(parsed.items, week), [parsed.items, week]);
  const [items, setItems] = useState<Assignment[]>(visible);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [doneOpen, setDoneOpen] = useState(false);
  const [help, setHelp] = useState<HelpState | null>(null);
  const [llm, setLlm] = useState<LlmState>({ configured: null, error: null });
  const helpSeq = useRef(0);
  const toggleSeq = useRef(new Map<string, number>());

  // Le payload fait foi : un rafraîchissement remplace l'état optimiste.
  useEffect(() => {
    setItems(visible);
  }, [visible]);

  useEffect(() => {
    let alive = true;
    setLlm((state) => ({ ...state, error: null }));
    void bridge
      .llmStatus()
      .then((status) => {
        if (alive) setLlm({ configured: Boolean(status.configured), error: null });
      })
      .catch((e: unknown) => {
        if (alive) {
          setLlm({
            configured: false,
            error: e instanceof Error ? e.message : "état de l'assistant indisponible",
          });
        }
      });
    return () => {
      alive = false;
    };
  }, [refreshTick]);

  const sections = useMemo(() => assignmentSections(items, new Date()), [items]);

  async function toggle(assignment: Assignment, next: boolean) {
    if (pending[assignment.id]) return;
    const seq = (toggleSeq.current.get(assignment.id) ?? 0) + 1;
    toggleSeq.current.set(assignment.id, seq);
    setPending((state) => ({ ...state, [assignment.id]: true }));
    setItems((list) => list.map((item) => (item.id === assignment.id ? { ...item, done: next } : item)));
    try {
      const result = await bridge.toggleAssignment(assignment.id, next, week);
      if (!result.ok) throw new Error(result.error || "Le devoir n'a pas pu être mis à jour.");
    } catch (e) {
      if (toggleSeq.current.get(assignment.id) !== seq) return;
      setItems((list) =>
        list.map((item) => (item.id === assignment.id ? { ...item, done: assignment.done } : item)),
      );
      notify(e instanceof Error ? e.message : "Bascule impossible, retour arrière.", "error");
    } finally {
      if (toggleSeq.current.get(assignment.id) === seq) {
        setPending((state) => {
          const nextState = { ...state };
          delete nextState[assignment.id];
          return nextState;
        });
      }
    }
  }

  async function openAttachment(assignment: Assignment, attachment: AssignmentAttachment) {
    try {
      const result = await bridge.openAttachment(assignment.id, attachment.id, week);
      if (!result.ok) throw new Error(result.error || "Pièce jointe introuvable.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Impossible d'ouvrir la pièce jointe.", "error");
    }
  }

  async function askHelp(assignment: Assignment) {
    const seq = ++helpSeq.current;
    setHelp({ id: assignment.id, loading: true, answer: null, refusal: null, error: null });
    try {
      const result = await bridge.askHomework(assignment.id, week);
      if (seq !== helpSeq.current) return;
      if (result.refused) {
        // #416 : la phrase du pont fait foi (le motif libre du modèle ne
        // franchit jamais la frontière) ; le repli est générique, jamais le
        // faux diagnostic « pas assez de matière ».
        setHelp({
          id: assignment.id,
          loading: false,
          answer: null,
          refusal: homeworkRefusalText(result.message),
          error: null,
        });
      } else if (!result.ok) {
        setHelp({
          id: assignment.id,
          loading: false,
          answer: null,
          refusal: null,
          error: result.message || "L'assistant n'a pas répondu.",
        });
      } else {
        setHelp({
          id: assignment.id,
          loading: false,
          answer: result.body || "Réponse vide.",
          refusal: null,
          error: null,
        });
      }
    } catch (e) {
      if (seq !== helpSeq.current) return;
      setHelp({
        id: assignment.id,
        loading: false,
        answer: null,
        refusal: null,
        error: e instanceof Error ? e.message : "Aide devoirs indisponible.",
      });
    }
  }

  const assistantDisabled = llm.configured !== true;
  const assistantReason =
    llm.error ??
    (llm.configured === null
      ? "Vérification de l'assistant…"
      : "Clé LLM absente : renseigne-la dans Réglages pour activer l'assistant.");

  if (resource.loading && items.length === 0) {
    return (
      <Page>
        <Loading label="Chargement des devoirs…" />
      </Page>
    );
  }

  if (resource.error && items.length === 0) {
    return (
      <Page>
        <ErrorBox message={resource.error}>
          <button type="button" className="btn btn--ghost btn--small" onClick={resource.refresh}>
            Réessayer
          </button>
        </ErrorBox>
      </Page>
    );
  }

  return (
    <Page>
      <div className="tasks-head">
        <div>
          <span className="tasks-head__eyebrow">
            {week === currentWeek ? "Semaine en cours" : "Semaine sélectionnée"}
          </span>
          <h2 className="tasks-head__title">Devoirs</h2>
        </div>
        {resource.stale ? <StaleBadge /> : null}
      </div>

      {resource.error ? <ErrorBox message={resource.error} /> : null}

      {assistantDisabled ? (
        <Card className="tasks-assistant">
          <span className="tasks-assistant__icon" aria-hidden="true">
            <IconSparkles />
          </span>
          <div className="grow" role="note">
            <strong>Assistant désactivé</strong>
            <p className="t-body-m muted" style={{ margin: "2px 0 0" }} id="tasks-assistant-reason">
              {assistantReason}
            </p>
            <button
              type="button"
              className="btn btn--ghost btn--small tasks-assistant__action"
              onClick={() => navigate("/settings")}
            >
              Ouvrir les réglages
            </button>
          </div>
        </Card>
      ) : null}

      {sections.length === 0 ? (
        <EmptyState
          icon={<IconCheck size={32} />}
          title="Aucun devoir"
          body="Rien à rendre pour le moment."
          action={
            <button type="button" className="btn btn--ghost btn--small" onClick={resource.refresh}>
              Actualiser
            </button>
          }
        />
      ) : (
        sections.map((section) => {
          const collapsed = section.id === "done" && !doneOpen;
          return (
            <Section
              key={section.id}
              title={section.title}
              action={
                <div className="row" style={{ gap: 4 }}>
                  <span className="chip" aria-label={`${section.items.length} devoir(s)`}>
                    {section.items.length}
                  </span>
                  {section.id === "done" ? (
                    <button
                      type="button"
                      className="icon-btn"
                      aria-expanded={!collapsed}
                      aria-label={collapsed ? "Déplier les devoirs terminés" : "Replier les devoirs terminés"}
                      onClick={() => setDoneOpen((open) => !open)}
                    >
                      {collapsed ? <IconChevronRight /> : <IconChevronLeft size={18} />}
                    </button>
                  ) : null}
                </div>
              }
            >
              {collapsed ? null : (
                <div className="list">
                  {section.items.map((assignment) => (
                    <AssignmentCard
                      key={assignment.id}
                      assignment={assignment}
                      busy={Boolean(pending[assignment.id])}
                      assistantDisabled={assistantDisabled}
                      assistantReasonId={assistantDisabled ? "tasks-assistant-reason" : undefined}
                      help={help?.id === assignment.id ? help : null}
                      onToggle={(next) => void toggle(assignment, next)}
                      onOpenAttachment={(attachment) => void openAttachment(assignment, attachment)}
                      onHelp={() => void askHelp(assignment)}
                      onCloseHelp={() => setHelp(null)}
                    />
                  ))}
                </div>
              )}
            </Section>
          );
        })
      )}
    </Page>
  );
}

/** Rouge sous 24 h, accent sous 72 h, neutre ensuite. */
function dueTone(due: string | null): string {
  const date = parseDate(due ?? "");
  if (!date) return "";
  const hours = (date.getTime() - Date.now()) / 3_600_000;
  if (hours < 24) return "task-card__due--soon";
  if (hours < 72) return "task-card__due--near";
  return "";
}

function AssignmentCard({
  assignment,
  busy,
  assistantDisabled,
  assistantReasonId,
  help,
  onToggle,
  onOpenAttachment,
  onHelp,
  onCloseHelp,
}: {
  assignment: Assignment;
  busy: boolean;
  assistantDisabled: boolean;
  assistantReasonId?: string;
  help: HelpState | null;
  onToggle: (next: boolean) => void;
  onOpenAttachment: (attachment: AssignmentAttachment) => void;
  onHelp: () => void;
  onCloseHelp: () => void;
}) {
  const { dark } = useApp();
  const text = assignmentCardText(assignment);
  const due = dueLabel(assignment.dueDate);
  const tone = dueTone(assignment.dueDate);

  return (
    <Card as="article" className={`task-card${assignment.done ? " task-card--done" : ""}`}>
      <div className="task-card__head">
        <SubjectAvatar subject={assignment.subject} size={42} dark={dark} />
        <div className="task-card__main">
          <span className="task-card__subject">{subjectDisplayFr(assignment.subject)}</span>
          {text.title ? <h3 className="task-card__title">{text.title}</h3> : null}
          {due ? <span className={`task-card__due ${tone}`}>{due}</span> : null}
        </div>
        <button
          type="button"
          aria-pressed={assignment.done}
          aria-label={`${assignment.done ? "Marquer à faire" : "Marquer fait"} : ${assignment.title}`}
          className={`task-check${assignment.done ? " task-check--done" : ""}`}
          disabled={busy}
          onClick={() => onToggle(!assignment.done)}
        >
          {assignment.done ? <IconCheck size={18} /> : null}
        </button>
      </div>

      {text.body ? <p className="task-card__body">{text.body}</p> : null}

      {assignment.lessonContent ? (
        <p className="chip task-card__lesson">Cours : {assignment.lessonContent.title}</p>
      ) : null}

      {assignment.attachments.length > 0 ? (
        <div className="row row--wrap" style={{ gap: 6, marginTop: 10 }}>
          {assignment.attachments.map((attachment) => (
            <button
              key={attachment.id}
              type="button"
              className="chip"
              aria-label={`Ouvrir la pièce jointe ${attachment.label}`}
              onClick={() => onOpenAttachment(attachment)}
            >
              <IconAttach size={16} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", maxWidth: 200 }}>
                {attachment.label}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="task-card__foot">
        <button
          type="button"
          className="task-help"
          disabled={assistantDisabled}
          aria-describedby={assistantReasonId}
          aria-label={`Aide devoirs pour ${assignment.title}`}
          onClick={onHelp}
        >
          <IconSparkles size={16} />
          Aide devoirs
        </button>
      </div>

      {help ? (
        <div
          role="region"
          aria-label={`Aide devoirs — ${assignment.subject}`}
          aria-live="polite"
          className="task-help__panel"
        >
          <div className="row row--between">
            <strong>Aide devoirs</strong>
            <button type="button" className="btn btn--ghost btn--small" onClick={onCloseHelp}>
              Fermer
            </button>
          </div>
          {help.loading ? <span>L’assistant rédige…</span> : null}
          {help.answer ? (
            <p className="t-body-m" style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {help.answer}
            </p>
          ) : null}
          {help.refusal ? (
            <p className="t-body-m" style={{ margin: 0 }}>
              {help.refusal}
            </p>
          ) : null}
          {help.error ? (
            <p className="t-body-m" role="alert" style={{ margin: 0, color: "var(--danger-ink)" }}>
              {help.error}
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
