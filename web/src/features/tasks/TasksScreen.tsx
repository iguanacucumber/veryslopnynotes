import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { bridge, type BridgeProgress } from "../../bridge/client";
import { useApp, useResource } from "../../ui/AppContext";
import { useViewNavigate } from "../../ui/viewTransition";
import {
  Card,
  EmptyState,
  ErrorBox,
  Loading,
  Page,
  SearchField,
  Section,
  StaleBadge,
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
  IconImage,
  IconSparkles,
} from "../../ui/icons";
import { relativeLongFr, subjectColor, tint } from "../../lib/format";
import { subjectEmoji } from "../../lib/subjectVisual";
import {
  assignmentCardText,
  assignmentHasAssistantMaterial,
  assignmentSections,
  assignmentsInWeek,
  assignmentsMatching,
  homeworkFollowUpQuestion,
  homeworkRefusalText,
  parseAiContext,
  parseAssignmentsPayload,
  parseHomeworkActions,
  parseHomeworkAnswer,
  shiftWeek,
  subjectDisplayFr,
  taskProgress,
  weekEndOf,
  weekGap,
  weekLabelFr,
  weekRangeFr,
  weekStartOf,
  type Assignment,
  type AssignmentAttachment,
} from "./assignments";
import { cardActionFlags } from "./actions";
import { HomeworkChat, type HomeworkChatState, type HomeworkTurn } from "./HomeworkChat";
import { emptyTurn, storedThread } from "./homeworkThread";
import "./tasks.css";

// Le fil ne grandit pas sans fin : les réponses précédentes restent locales,
// mais seuls les derniers échanges sont gardés à l'écran.
const MAX_CHAT_TURNS = 8;

type LlmState = { configured: boolean | null; error: string | null };

