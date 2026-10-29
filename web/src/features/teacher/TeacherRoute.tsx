import { useEffect, useRef, useState } from "react";
import { bridge } from "../../bridge/client";
import { BridgeCallError, type TeacherMessage, type TeacherMode } from "../../bridge/types";
import { useApp } from "../../ui/AppContext";
import { Dialog } from "../../ui/Dialog";
import { IconTrash } from "../../ui/icons";
import { useViewNavigate } from "../../ui/viewTransition";
import {
  buildTeacherTurn,
  classifyTeacherFailure,
  parseTeacherThread,
  parseTeacherTurnResult,
  rejectTeacherAnswer,
  studentMessage,
  teacherMessage,
  teacherThreadPayload,
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

/**
 * Écran Prof (#633) : l'état, le pont et la persistance locale. Le rendu est
 * dans [TeacherView] (pur, testable en rendu statique).
 */
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const seq = useRef(0);

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
        setMessages(thread.messages);
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
    void bridge.saveTeacherThread(teacherThreadPayload(nextSubject, nextMessages)).catch((e: unknown) => {
      notify(messageOf(e, "Discussion non enregistrée : elle reste à l’écran."), "error");
    });
  }

  async function sendCurrent(question: string, history: TeacherMessage[]): Promise<void> {
    const student = studentMessage(question);
    const params = buildTeacherTurn(subject, question, mode, history);
    if (!student || !params) return;
    const next = trimTeacherMessages([...history, student]);
    setMessages(next);
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
        persist(subject, next);
        return;
      }
      if (!result.ok) {
        setError(classifyTeacherFailure(result));
        // La question reste affichée : « Réessayer » renvoie la MÊME demande.
        persist(subject, next);
        return;
      }
      const answer = teacherMessage(result);
      if (!answer) {
        setError({ kind: "empty", message: "Le professeur n’a pas répondu : réessaie." });
        persist(subject, next);
        return;
      }
      const withAnswer = trimTeacherMessages([...next, answer]);
      setMessages(withAnswer);
      setFocusTick((value) => value + 1);
      persist(subject, withAnswer);
    } catch (e) {
      if (id !== seq.current) return;
      setError({
        kind: "unavailable",
        message: messageOf(e, "Le professeur est indisponible : réessaie dans un instant."),
      });
      persist(subject, next);
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }

  function send(): void {
    const question = draft.trim();
    if (!subject || !question || loading) return;
    void sendCurrent(question, messages);
  }

  function retry(): void {
    if (loading) return;
    const last = messages[messages.length - 1];
    const pending = last?.role === "student" ? last : null;
    if (!pending) {
      setError(null);
      return;
    }
    // L'historique s'arrête AVANT la question en attente : elle est le tour.
    const history = messages.slice(0, -1);
    void sendCurrent(pending.text, history);
  }

  function reject(index: number): void {
    const next = rejectTeacherAnswer(messages, index);
    setMessages(next);
    setFocusTick(0);
    persist(subject, next);
  }

  function changeSubject(next: string): void {
    if (next === subject) return;
    seq.current += 1;
    setSubject(next);
    setMessages([]);
    setDraft("");
    setLoading(false);
    setError(null);
    setRefusal(null);
    setFocusTick(0);
    // Changer de matière démarre une NOUVELLE discussion : l'ancienne est
    // supprimée du stockage local pour ne pas rejouer un contexte étranger.
    void bridge.deleteTeacherThread().catch(() => {});
  }

  async function clearThread(): Promise<void> {
    setDeleting(true);
    seq.current += 1;
    try {
      const result = await bridge.deleteTeacherThread();
      if (!result.ok) throw new Error(result.message || "Suppression impossible.");
      setMessages([]);
      setDraft("");
      setError(null);
      setRefusal(null);
      setFocusTick(0);
      setConfirmDelete(false);
      notify("Discussion supprimée.");
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
        onRetry={retry}
        onReject={reject}
        onNewDiscussion={() => setConfirmDelete(true)}
        onDelete={() => setConfirmDelete(true)}
        onAction={action}
      />
      <Dialog
        open={confirmDelete}
        title="Supprimer la discussion ?"
        description="Le fil local du professeur sera effacé de cet appareil. Aucun envoi ne sera fait."
        icon={<IconTrash size={20} />}
        busy={deleting}
        actions={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              Annuler
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => void clearThread()}
              disabled={deleting}
            >
              Supprimer
            </button>
          </>
        }
        onClose={() => setConfirmDelete(false)}
      />
    </>
  );
}
