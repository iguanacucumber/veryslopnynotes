import { useEffect, useRef, useState } from "react";
import { bridge } from "../../bridge/client";
import { BridgeCallError, type ExerciseHelpMode, type ExerciseItem } from "../../bridge/types";
import { useViewNavigate } from "../../ui/viewTransition";
import {
  classifyExerciseFailure,
  parseExerciseHelp,
  parseExerciseProposal,
} from "./exercises";
import { ExercisesView, helpAnswerApplies, type ExerciseHelpState, type ExerciseProposalState } from "./ExercisesScreen";
import { teacherMessage, type TeacherTurnError } from "./teacher";

const EMPTY_PROPOSAL: ExerciseProposalState = { loading: false, error: "", data: null };
const EMPTY_HELP: ExerciseHelpState = {
  loading: false,
  mode: null,
  message: null,
  error: null,
  refusal: null,
  answer: "",
};

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof BridgeCallError) {
    if (error.code === "auth_required") return "Session expirée : rescane le QR de l’établissement.";
    if (error.code === "unavailable") return "Téléphone injoignable : réessaie dans un instant.";
    if (error.message.trim() !== "") return error.message;
  }
  return fallback;
}

/**
 * Onglet Exercices (#632) : l'état et le pont. Le rendu est dans
 * [ExercisesView], testable en rendu statique.
 *
 * Aucune aide n'est demandée sans exercice choisi ; la correction complète est
 * réservée à un clic explicite (ou à une photo de réponse, qui EST une demande
 * de correction).
 */
export function ExercisesRoute({
  subjects,
  subject,
  onSubjectChange,
  embedded = false,
}: {
  subjects: string[];
  subject: string;
  onSubjectChange: (subject: string) => void;
  embedded?: boolean;
}) {
  const navigate = useViewNavigate();
  const [hint, setHint] = useState("");
  const [proposal, setProposal] = useState<ExerciseProposalState>(EMPTY_PROPOSAL);
  const [selected, setSelected] = useState<ExerciseItem | null>(null);
  const [help, setHelp] = useState<ExerciseHelpState>(EMPTY_HELP);
  const seq = useRef(0);
  const lastRequest = useRef<{ mode: ExerciseHelpMode; photoSource?: "camera" | "gallery" } | null>(null);
  // La sélection courante, lisible après un `await` : le `selected` capturé
  // par la demande peut avoir changé entre-temps.
  const selectedRef = useRef<ExerciseItem | null>(null);

  function applySelected(exercise: ExerciseItem | null): void {
    selectedRef.current = exercise;
    setSelected(exercise);
  }

  useEffect(() => {
    seq.current += 1;
    setProposal(EMPTY_PROPOSAL);
    applySelected(null);
    setHelp(EMPTY_HELP);
    setHint("");
    lastRequest.current = null;
  }, [subject]);

  async function propose(): Promise<void> {
    if (!subject || proposal.loading) return;
    const id = ++seq.current;
    setProposal({ loading: true, error: "", data: null });
    applySelected(null);
    setHelp(EMPTY_HELP);
    try {
      const raw = await bridge.proposeExercises({ subject, hint: hint.trim() });
      if (id !== seq.current) return;
      const data = parseExerciseProposal(raw);
      if (!data.ok) {
        setProposal({ loading: false, error: data.message || "Proposition illisible : réessaie.", data: null });
        return;
      }
      setProposal({ loading: false, error: "", data });
      applySelected(data.exercises[0] ?? null);
    } catch (e) {
      if (id !== seq.current) return;
      setProposal({
        loading: false,
        error: messageOf(e, "Les exercices n’ont pas pu être lus : réessaie."),
        data: null,
      });
    }
  }

  function select(exercise: ExerciseItem): void {
    // Un clic sur un autre exercice INVALIDE l'aide en vol : sans bump de
    // séquence, sa réponse tardive s'afficherait sous le nouvel énoncé (fausse
    // correction, fausses sources) et « Réessayer » resterait mort.
    seq.current += 1;
    lastRequest.current = null;
    applySelected(exercise);
    setHelp(EMPTY_HELP);
  }

  async function ask(mode: ExerciseHelpMode, photoSource?: "camera" | "gallery"): Promise<void> {
    if (!selected || help.loading) return;
    const request = { seq: ++seq.current, number: selected.number };
    lastRequest.current = { mode, photoSource };
    setHelp((state) => ({ ...state, loading: true, mode, error: null, refusal: null }));
    try {
      const raw = await bridge.helpExercise({
        subject,
        number: selected.number,
        statement: selected.statement,
        mode,
        answer: help.answer.trim(),
        ...(photoSource ? { photoSource } : {}),
      });
      if (!helpAnswerApplies(request, { seq: seq.current, number: selectedRef.current?.number ?? null })) return;
      if (raw !== null && typeof raw === "object" && (raw as { cancelled?: unknown }).cancelled === true) {
        setHelp((state) => ({ ...state, loading: false, mode: null }));
        return;
      }
      const result = parseExerciseHelp(raw);
      if (result.refused) {
        setHelp((state) => ({
          ...state,
          loading: false,
          message: null,
          refusal: {
            message: result.message || "Aucune source pour cet exercice.",
            actions: result.actions ?? [],
          },
        }));
        return;
      }
      if (!result.ok) {
        setHelp((state) => ({ ...state, loading: false, message: null, error: classifyExerciseFailure(result) }));
        return;
      }
      const message = teacherMessage(result);
      if (!message) {
        setHelp((state) => ({
          ...state,
          loading: false,
          message: null,
          error: { kind: "empty", message: "Le professeur n’a pas répondu : réessaie." },
        }));
        return;
      }
      setHelp((state) => ({ ...state, loading: false, message, error: null, refusal: null }));
    } catch (e) {
      if (!helpAnswerApplies(request, { seq: seq.current, number: selectedRef.current?.number ?? null })) return;
      const error: TeacherTurnError = {
        kind: "unavailable",
        message: messageOf(e, "Le professeur est indisponible : réessaie dans un instant."),
      };
      setHelp((state) => ({ ...state, loading: false, message: null, error }));
    }
  }

  function retry(): void {
    const request = lastRequest.current;
    if (!request || selected === null) return;
    void ask(request.mode, request.photoSource);
  }

  function action(name: string): void {
    switch (name) {
      case "add_course":
        navigate("/course-notes");
        break;
      case "enable_manual":
        navigate("/settings");
        break;
      case "open_attachment":
        navigate("/tasks");
        break;
      default:
        break;
    }
  }

  return (
    <ExercisesView
      subjects={subjects}
      subject={subject}
      hint={hint}
      proposal={proposal}
      selected={selected}
      help={help}
      onSubjectChange={onSubjectChange}
      onHintChange={setHint}
      onPropose={() => void propose()}
      onSelect={select}
      onHelp={(mode) => void ask(mode)}
      onAnswerChange={(answer) => setHelp((state) => ({ ...state, answer }))}
      onPhoto={(source) => void ask("correction", source)}
      onRetry={retry}
      onAction={action}
      embedded={embedded}
    />
  );
}
