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
import { Dialog } from "../../ui/Dialog";
import {
  IconAttach,
  IconBook,
  IconCamera,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconImage,
  IconSparkles,
} from "../../ui/icons";
import { parseDate } from "../../lib/format";
import type { AiContextSourceMeta } from "../../bridge/types";
import {
  aiContextTypeFr,
  assignmentCardText,
  assignmentHasAssistantMaterial,
  assignmentSections,
  assignmentsInWeek,
  dueLabel,
  homeworkRefusalText,
  parseAiContext,
  parseAssignmentsPayload,
  parseHomeworkActions,
  parseHomeworkAnswer,
  shiftWeek,
  subjectDisplayFr,
  weekEndOf,
  weekGap,
  weekLabelFr,
  weekRangeFr,
  weekStartOf,
  type Assignment,
  type AssignmentAttachment,
  type HomeworkAction,
} from "./assignments";
import { cardActionFlags } from "./actions";
import "./tasks.css";

type HelpState = {
  id: string;
  loading: boolean;
  answer: string | null;
  /** #629 : étapes ordonnées et sources citées du corrigé. */
  steps: string[];
  sources: string[];
  refusal: string | null;
  /** CTA stables renvoyés par un refus (`add_course`, `enable_manual`…). */
  actions: HomeworkAction[];
  error: string | null;
  /** true = corrigé obtenu depuis une photo d'énoncé. */
  photo?: boolean;
  photoSource?: "camera" | "gallery";
  /** #628 : sources réellement envoyées (type, libellé, taille, troncature). */
  context?: AiContextSourceMeta[];
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
  const [photoChooser, setPhotoChooser] = useState<Assignment | null>(null);
  const [revisionPending, setRevisionPending] = useState<Record<string, boolean>>({});
  const [llm, setLlm] = useState<LlmState>({ configured: null, error: null });
  const [manualSubjects, setManualSubjects] = useState<string[]>([]);
  const [lessonSubjects, setLessonSubjects] = useState<string[]>([]);
  const helpSeq = useRef(0);
  const toggleSeq = useRef(new Map<string, number>());
  // L'assistant est UNE ressource payante pour tout l'écran : un second
  // appel simultané jetterait la première réponse tout en la payant.
  const revisionBusy = Object.keys(revisionPending).length > 0;
  const assistantBusy = help?.loading === true || revisionBusy;

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
    // Un seul assistant en vol pour TOUT l'écran : le bouton d'une autre
    // carte ne voit pas la demande en cours.
    if (assistantBusy) return;
    const seq = ++helpSeq.current;
    setHelp({ id: assignment.id, loading: true, answer: null, steps: [], sources: [], refusal: null, actions: [], error: null });
    try {
      const result = await bridge.askHomework(assignment.id, week);
      if (seq !== helpSeq.current) return;
      const context = parseAiContext(result.context);
      if (result.refused) {
        // #416 : la phrase du pont fait foi (le motif libre du modèle ne
        // franchit jamais la frontière) ; le repli est générique, jamais le
        // faux diagnostic « pas assez de matière ».
        setHelp({
          id: assignment.id,
          loading: false,
          answer: null,
          steps: [],
          sources: [],
          refusal: homeworkRefusalText(result.message),
          actions: parseHomeworkActions(result.actions),
          error: null,
          context,
        });
      } else if (!result.ok) {
        setHelp({
          id: assignment.id,
          loading: false,
          answer: null,
          steps: [],
          sources: [],
          refusal: null,
          actions: [],
          error: result.message || "L'assistant n'a pas répondu.",
          context,
        });
      } else {
        const answer = parseHomeworkAnswer(result);
        setHelp({
          id: assignment.id,
          loading: false,
          answer: answer?.answer ?? null,
          steps: answer?.steps ?? [],
          sources: answer?.sources ?? [],
          refusal: null,
          actions: [],
          error: answer ? null : "Réponse vide.",
          context,
        });
      }
    } catch (e) {
      if (seq !== helpSeq.current) return;
      setHelp({
        id: assignment.id,
        loading: false,
        answer: null,
        steps: [],
        sources: [],
        refusal: null,
        actions: [],
        error: e instanceof Error ? e.message : "Aide devoirs indisponible.",
      });
    }
  }

  async function askPhoto(assignment: Assignment, source: "camera" | "gallery") {
    if (assistantBusy) return;
    const seq = ++helpSeq.current;
    setHelp({
      id: assignment.id,
      loading: true,
      answer: null,
      steps: [],
      sources: [],
      refusal: null,
      actions: [],
      error: null,
      photo: true,
      photoSource: source,
    });
    try {
      const result = await bridge.solveHomeworkPhoto(assignment.id, week, source);
      if (seq !== helpSeq.current) return;
      const context = parseAiContext(result.context);
      if (result.cancelled) {
        setHelp(null);
        return;
      }
      if (result.refused) {
        setHelp({
          id: assignment.id,
          loading: false,
          answer: null,
          steps: [],
          sources: [],
          refusal: homeworkRefusalText(result.message),
          actions: parseHomeworkActions(result.actions),
          error: null,
          photo: true,
          photoSource: source,
          context,
        });
      } else if (!result.ok) {
        setHelp({
          id: assignment.id,
          loading: false,
          answer: null,
          steps: [],
          sources: [],
          refusal: null,
          actions: [],
          error: result.message || "L'assistant n'a pas répondu.",
          photo: true,
          photoSource: source,
          context,
        });
      } else {
        const answer = parseHomeworkAnswer(result);
        setHelp({
          id: assignment.id,
          loading: false,
          answer: answer?.answer ?? null,
          steps: answer?.steps ?? [],
          sources: answer?.sources ?? [],
          refusal: null,
          actions: [],
          error: answer ? null : "Réponse vide.",
          photo: true,
          photoSource: source,
          context,
        });
      }
    } catch (e) {
      if (seq !== helpSeq.current) return;
      setHelp({
        id: assignment.id,
        loading: false,
        answer: null,
        steps: [],
        sources: [],
        refusal: null,
        actions: [],
        error: e instanceof Error ? e.message : "Aide photo indisponible.",
        photo: true,
        photoSource: source,
      });
    }
  }

  /** Fermer ignore la demande en vol : une réponse tardive ne rouvre pas le
   *  panneau que l'élève vient de fermer. L'appel natif, lui, finit — le pont
   *  n'a pas d'annulation LLM ; on IGNORE la réponse, on ne l'annule pas. */
  function closeHelp() {
    helpSeq.current += 1;
    setHelp(null);
  }

  /** Le choix de la source vit HORS des cartes : un seul dialogue pour la
   *  semaine. Annuler ne touche ni au panneau ni à la demande en vol. */
  function closePhotoChooser() {
    setPhotoChooser(null);
  }

  function choosePhoto(source: "camera" | "gallery") {
    const assignment = photoChooser;
    if (!assignment) return;
    setPhotoChooser(null);
    void askPhoto(assignment, source);
  }

  async function generateSheet(assignment: Assignment) {
    if (assistantBusy) return;
    setRevisionPending((state) => ({ ...state, [assignment.id]: true }));
    try {
      // La semaine AFFICHÉE, comme l'aide devoirs (#369, #596) : le devoir peut
      // venir d'une autre semaine et le cache ne garde pas toutes les fenêtres.
      const result = await bridge.generateRevision(assignment.id, week);
      if (!result.ok) throw new Error(result.message || "La fiche n'a pas pu être créée.");
      notify("Fiche de révision créée.");
      navigate("/revision-sheets");
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
                      assistantBusy={assistantBusy}
                      onToggle={(next) => void toggle(assignment, next)}
                      onOpenAttachment={(attachment) => void openAttachment(assignment, attachment)}
                      onHelp={() => void askHelp(assignment)}
                      onPhoto={(source) => void askPhoto(assignment, source)}
                      onOpenPhotoChooser={() => setPhotoChooser(assignment)}
                      onCloseHelp={closeHelp}
                      onAddCourse={() => navigate("/course-notes")}
                      onEnableManual={() => navigate("/settings")}
                      onGenerateSheet={() => void generateSheet(assignment)}
                    />
                  ))}
                </div>
              )}
            </Section>
          );
        })
      )}

      <Dialog
        open={photoChooser !== null}
        title="Photo de l’énoncé"
        description="La photo part directement au fournisseur, avec ta clé. Elle est supprimée après lecture."
        icon={<IconCamera size={20} />}
        onClose={closePhotoChooser}
        actions={
          <button type="button" className="btn btn--ghost btn--small" onClick={closePhotoChooser}>
            Annuler
          </button>
        }
      >
        {photoChooser ? (
          <div className="photo-choices">
            <button
              type="button"
              className="photo-choice"
              data-autofocus
              onClick={() => choosePhoto("camera")}
            >
              <span className="photo-choice__icon" aria-hidden="true">
                <IconCamera size={20} />
              </span>
              <span>Prendre une photo</span>
            </button>
            <button
              type="button"
              className="photo-choice"
              onClick={() => choosePhoto("gallery")}
            >
              <span className="photo-choice__icon" aria-hidden="true">
                <IconImage size={20} />
              </span>
              <span>Choisir une image</span>
            </button>
          </div>
        ) : null}
      </Dialog>
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
  assistantBusy,
  onToggle,
  onOpenAttachment,
  onHelp,
  onPhoto,
  onOpenPhotoChooser,
  onCloseHelp,
  onAddCourse,
  onEnableManual,
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
  assistantBusy: boolean;
  onToggle: (next: boolean) => void;
  onOpenAttachment: (attachment: AssignmentAttachment) => void;
  onHelp: () => void;
  onPhoto: (source: "camera" | "gallery") => void;
  onOpenPhotoChooser: () => void;
  onCloseHelp: () => void;
  onAddCourse: () => void;
  onEnableManual: () => void;
  onGenerateSheet: () => void;
}) {
  const { dark } = useApp();
  const helpPanelId = useId();
  const noMaterialId = useId();
  const textTriggerRef = useRef<HTMLButtonElement>(null);
  const photoTriggerRef = useRef<HTMLButtonElement>(null);
  const text = assignmentCardText(assignment);
  const due = dueLabel(assignment.dueDate);
  const tone = dueTone(assignment.dueDate);
  // Sans consigne ni cours, l'aide TEXTE refuserait avant le
  // modèle. La photo, elle, est une source à part entière : elle reste
  // disponible même sans manuel ni cahier. Un manuel utilisable ou un cours
  // du cahier pour CETTE matière compte comme source pour le texte.
  const hasMaterial = assignmentHasAssistantMaterial(assignment, manualReady, lessonReady);
  const helpLoading = help?.loading === true;
  const hasPanel = help !== null;
  const { textOff, photoOff, sheetOff } = cardActionFlags({
    assistantDisabled,
    hasMaterial,
    hasPanel,
    helpLoading,
    helpPhoto: help?.photo === true,
    assistantBusy,
  });
  const offReason = assistantDisabled ? assistantReasonId : hasMaterial ? undefined : noMaterialId;

  /** Le bouton du panneau disparaît en le fermant : le focus revient au
   *  déclencheur qui l'a ouvert, sans remonter la liste. */
  function closeFromPanel() {
    const trigger = help?.photo ? photoTriggerRef.current : textTriggerRef.current;
    onCloseHelp();
    trigger?.focus();
  }

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
          disabled={sheetOff}
          aria-describedby={offReason}
          aria-label={`Créer une fiche de révision pour ${assignment.title}`}
          onClick={onGenerateSheet}
        >
          <IconBook size={16} />
          {revisionBusy ? "Création…" : "Fiche de révision"}
        </button>
        <button
          ref={textTriggerRef}
          type="button"
          className={`task-help${help && !help.photo ? " task-help--open" : ""}`}
          disabled={textOff}
          aria-describedby={offReason}
          aria-expanded={help !== null && !help.photo}
          aria-controls={help && !help.photo ? helpPanelId : undefined}
          aria-label={`${help && !help.photo ? "Fermer" : "Ouvrir"} l'aide devoirs pour ${assignment.title}`}
          onClick={help && !help.photo ? onCloseHelp : onHelp}
        >
          <IconSparkles size={16} />
          {help && !help.photo ? "Fermer l’aide" : "Aide devoirs"}
        </button>
        <button
          ref={photoTriggerRef}
          type="button"
          className={`task-help task-help--photo${help?.photo ? " task-help--open" : ""}`}
          disabled={photoOff}
          aria-describedby={assistantDisabled ? assistantReasonId : undefined}
          aria-expanded={help?.photo === true}
          aria-controls={help?.photo ? helpPanelId : undefined}
          aria-haspopup="dialog"
          aria-label={`${help?.photo ? "Fermer" : "Ouvrir"} la photo de l’énoncé pour ${assignment.title}`}
          onClick={help?.photo ? onCloseHelp : onOpenPhotoChooser}
        >
          <IconCamera size={16} />
          {help?.photo ? "Fermer la photo" : "Photo de l’énoncé"}
        </button>
      </div>

      {assistantDisabled || hasMaterial ? null : (
        <p id={noMaterialId} className="tiny muted task-card__hint">
          Photographie l’énoncé ci-dessus : la photo devient la source du corrigé.
        </p>
      )}

      {help ? (
        <div
          id={helpPanelId}
          role="region"
          aria-label={`${help.photo ? "Photo de l’énoncé" : "Aide devoirs"} — ${assignment.subject}`}
          aria-live="polite"
          aria-busy={help.loading}
          className="task-help__panel"
        >
          <div className="task-help__panel-head">
            <span className="task-help__panel-icon" aria-hidden="true">
              <IconSparkles size={18} />
            </span>
            <strong className="task-help__panel-title">
              {help.photo ? "Photo de l’énoncé" : "Aide devoirs"}
            </strong>
            <button
              type="button"
              className="icon-btn task-help__panel-close"
              aria-label="Fermer l’aide"
              onClick={closeFromPanel}
            >
              <IconClose size={18} />
            </button>
          </div>
          {help.loading ? (
            <p className="task-help__panel-status">
              <span className="spinner" aria-hidden="true" />
              <span>{help.photo ? "L’assistant lit la photo…" : "L’assistant rédige…"}</span>
            </p>
          ) : null}
          {help.answer ? <p className="task-help__panel-answer">{help.answer}</p> : null}
          {help.steps.length > 0 ? (
            <ol className="task-help__steps">
              {help.steps.map((step, index) => (
                <li key={`${index}:${step.slice(0, 40)}`}>{step}</li>
              ))}
            </ol>
          ) : null}
          {help.sources.length > 0 ? (
            <div className="task-help__sources">
              <p className="tiny muted">Sources citées</p>
              <ul>
                {help.sources.map((source, index) => (
                  <li key={`${index}:${source}`}>{source}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {help.refusal ? (
            <div className="task-help__panel-refusal">
              <p>{help.refusal}</p>
              {help.actions.includes("add_course") ? (
                <button type="button" className="btn btn--ghost btn--small" onClick={onAddCourse}>
                  Ajouter un cours au cahier
                </button>
              ) : null}
              {help.actions.includes("enable_manual") ? (
                <button type="button" className="btn btn--ghost btn--small" onClick={onEnableManual}>
                  Enregistrer mon manuel
                </button>
              ) : null}
              {help.actions.includes("open_attachment") && assignment.attachments[0] ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() => onOpenAttachment(assignment.attachments[0]!)}
                >
                  Ouvrir la pièce jointe
                </button>
              ) : null}
            </div>
          ) : null}
          {help.error ? (
            <div className="task-help__panel-error">
              <p role="alert">{help.error}</p>
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={help.photo ? () => onPhoto(help.photoSource ?? "camera") : onHelp}
              >
                Réessayer
              </button>
            </div>
          ) : null}
          <details className="task-help__privacy">
            <summary>Ce qui est envoyé</summary>
            <p className="tiny muted">
              {help.photo
                ? "La photo de l’énoncé, la consigne, le cours" +
                  (lessonReady ? ", ton cours mémorisé" : "") +
                  (manualReady ? " et le texte du manuel" : "") +
                  " sont envoyés directement au fournisseur, avec ta clé. La photo est supprimée après lecture."
                : manualReady && lessonReady
                  ? "Le sujet, la consigne, le cours, ton cahier et le texte du manuel sont envoyés directement au fournisseur, avec ta clé."
                  : lessonReady
                    ? "Le sujet, la consigne, le cours et ton cours mémorisé sont envoyés directement au fournisseur, avec ta clé."
                    : manualReady
                      ? "Le sujet, la consigne, le cours et le texte du manuel sont envoyés directement au fournisseur, avec ta clé."
                      : "Le sujet, la consigne et le cours de ce devoir sont envoyés directement au fournisseur, avec ta clé."}
            </p>
            {help.context && help.context.length > 0 ? (
              <ul className="task-help__context tiny muted">
                {help.context.map((source, index) => (
                  <li key={`${source.type}:${source.label}:${index}`}>
                    {aiContextTypeFr(source.type)} — {source.label} ({source.chars} caractères
                    {source.truncated ? ", tronquée" : ""})
                  </li>
                ))}
              </ul>
            ) : null}
          </details>
        </div>
      ) : null}
    </Card>
  );
}