/** La semaine est TOUJOURS bornée localement : sans elle, un payload sans
 *  `weekStart` piégerait l'utilisateur sur une semaine qu'il ne peut quitter. */
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
  // la semaine affichée. Semaine sans devoir = état vide, pas chargement sans fin.
  const visible = useMemo(() => assignmentsInWeek(parsed.items, week), [parsed.items, week]);
  const [items, setItems] = useState<Assignment[]>(visible);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [doneOpen, setDoneOpen] = useState(false);
  const [help, setHelp] = useState<HomeworkChatState | null>(null);
  const [photoChooser, setPhotoChooser] = useState<Assignment | null>(null);
  const [revisionPending, setRevisionPending] = useState<Record<string, boolean>>({});
  // Vols d'assistant en cours, indépendants du panneau : fermer l'aide
  // n'arrête PAS l'appel payé. Tant que la promesse n'est pas réglée
  // (réponse, erreur, annulation), les autres cartes restent fermées.
  const [helpFlights, setHelpFlights] = useState(0);
  const [llm, setLlm] = useState<LlmState>({ configured: null, error: null });
  const [manualSubjects, setManualSubjects] = useState<string[]>([]);
  const [lessonSubjects, setLessonSubjects] = useState<string[]>([]);
  const helpSeq = useRef(0);
  // Fils fermés, gardés en mémoire seulement : rouvrir relit l'explication
  // sans repayer un appel. Aucune écriture disque, donc rien à purger.
  const threadsRef = useRef(new Map<string, HomeworkChatState>());
  const toggleSeq = useRef(new Map<string, number>());
  // L'assistant est UNE ressource payante pour tout l'écran : un second
  // appel simultané jetterait la première réponse tout en la payant.
  const revisionBusy = Object.keys(revisionPending).length > 0;
  const assistantBusy = helpFlights > 0 || revisionBusy;

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

  // Les sections suivent la semaine AFFICHÉE, pas la semaine en cours ; la
  // recherche filtre les cartes, jamais la fenêtre de semaine.
  const matching = useMemo(() => assignmentsMatching(items, search), [items, search]);
  const sections = useMemo(() => assignmentSections(matching, week, new Date()), [matching, week]);
  const progress = useMemo(() => taskProgress(items), [items]);
  const searching = search.trim() !== "";

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

  async function askHelp(
    assignment: Assignment,
    proceedAnyway = false,
    followUp?: string,
    replaceCurrent = false,
  ) {
    // Un seul assistant en vol pour TOUT l'écran : le bouton d'une autre
    // carte ne voit pas la demande en cours.
    if (assistantBusy) return;
    const seq = ++helpSeq.current;
    const previous = help?.id === assignment.id ? help : null;
    const isFollowUp = followUp !== undefined;
    // Une réponse photo réussie tient lieu de source pour le fil : le suivi
    // reste possible sans repasser par un refus « documents manquants ».
    const photoFollowUp = isFollowUp && previous?.photo === true && previous.current.answer !== null;
    const allowUnsourced =
      proceedAnyway || (isFollowUp ? (previous?.allowUnsourced ?? false) || photoFollowUp : false);
    // Une réponse en cours n'est pas archivée : une erreur ou un refus reste
    // remplaçable sans empiler un faux échange dans le fil.
    const archive =
      isFollowUp &&
      !replaceCurrent &&
      previous?.current &&
      (previous.current.answer !== null || previous.current.refusal !== null);
    const turns =
      isFollowUp && previous
        ? (archive ? [...previous.turns, previous.current] : previous.turns).slice(-MAX_CHAT_TURNS)
        : [];
    const question = isFollowUp ? homeworkFollowUpQuestion(followUp, turns) : undefined;
    const turn = emptyTurn(followUp?.trim() ?? "");

    setHelpFlights((count) => count + 1);
    setHelp({
      id: assignment.id,
      // Un suivi est un appel texte : la photo n'est ni renvoyée ni relue.
      photo: false,
      photoSource: undefined,
      loading: true,
      allowUnsourced,
      phases: [{ phase: "prepare", at: Date.now() }],
      turns,
      current: turn,
    });

    const onProgress = (progress: BridgeProgress) => {
      if (seq !== helpSeq.current) return;
      setHelp((state) =>
        state?.id === assignment.id
          ? { ...state, phases: [...state.phases, { ...progress, at: Date.now() }].slice(-10) }
          : state,
      );
    };

    try {
      const result = await bridge.askHomework(assignment.id, week, allowUnsourced, question, onProgress);
      if (seq !== helpSeq.current) return;
      const context = parseAiContext(result.context);
      const finish = (patch: Partial<HomeworkTurn>) => {
        setHelp((state) =>
          state?.id === assignment.id
            ? {
                ...state,
                loading: false,
                phases: [...state.phases, { phase: "done", at: Date.now() }].slice(-10),
                current: { ...state.current, ...patch, context },
              }
            : state,
        );
      };
      if (result.refused) {
        // La phrase du pont fait foi (le motif libre du modèle ne franchit jamais
        // la frontière) ; le repli est générique, jamais « pas assez de matière ».
        finish({
          refusal: homeworkRefusalText(result.message),
          actions: parseHomeworkActions(result.actions),
        });
      } else if (!result.ok) {
        finish({ error: result.message || "L'assistant n'a pas répondu." });
      } else {
        const answer = parseHomeworkAnswer(result);
        finish({
          answer: answer?.answer ?? null,
          steps: answer?.steps ?? [],
          sources: answer?.sources ?? [],
          error: answer ? null : "Réponse vide.",
        });
      }
    } catch (e) {
      if (seq !== helpSeq.current) return;
      setHelp((state) =>
        state?.id === assignment.id
          ? {
              ...state,
              loading: false,
              current: {
                ...state.current,
                error: e instanceof Error ? e.message : "Aide devoirs indisponible.",
              },
            }
          : state,
      );
    } finally {
      // Le vol se règle toujours, même si la fenêtre a été fermée entre-temps
      // ou si le pont a rejeté : jamais de blocage définitif.
      setHelpFlights((count) => Math.max(0, count - 1));
    }
  }

  async function askPhoto(assignment: Assignment, source: "camera" | "gallery") {
    if (assistantBusy) return;
    const seq = ++helpSeq.current;
    const turn = emptyTurn("");
    setHelpFlights((count) => count + 1);
    setHelp({
      id: assignment.id,
      photo: true,
      photoSource: source,
      loading: true,
      allowUnsourced: false,
      phases: [{ phase: "prepare", at: Date.now() }],
      turns: [],
      current: turn,
    });

    const onProgress = (progress: BridgeProgress) => {
      if (seq !== helpSeq.current) return;
      setHelp((state) =>
        state?.id === assignment.id
          ? { ...state, phases: [...state.phases, { ...progress, at: Date.now() }].slice(-10) }
          : state,
      );
    };

    try {
      const result = await bridge.solveHomeworkPhoto(assignment.id, week, source, onProgress);
      if (seq !== helpSeq.current) return;
      if (result.cancelled) {
        setHelp(null);
        return;
      }
      const context = parseAiContext(result.context);
      const finish = (patch: Partial<HomeworkTurn>) => {
        setHelp((state) =>
          state?.id === assignment.id
            ? {
                ...state,
                loading: false,
                photoCount: result.photos ?? state.photoCount,
                phases: [...state.phases, { phase: "done", at: Date.now() }].slice(-10),
                current: { ...state.current, ...patch, context },
              }
            : state,
        );
      };
      if (result.refused) {
        finish({
          refusal: homeworkRefusalText(result.message),
          actions: parseHomeworkActions(result.actions),
        });
      } else if (!result.ok) {
        finish({ error: result.message || "L'assistant n'a pas répondu." });
      } else {
        const answer = parseHomeworkAnswer(result);
        finish({
          answer: answer?.answer ?? null,
          steps: answer?.steps ?? [],
          sources: answer?.sources ?? [],
          error: answer ? null : "Réponse vide.",
        });
      }
    } catch (e) {
      if (seq !== helpSeq.current) return;
      setHelp((state) =>
        state?.id === assignment.id
          ? {
              ...state,
              loading: false,
              current: {
                ...state.current,
                error: e instanceof Error ? e.message : "Aide photo indisponible.",
              },
            }
          : state,
      );
    } finally {
      setHelpFlights((count) => Math.max(0, count - 1));
    }
  }

  function sendFollowUp(question: string) {
    if (!help) return;
    const assignment = items.find((item) => item.id === help.id);
    if (!assignment) return;
    void askHelp(assignment, help.allowUnsourced, question);
  }

  function proceedAnyway() {
    if (!help) return;
    const assignment = items.find((item) => item.id === help.id);
    if (!assignment) return;
    void askHelp(assignment, true, help.current.question || undefined, true);
  }

  function retryHelp() {
    if (!help) return;
    const assignment = items.find((item) => item.id === help.id);
    if (!assignment) return;
    if (help.photo && !help.current.question && help.photoSource) {
      void askPhoto(assignment, help.photoSource);
      return;
    }
    void askHelp(assignment, help.allowUnsourced, help.current.question || undefined, true);
  }

  /** Rouvrir relit le fil gardé ; sinon seulement on paie une première réponse. */
  function openHelp(assignment: Assignment) {
    const kept = threadsRef.current.get(assignment.id);
    if (kept) {
      setHelp({ ...kept, loading: false });
      return;
    }
    void askHelp(assignment);
  }

  /** Fermer ignore la demande en vol : une réponse tardive ne rouvre pas le
   *  panneau. Le pont n'a pas d'annulation LLM : on ignore la réponse. */
  function closeHelp() {
    helpSeq.current += 1;
    const kept = storedThread(help);
    if (kept) threadsRef.current.set(kept.id, kept);
    setHelp(null);
  }

  /** Le choix de la source vit HORS des cartes : un seul dialogue pour la
   *  semaine ; annuler ne touche ni au panneau ni à la demande en vol. */
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
      // La semaine AFFICHÉE, comme l'aide devoirs : le devoir peut venir d'une
      // autre semaine et le cache ne garde pas toutes les fenêtres.
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

  const helpAssignment = help ? items.find((item) => item.id === help.id) : undefined;

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
      {resource.stale ? (
        <div className="tasks-status" role="status">
          <StaleBadge />
          <span className="tiny muted">
            {week === currentWeek ? "Semaine en cours" : "Semaine sélectionnée"}
          </span>
        </div>
      ) : null}

      {resource.error ? <ErrorBox message={resource.error} /> : null}

      <SearchField
        value={search}
        onChange={setSearch}
        placeholder="Rechercher un devoir, une matière"
        label="Rechercher un devoir ou une matière"
      />

      {progress.total > 0 ? (
        <div className="tasks-summary" role="status">
          <span
            className="tasks-summary__ring"
            aria-hidden="true"
            style={{ "--task-progress": `${progress.percent * 3.6}deg` } as CSSProperties}
          >
            {progress.remaining === 0 ? <IconCheck size={16} /> : null}
          </span>
          <span className="tasks-summary__text">
            {progress.remaining === 0
              ? "Toutes les tâches sont terminées !"
              : `${progress.remaining} tâche${progress.remaining > 1 ? "s" : ""} restante${
                  progress.remaining > 1 ? "s" : ""
                } cette semaine`}
          </span>
        </div>
      ) : null}

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
        searching ? (
          <EmptyState
            icon={<IconCheck size={30} />}
            title="Aucun devoir trouvé"
            body={`Aucun résultat pour « ${search.trim()} » cette semaine.`}
            action={
              <button type="button" className="btn btn--small" onClick={() => setSearch("")}>
                Effacer la recherche
              </button>
            }
          />
        ) : (
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
        )
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
                      onHelp={() => openHelp(assignment)}
                      onOpenPhotoChooser={() => setPhotoChooser(assignment)}
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

      <Dialog
        open={photoChooser !== null}
        title="Photos de l’énoncé"
        description="Jusqu’à 3 photos depuis la galerie, ou une avec l’appareil photo. Elles partent directement au fournisseur, avec ta clé, et sont supprimées après lecture."
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
              <span>Choisir des images</span>
            </button>
          </div>
        ) : null}
      </Dialog>

      {help && helpAssignment ? (
        <HomeworkChat
          assignment={helpAssignment}
          state={help}
          manualReady={manualSubjects.includes(helpAssignment.subject)}
          lessonReady={lessonSubjects.includes(helpAssignment.subject)}
          onClose={closeHelp}
          onSend={sendFollowUp}
          onProceed={proceedAnyway}
          onRetry={retryHelp}
          onAddCourse={() => navigate("/course-notes")}
          onEnableManual={() => navigate("/settings")}
          onOpenAttachment={(attachment) => void openAttachment(helpAssignment, attachment)}
        />
      ) : null}
    </Page>
  );
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
  onOpenPhotoChooser,
  onCloseHelp,
  onGenerateSheet,
}: {
  assignment: Assignment;
  busy: boolean;
  assistantDisabled: boolean;
  assistantReasonId?: string;
  manualReady: boolean;
  lessonReady: boolean;
  help: HomeworkChatState | null;
  revisionBusy: boolean;
  assistantBusy: boolean;
  onToggle: (next: boolean) => void;
  onOpenAttachment: (attachment: AssignmentAttachment) => void;
  onHelp: () => void;
  onOpenPhotoChooser: () => void;
  onCloseHelp: () => void;
  onGenerateSheet: () => void;
}) {
  const { dark } = useApp();
  const noMaterialId = useId();
  const text = assignmentCardText(assignment);
  const subjectBase = subjectColor(assignment.subject);
  const tinted = tint(subjectBase, dark ? 0.3 : -0.3);
  const due = relativeLongFr(assignment.dueDate, Date.now());
  // Sans consigne ni cours, l'aide TEXTE refuserait avant le modèle. La photo
  // reste disponible : c'est une source à part entière.
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

  return (
    <Card
      as="article"
      className={`task-card${assignment.done ? " task-card--done" : ""}`}
      style={{ "--task-tint": tinted } as CSSProperties}
    >
      <div className="task-card__subject-row">
        <span className="task-card__emoji" aria-hidden="true">
          {subjectEmoji(assignment.subject)}
        </span>
        <span className="task-card__subject" style={{ color: tinted }}>
          {subjectDisplayFr(assignment.subject)}
          {assignment.attachments.length > 0 ? <IconAttach size={18} /> : null}
        </span>
        {due ? <span className="task-card__due">{due}</span> : null}
      </div>

      <div className="task-card__content">
        {text.title ? <p className="task-card__title">{text.title}</p> : null}
        {text.body ? <p className="task-card__body">{text.body}</p> : null}
      </div>

      {assignment.lessonContent ? (
        <p className="chip task-card__lesson">Cours : {assignment.lessonContent.title}</p>
      ) : null}

      {assignment.attachments.length > 0 ? (
        <div className="task-card__attachments">
          {assignment.attachments.map((attachment) => (
            <button
              key={attachment.id}
              type="button"
              className="task-card__attachment"
              aria-label={`Ouvrir la pièce jointe ${attachment.label}`}
              onClick={() => onOpenAttachment(attachment)}
            >
              <IconAttach size={18} />
              <span>{attachment.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="task-card__foot">
        <div className="task-card__actions">
          <button
            type="button"
            className="task-help"
            disabled={sheetOff}
            aria-describedby={offReason}
            aria-label={`Créer une fiche de révision pour ${assignment.title}`}
            onClick={onGenerateSheet}
          >
            <IconBook size={22} />
            {revisionBusy ? "Création…" : "Fiche"}
          </button>
          <button
            type="button"
            className={`task-help${help && !help.photo ? " task-help--open" : ""}`}
            disabled={textOff}
            aria-describedby={offReason}
            aria-expanded={help !== null && !help.photo}
            aria-label={`${help && !help.photo ? "Fermer" : "Ouvrir"} l'aide devoirs pour ${assignment.title}`}
            onClick={help && !help.photo ? onCloseHelp : onHelp}
          >
            <IconSparkles size={22} />
            {help && !help.photo ? "Fermer" : "Aide"}
          </button>
          <button
            type="button"
            className={`task-help task-help--photo${help?.photo ? " task-help--open" : ""}`}
            disabled={photoOff}
            aria-describedby={assistantDisabled ? assistantReasonId : undefined}
            aria-expanded={help?.photo === true}
            aria-haspopup="dialog"
            aria-label={`${help?.photo ? "Fermer" : "Ouvrir"} la photo de l’énoncé pour ${assignment.title}`}
            onClick={help?.photo ? onCloseHelp : onOpenPhotoChooser}
          >
            <IconCamera size={22} />
            {help?.photo ? "Fermer" : "Photo"}
          </button>
        </div>
        <button
          type="button"
          aria-pressed={assignment.done}
          aria-label={`${assignment.done ? "Marquer à faire" : "Marquer fait"} : ${assignment.title}`}
          className={`task-check${assignment.done ? " task-check--done" : ""}`}
          disabled={busy}
          onClick={() => onToggle(!assignment.done)}
        >
          <IconCheck size={24} />
          {assignment.done ? <span>Terminé</span> : null}
        </button>
      </div>

      {assistantDisabled || hasMaterial ? null : (
        <p id={noMaterialId} className="tiny muted task-card__hint">
          Sans cours ni manuel, l’aide peut procéder quand même : la réponse sera alors non sourcée.
          Les photos de l’énoncé restent la source la plus fiable.
        </p>
      )}

    </Card>
  );
}
