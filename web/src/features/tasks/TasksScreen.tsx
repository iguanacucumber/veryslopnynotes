import { useEffect, useId, useMemo, useRef, useState } from "react";
import { bridge } from "../../bridge/client";
import { useApp, useResource } from "../../ui/AppContext";
import { useViewNavigate } from "../../ui/viewTransition";
import {
  Card,
  EmptyState,
  ErrorBox,
  Loading,
  Page,
  PageHeading,
  Section,
  StaleBadge,
  SubjectAvatar,
  WeekNavigator,
} from "../../ui/components";
import { IconAttach, IconBook, IconCheck, IconChevronLeft, IconChevronRight, IconSparkles } from "../../ui/icons";
import { parseDate } from "../../lib/format";
import {
  assignmentCardText,
  assignmentHasAssistantMaterial,
  assignmentSections,
  assignmentsInWeek,
  dueLabel,
  homeworkRefusalText,
  parseAssignmentsPayload,
  shiftWeek,
  subjectDisplayFr,
  weekEndOf,
  weekGap,
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
      <WeekNavigator
        label={weekLabelFr(week)}
        detail={range ?? undefined}
        weeks={weekGap(week, currentWeek)}
        onPrevious={() => setWeek((value) => shiftWeek(value, -1))}
        onNext={() => setWeek((value) => shiftWeek(value, 1))}
        onToday={() => setWeek(currentWeek)}
      />

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
  const [revisionPending, setRevisionPending] = useState<Record<string, boolean>>({});
  const [llm, setLlm] = useState<LlmState>({ configured: null, error: null });
  const [manualSubjects, setManualSubjects] = useState<string[]>([]);
  const [lessonSubjects, setLessonSubjects] = useState<string[]>([]);
  const helpSeq = useRef(0);
  const toggleSeq = useRef(new Map<string, number>());

  // Le payload fait foi : un rafraîchissement remplace l'état optimiste.
  useEffect(() => {
    setItems(visible);
  }, [visible]);

  useEffect(() => {
    let alive = true;
    setLlm((state) => ({ ...state, error: null }));
    void Promise.allSettled([bridge.llmStatus(), bridge.settings()]).then(([llmResult, settingsResult]) => {
      if (!alive) return;
      if (llmResult.status === "fulfilled") {
        setLlm({ configured: Boolean(llmResult.value.configured), error: null });
      } else {
        setLlm({
          configured: false,
          error:
            llmResult.reason instanceof Error
              ? llmResult.reason.message
              : "état de l'assistant indisponible",
        });
      }
      if (settingsResult.status === "fulfilled") {
        setManualSubjects(
          Array.isArray(settingsResult.value.manualSubjects)
            ? settingsResult.value.manualSubjects.filter((s): s is string => typeof s === "string")
            : [],
        );
        setLessonSubjects(
          Array.isArray(settingsResult.value.lessonSubjects)
            ? settingsResult.value.lessonSubjects.filter((s): s is string => typeof s === "string")
            : [],
        );
      }
    });
    return () => {
      alive = false;
    };
  }, [refreshTick]);

  // Les sections suivent la semaine AFFICHÉE (#567) : « En retard »,
  // « Aujourd'hui » et la section de semaine décrivent la semaine affichée,
  // pas la semaine en cours quel que soit l'en-tête.
  const sections = useMemo(() => assignmentSections(items, week, new Date()), [items, week]);

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

  /** Fermer annule AUSSI la demande en vol : sinon une réponse tardive
   *  rouvrirait le panneau que l'élève vient de fermer. */
  function closeHelp() {
    helpSeq.current += 1;
    setHelp(null);
  }

  async function generateSheet(assignment: Assignment) {
    if (revisionPending[assignment.id]) return;
    setRevisionPending((state) => ({ ...state, [assignment.id]: true }));
    try {
      const result = await bridge.generateRevision(assignment.id);
      if (!result.ok) throw new Error(result.message || "La fiche n'a pas pu être créée.");
      notify("Fiche de révision créée.");
      navigate("/fiches");
    } catch (e) {
      notify(e instanceof Error ? e.message : "La fiche n'a pas pu être créée.", "error");
    } finally {
      setRevisionPending((state) => {
        const nextState = { ...state };
        delete nextState[assignment.id];
        return nextState;
      });
    }
  }

  const assistantChecking = llm.configured === null;
  const assistantDisabled = llm.configured !== true;
  const assistantReason = assistantChecking
    ? "Vérification de la clé…"
    : llm.error ??
      "Clé LLM absente : renseigne-la dans Réglages pour activer l'assistant.";

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
          <button type="button" className="btn btn--small" onClick={resource.refresh}>
            Réessayer
          </button>
        </ErrorBox>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeading
        eyebrow={week === currentWeek ? "Semaine en cours" : "Semaine sélectionnée"}
        title="Devoirs"
        action={resource.stale ? <StaleBadge /> : null}
      />

      {resource.error ? <ErrorBox message={resource.error} /> : null}

      {assistantChecking ? (
        <Card className="tasks-assistant tasks-assistant--checking">
          <span className="tasks-assistant__icon" aria-hidden="true">
            <IconSparkles />
          </span>
          <div className="grow" role="status">
            <strong>Assistant devoirs</strong>
            <p className="t-body-m muted" style={{ margin: "2px 0 0" }} id="tasks-assistant-reason">
              {assistantReason}
            </p>
          </div>
        </Card>
      ) : assistantDisabled ? (
        <Card className="tasks-assistant">
          <span className="tasks-assistant__icon" aria-hidden="true">
            <IconSparkles />
          </span>
          <div className="grow" role="note">
            <strong>{llm.error ? "Assistant indisponible" : "Assistant désactivé"}</strong>
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
          icon={<IconCheck size={30} />}
          title="Aucun devoir"
          body="Rien à rendre pour le moment."
          action={
            <button type="button" className="btn btn--small" onClick={resource.refresh}>
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
                      manualReady={manualSubjects.includes(assignment.subject)}
                      lessonReady={lessonSubjects.includes(assignment.subject)}
                      help={help?.id === assignment.id ? help : null}
                      revisionBusy={Boolean(revisionPending[assignment.id])}
                      onToggle={(next) => void toggle(assignment, next)}
                      onOpenAttachment={(attachment) => void openAttachment(assignment, attachment)}
                      onHelp={() => void askHelp(assignment)}
                      onCloseHelp={closeHelp}
                      onGenerateSheet={() => void generateSheet(assignment)}
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
  manualReady,
  lessonReady,
  help,
  revisionBusy,
  onToggle,
  onOpenAttachment,
  onHelp,
  onCloseHelp,
  onGenerateSheet,
}: {
  assignment: Assignment;
  busy: boolean;
  assistantDisabled: boolean;
  assistantReasonId?: string;
  manualReady: boolean;
  lessonReady: boolean;
  help: HelpState | null;
  revisionBusy: boolean;
  onToggle: (next: boolean) => void;
  onOpenAttachment: (attachment: AssignmentAttachment) => void;
  onHelp: () => void;
  onCloseHelp: () => void;
  onGenerateSheet: () => void;
}) {
  const { dark } = useApp();
  const helpPanelId = useId();
  const noMaterialId = useId();
  const text = assignmentCardText(assignment);
  const due = dueLabel(assignment.dueDate);
  const tone = dueTone(assignment.dueDate);
  // Sans consigne ni extrait de cours, le natif refuse AVANT d'appeler le
  // modèle : proposer les deux actions IA ne mènerait qu'à une erreur. Un
  // manuel utilisable ou un cours du cahier pour CETTE matière compte comme
  // source (le natif l'ajoute au prompt).
  const hasMaterial = assignmentHasAssistantMaterial(assignment, manualReady, lessonReady);
  const assistantOff = assistantDisabled || !hasMaterial;
  const offReason = hasMaterial ? assistantReasonId : noMaterialId;

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
          disabled={assistantOff || revisionBusy}
          aria-describedby={offReason}
          aria-label={`Créer une fiche de révision pour ${assignment.title}`}
          onClick={onGenerateSheet}
        >
          <IconBook size={16} />
          {revisionBusy ? "Création…" : "Fiche de révision"}
        </button>
        <button
          type="button"
          className={`task-help${help ? " task-help--open" : ""}`}
          disabled={assistantOff}
          aria-describedby={offReason}
          aria-expanded={help !== null}
          aria-controls={help ? helpPanelId : undefined}
          aria-label={`${help ? "Fermer" : "Ouvrir"} l'aide devoirs pour ${assignment.title}`}
          onClick={help ? onCloseHelp : onHelp}
        >
          <IconSparkles size={16} />
          {help ? "Fermer l’aide" : "Aide devoirs"}
        </button>
      </div>

      {!hasMaterial ? (
        <p id={noMaterialId} className="tiny muted" style={{ margin: "8px 0 0" }}>
          Aucun contenu à envoyer pour ce devoir : ajoute une consigne côté établissement pour
          activer l’assistant.
        </p>
      ) : null}

      {help ? (
        <div
          id={helpPanelId}
          role="region"
          aria-label={`Aide devoirs — ${assignment.subject}`}
          aria-live="polite"
          className="task-help__panel"
        >
          <strong>Aide devoirs</strong>
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
            <div className="stack" style={{ gap: 6 }}>
              <p className="t-body-m" role="alert" style={{ margin: 0, color: "var(--danger-ink)" }}>
                {help.error}
              </p>
              <button type="button" className="btn btn--ghost btn--small" onClick={onHelp}>
                Réessayer
              </button>
            </div>
          ) : null}
          <p className="tiny muted" style={{ margin: 0 }}>
            {manualReady && lessonReady
              ? "Le sujet, la consigne, l’extrait de cours, ton cahier et le texte du manuel sont envoyés directement au fournisseur, avec ta clé."
              : lessonReady
                ? "Le sujet, la consigne, l’extrait de cours et ton cours mémorisé sont envoyés directement au fournisseur, avec ta clé."
                : manualReady
                  ? "Le sujet, la consigne, l’extrait de cours et le texte du manuel sont envoyés directement au fournisseur, avec ta clé."
                  : "Le sujet, la consigne et l’extrait de cours de ce devoir sont envoyés directement au fournisseur, avec ta clé."}
          </p>
        </div>
      ) : null}
    </Card>
  );
}
