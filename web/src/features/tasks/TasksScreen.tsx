import { useEffect, useMemo, useState } from "react";
import { bridge } from "../../bridge/client";
import { useApp, useResource } from "../../ui/AppContext";
import { Card, EmptyState, ErrorBox, Loading, Page, Section, StaleBadge } from "../../ui/components";
import { IconAttach, IconCheck, IconChevronLeft, IconChevronRight, IconSparkles } from "../../ui/icons";
import { subjectColor } from "../../lib/format";
import {
  assignmentCardText,
  assignmentSections,
  dueLabel,
  hasWeekBounds,
  parseAssignmentsPayload,
  shiftWeek,
  subjectDisplayFr,
  subjectInitial,
  weekEndOf,
  weekLabelFr,
  weekRangeFr,
  type Assignment,
  type AssignmentAttachment,
} from "./assignments";

type HelpState = {
  id: string;
  loading: boolean;
  answer: string | null;
  refusal: string | null;
  error: string | null;
};

type LlmState = { configured: boolean | null; error: string | null };

export function TasksScreen() {
  const { notify, refreshTick } = useApp();
  const [week, setWeek] = useState("");
  const query = week ? `weekStart=${week}` : "";
  const resource = useResource("assignments", query);
  const parsed = useMemo(() => parseAssignmentsPayload(resource.payload), [resource.payload]);
  const [items, setItems] = useState<Assignment[]>(parsed.items);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [doneOpen, setDoneOpen] = useState(false);
  const [help, setHelp] = useState<HelpState | null>(null);
  const [llm, setLlm] = useState<LlmState>({ configured: null, error: null });

  // Le payload fait foi : un rafraîchissement remplace l'état optimiste.
  useEffect(() => {
    setItems(parsed.items);
  }, [parsed]);

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
  const bounds = hasWeekBounds(parsed);
  const displayStart = week || parsed.weekStart;
  const displayEnd = displayStart ? weekEndOf(displayStart) : parsed.weekEnd;

  async function toggle(assignment: Assignment, next: boolean) {
    if (pending[assignment.id]) return;
    setPending((state) => ({ ...state, [assignment.id]: true }));
    setItems((list) => list.map((item) => (item.id === assignment.id ? { ...item, done: next } : item)));
    try {
      const result = await bridge.toggleAssignment(assignment.id, next);
      if (!result.ok) throw new Error(result.error || "Le devoir n'a pas pu être mis à jour.");
    } catch (e) {
      setItems((list) =>
        list.map((item) => (item.id === assignment.id ? { ...item, done: assignment.done } : item)),
      );
      notify(e instanceof Error ? e.message : "Bascule impossible, retour arrière.", "error");
    } finally {
      setPending((state) => {
        const nextState = { ...state };
        delete nextState[assignment.id];
        return nextState;
      });
    }
  }

  async function openAttachment(assignment: Assignment, attachment: AssignmentAttachment) {
    try {
      const result = await bridge.openAttachment(assignment.id, attachment.id);
      if (!result.ok) throw new Error(result.error || "Pièce jointe introuvable.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Impossible d'ouvrir la pièce jointe.", "error");
    }
  }

  async function askHelp(assignment: Assignment) {
    setHelp({ id: assignment.id, loading: true, answer: null, refusal: null, error: null });
    try {
      const result = await bridge.askHomework(assignment.id);
      if (result.refused) {
        setHelp({
          id: assignment.id,
          loading: false,
          answer: null,
          refusal:
            result.message ||
            "Le devoir n'a pas assez de matière : l'assistant refuse de répondre sans source.",
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
      <div className="row row--between">
        <h2 className="t-headline" style={{ margin: 0 }}>
          Devoirs
        </h2>
        <div className="row" style={{ gap: 6 }}>
          {resource.stale ? <StaleBadge /> : null}
          <button type="button" className="btn btn--ghost btn--small" onClick={resource.refresh}>
            Actualiser
          </button>
        </div>
      </div>

      {bounds && displayStart ? (
        <Card className="card--flat">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <button
              type="button"
              className="icon-btn"
              aria-label="Semaine précédente"
              onClick={() => setWeek(shiftWeek(displayStart, -1))}
            >
              <IconChevronLeft />
            </button>
            <span className="t-caption">
              {weekLabelFr(displayStart)}
              {weekRangeFr(displayStart, displayEnd ? displayEnd : null)
                ? ` · ${weekRangeFr(displayStart, displayEnd ? displayEnd : null)}`
                : ""}
            </span>
            <button
              type="button"
              className="icon-btn"
              aria-label="Semaine suivante"
              onClick={() => setWeek(shiftWeek(displayStart, 1))}
            >
              <IconChevronRight />
            </button>
          </div>
        </Card>
      ) : null}

      {resource.error ? <ErrorBox message={resource.error} /> : null}

      {assistantDisabled ? (
        <Card className="card--flat">
          <div className="row" role="note" style={{ alignItems: "flex-start" }}>
            <IconSparkles />
            <div className="grow">
              <strong>Assistant désactivé</strong>
              <p className="t-body-m muted" style={{ margin: "2px 0 0" }} id="tasks-assistant-reason">
                {assistantReason}
              </p>
            </div>
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
  const text = assignmentCardText(assignment);
  const colour = subjectColor(assignment.subject);
  const dim = assignment.done ? 0.6 : 1;

  return (
    <Card as="article">
      <div className="row" style={{ alignItems: "flex-start", gap: 8 }}>
        <span
          aria-hidden="true"
          style={{
            width: 34,
            height: 34,
            borderRadius: 999,
            background: colour,
            color: "#fff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            flex: "0 0 auto",
          }}
        >
          {subjectInitial(assignment.subject)}
        </span>
        <div className="grow" style={{ opacity: dim }}>
          <strong style={{ display: "block" }}>{subjectDisplayFr(assignment.subject)}</strong>
          {text.title ? <span>{text.title}</span> : null}
        </div>
        {dueLabel(assignment.dueDate) ? (
          <span className="tiny muted" style={{ textAlign: "right", flex: "0 0 auto" }}>
            {dueLabel(assignment.dueDate)}
          </span>
        ) : null}
      </div>

      {text.body ? (
        <p
          className="t-body-m"
          style={{ margin: "8px 0 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere", opacity: dim }}
        >
          {text.body}
        </p>
      ) : null}

      {assignment.lessonContent ? (
        <p className="chip" style={{ marginTop: 8, maxWidth: "100%" }}>
          Cours : {assignment.lessonContent.title}
        </p>
      ) : null}

      {assignment.attachments.length > 0 ? (
        <div className="row row--wrap" style={{ gap: 6, marginTop: 8 }}>
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

      <div className="row" style={{ justifyContent: "flex-end", gap: 6, marginTop: 10 }}>
        <button
          type="button"
          className="chip"
          disabled={assistantDisabled}
          style={assistantDisabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
          aria-describedby={assistantReasonId}
          aria-label={`Aide devoirs pour ${assignment.title}`}
          onClick={onHelp}
        >
          <IconSparkles size={16} />
          Aide devoirs
        </button>
        <button
          type="button"
          role="checkbox"
          aria-checked={assignment.done}
          aria-label={`${assignment.done ? "Marquer à faire" : "Marquer fait"} : ${assignment.title}`}
          className={assignment.done ? "chip chip--active" : "chip"}
          disabled={busy}
          onClick={() => onToggle(!assignment.done)}
        >
          {assignment.done ? <IconCheck size={16} /> : null}
          {assignment.done ? "Terminé" : "Marquer fait"}
        </button>
      </div>

      {help ? (
        <div
          role="region"
          aria-label={`Aide devoirs — ${assignment.subject}`}
          aria-live="polite"
          style={{
            marginTop: 10,
            padding: 12,
            borderRadius: "var(--radius-sm)",
            background: "var(--surface-variant)",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div className="row row--between">
            <strong>Aide devoirs</strong>
            <button type="button" className="btn btn--ghost btn--small" onClick={onCloseHelp}>
              Fermer
            </button>
          </div>
          {help.loading ? <span role="status">L’assistant rédige…</span> : null}
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
