import { useEffect, useMemo, useRef, useState } from "react";
import { bridge } from "../../bridge/client";
import { BridgeCallError, type TeacherMessage, type TeacherMode } from "../../bridge/types";
import { useApp } from "../../ui/AppContext";
import { Dialog } from "../../ui/Dialog";
import { IconTrash } from "../../ui/icons";
import { useViewNavigate } from "../../ui/viewTransition";
import {
  appendTeacherAnswer,
  buildTeacherTurn,
  classifyTeacherFailure,
  parseTeacherThread,
  parseTeacherTurnResult,
  rejectTeacherAnswer,
  studentMessage,
  teacherMessage,
  teacherThreadPayload,
  teacherWriteQueue,
  trimTeacherMessages,
  type TeacherTurnError,
} from "./teacher";
import { TeacherView } from "./TeacherScreen";
import { ExercisesRoute } from "./ExercisesRoute";
import "./teacher.css";

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof BridgeCallError) {
    if (error.code === "auth_required") return "Session expirée : rescane le QR de l’établissement.";
    if (error.code === "unavailable") return "Téléphone injoignable : réessaie dans un instant.";
    if (error.message.trim() !== "") return error.message;
  }
  return fallback;
}

/** État, pont et persistance ; le rendu vit dans [TeacherView]. */
export function TeacherRoute() {
  const { notify } = useApp();
  const navigate = useViewNavigate();
  const [subjects, setSubjects] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [mode, setMode] = useState<TeacherMode>("explain");
  const [tab, setTab] = useState<"chat" | "exercises">("chat");
  const [messages, setMessages] = useState<TeacherMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<TeacherTurnError | null>(null);
  const [refusal, setRefusal] = useState<{ message: string; actions: string[] } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [threadLoaded, setThreadLoaded] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const [reload, setReload] = useState(0);
  const [confirmAction, setConfirmAction] = useState<null | "delete" | "new">(null);
  const [deleting, setDeleting] = useState(false);
  const seq = useRef(0);
  // Toutes les écritures du fil passent par cette file : un enregistrement ne
  // peut pas doubler la suppression qui le suit (le fil ressusciterait).
  const writes = useMemo(() => teacherWriteQueue(), []);
  // Le fil courant, lisible après un `await` : `messages` capturé par l'envoi
  // peut avoir changé (rejet pendant le vol).
  const messagesRef = useRef<TeacherMessage[]>([]);

  function applyMessages(next: TeacherMessage[]): void {
    messagesRef.current = next;
    setMessages(next);
  }

  useEffect(() => {
    let alive = true;
    setThreadLoaded(false);
    setLoadError("");
    void Promise.all([bridge.teacherThread(), bridge.lessons()])
      .then(([rawThread, lessons]) => {
        if (!alive) return;
        const thread = parseTeacherThread(rawThread);
        const known = (lessons?.subjects ?? [])
          .map((item) => item.subject)
          .filter((item): item is string => typeof item === "string" && item.trim() !== "");
        const unique = [...new Set(known)].sort((a, b) => a.localeCompare(b, "fr"));
        setSubjects(unique);
        applyMessages(thread.messages);
        setSubject((current) => {
          if (current) return current;
          if (thread.subject) return thread.subject;
          return unique.length === 1 ? unique[0]! : "";
        });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setLoadError(messageOf(e, "Discussion locale illisible : recharge."));
      })
      .finally(() => {
        if (alive) setThreadLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [reload]);

  function persist(nextSubject: string, nextMessages: TeacherMessage[]): void {
    if (!nextSubject) return;
    // L'écriture attend les précédentes : un enregistrement tardif ne réécrit
    // pas un fil que l'élève vient de supprimer.
    void writes(() => bridge.saveTeacherThread(teacherThreadPayload(nextSubject, nextMessages))).catch((e: unknown) => {
      notify(messageOf(e, "Discussion non enregistrée : elle reste à l’écran."), "error");
    });
  }

  async function sendCurrent(
    question: string,
    history: TeacherMessage[],
    proceedAnyway = false,
  ): Promise<void> {
    const student = studentMessage(question);
    const params = buildTeacherTurn(subject, question, mode, history, proceedAnyway);
    if (!student || !params) return;
    const next = trimTeacherMessages([...history, student]);
    applyMessages(next);
    setDraft("");
    setLoading(true);
    setError(null);
    setRefusal(null);
    const id = ++seq.current;
    try {
      const raw = await bridge.teacherTurn(params);
      if (id !== seq.current) return;
      const result = parseTeacherTurnResult(raw);
      if (result.refused) {
        setRefusal({
          message: result.message || "Aucune source exploitable pour cette matière.",
          actions: result.actions ?? [],
        });
        persist(subject, messagesRef.current);
        return;
      }
      if (!result.ok) {
        setError(classifyTeacherFailure(result));
        // La question reste affichée : « Réessayer » renvoie la MÊME demande.
        persist(subject, messagesRef.current);
        return;
      }
      const answer = teacherMessage(result);
      if (!answer) {
        setError({ kind: "empty", message: "Le professeur n’a pas répondu : réessaie." });
        persist(subject, messagesRef.current);
        return;
      }
      // La réponse rejoint le fil COURANT, pas l'instantané d'avant le vol :
      // un tour rejeté entre-temps ne ressuscite ni à l'écran ni sur le disque.
      const withAnswer = appendTeacherAnswer(messagesRef.current, answer);
      applyMessages(withAnswer);
      setFocusTick((value) => value + 1);
      persist(subject, withAnswer);
    } catch (e) {
      if (id !== seq.current) return;
      setError({
        kind: "unavailable",
        message: messageOf(e, "Le professeur est indisponible : réessaie dans un instant."),
      });
      persist(subject, messagesRef.current);
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }

  function send(): void {
    const question = draft.trim();
    if (!subject || !question || loading) return;
    void sendCurrent(question, messages);
  }

  function ask(question: string): void {
    const trimmed = question.trim();
    if (!subject || !trimmed || loading) return;
    void sendCurrent(trimmed, messagesRef.current);
  }

  function retry(proceedAnyway = false): void {
    if (loading) return;
    const current = messagesRef.current;
    const last = current[current.length - 1];
    const pending = last?.role === "student" ? last : null;
    if (!pending) {
      setError(null);
      return;
    }
    // L'historique s'arrête AVANT la question en attente : elle est le tour.
    const history = current.slice(0, -1);
    void sendCurrent(pending.text, history, proceedAnyway);
  }

  function reject(index: number): void {
    const next = rejectTeacherAnswer(messagesRef.current, index);
    applyMessages(next);
    setFocusTick(0);
    persist(subject, next);
  }

  function changeSubject(next: string): void {
    if (next === subject) return;
    seq.current += 1;
    setSubject(next);
    applyMessages([]);
    setDraft("");
    setLoading(false);
    setError(null);
    setRefusal(null);
    setFocusTick(0);
    // Changer de matière démarre une NOUVELLE discussion : l'ancienne est
    // supprimée du stockage local pour ne pas rejouer un contexte étranger.
    // La file garantit que cette suppression passe APRÈS les enregistrements
    // déjà demandés.
    void writes(() => bridge.deleteTeacherThread()).catch(() => {});
  }

  async function clearThread(): Promise<void> {
    const startingNew = confirmAction === "new";
    setDeleting(true);
    seq.current += 1;
    try {
      // Suppression en file : elle attend les enregistrements en cours, donc
      // aucun d'eux ne peut la doubler et ressusciter le fil.
      const result = await writes(() => bridge.deleteTeacherThread());
      if (!result.ok) throw new Error(result.message || "Suppression impossible.");
      applyMessages([]);
      setDraft("");
      setError(null);
      setRefusal(null);
      setFocusTick(0);
      setConfirmAction(null);
      notify(startingNew ? "Nouvelle discussion prête." : "Discussion supprimée.");
    } catch (e) {
      notify(messageOf(e, "Suppression impossible : réessaie."), "error");
    } finally {
      setDeleting(false);
    }
  }

  function action(name: string): void {
    switch (name) {
      case "add_course":
        navigate("/course-notes");
        break;
      case "enable_manual":
        navigate("/course-notes");
        break;
      case "open_attachment":
        navigate("/tasks");
        break;
      case "proceed_anyway":
        retry(true);
        break;
      default:
        retry();
        break;
    }
  }

  return (
    <>
      <TeacherView
        subjects={subjects}
        subject={subject}
        mode={mode}
        messages={messages}
        draft={draft}
        loading={loading}
        error={error}
        loadError={loadError}
        onReload={() => setReload((value) => value + 1)}
        refusal={refusal}
        focusTick={focusTick}
        tab={tab}
        onTabChange={setTab}
        exercisesPanel={
          <ExercisesRoute subjects={subjects} subject={subject} onSubjectChange={changeSubject} embedded />
        }
        busy={loading || deleting}
        threadLoaded={threadLoaded}
        onSubjectChange={changeSubject}
        onModeChange={setMode}
        onDraftChange={setDraft}
        onSend={send}
        onAsk={ask}
        onRetry={retry}
        onReject={reject}
        onNewDiscussion={() => setConfirmAction("new")}
        onDelete={() => setConfirmAction("delete")}
        onAction={action}
      />
      <Dialog
        open={confirmAction !== null}
        title={
          confirmAction === "new" ? "Démarrer une nouvelle discussion ?" : "Supprimer la discussion ?"
        }
        description={
          confirmAction === "new"
            ? "Le fil actuel sera effacé de cet appareil et la discussion repartira de la matière choisie. Aucun envoi ne sera fait."
            : "Le fil local du professeur sera effacé de cet appareil. Aucun envoi ne sera fait."
        }
        icon={<IconTrash size={20} />}
        busy={deleting}
        actions={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setConfirmAction(null)}
              disabled={deleting}
            >
              Annuler
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => void clearThread()}
              disabled={deleting}
            >
              {confirmAction === "new" ? "Recommencer" : "Supprimer"}
            </button>
          </>
        }
        onClose={() => setConfirmAction(null)}
      />
    </>
  );
}
