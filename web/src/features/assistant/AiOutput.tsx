import { useId, useState } from "react";
import { bridge } from "../../bridge/client";
import type { DiagnosticValue } from "../../bridge/types";
import { actionMessage } from "../settings/action";
import { DiagnosticFieldList } from "../settings/DiagnosticExportCard";

/** Étiquette visible et copiée de toute sortie écrite par un modèle. */
export const AI_OUTPUT_LABEL = "IA — à vérifier";

/** Ce que l'étiquette demande : relire avant de s'en servir. */
export const AI_OUTPUT_NOTE =
  "Sortie de modèle : relis-la et vérifie les faits et les sources avant de t’en servir.";

/** Ce que le diagnostic de signalement ne contient jamais. */
export const AI_REPORT_NOTE =
  "Le diagnostic ne contient ni ta question, ni la réponse, ni tes sources, ni un nom, une adresse ou un identifiant.";

/** Copier une réponse emporte son étiquette : le texte collé reste identifiable. */
export function withAiOutputLabel(text: string): string {
  return `${AI_OUTPUT_LABEL}\n\n${text}`;
}

/** Le libellé suffit : l'état n'est jamais porté par la seule couleur. */
export function AiOutputLabel({ className = "" }: { className?: string }) {
  return (
    <span className={`ai-output-label ${className}`.trim()} role="note">
      {AI_OUTPUT_LABEL}
    </span>
  );
}

/**
 * Signalement d'une sortie IA : même diagnostic borné que Réglages → Aide.
 * L'aperçu est affiché avant tout partage et le sélecteur Android reste le
 * seul envoi possible ; aucun appel réseau, aucune pièce jointe scolaire.
 */
export function AiReportButton({ className = "ai-action" }: { className?: string }) {
  const panelId = useId();
  const [fields, setFields] = useState<Record<string, DiagnosticValue> | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"preview" | "share" | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function prepare(): Promise<void> {
    setError("");
    setDone(false);
    setBusy("preview");
    try {
      const response = await bridge.previewDiagnostic();
      if (!response.ok || !response.fields) {
        setError(response.message || "Diagnostic indisponible : réessaie dans un instant.");
        return;
      }
      setFields(response.fields);
      setOpen(true);
    } catch (caught) {
      setError(actionMessage(caught, "Diagnostic indisponible : réessaie dans un instant."));
    } finally {
      setBusy(null);
    }
  }

  async function share(): Promise<void> {
    setError("");
    setBusy("share");
    try {
      const response = await bridge.shareDiagnostic();
      if (!response.ok) {
        setError(response.message || "Partage impossible : réessaie dans un instant.");
        return;
      }
      setOpen(false);
      setFields(null);
      setDone(true);
    } catch (caught) {
      setError(actionMessage(caught, "Partage impossible : réessaie dans un instant."));
    } finally {
      setBusy(null);
    }
  }

  function close(): void {
    if (busy === "share") return;
    setOpen(false);
    setFields(null);
    setError("");
  }

  return (
    <div className={open ? "ai-report ai-report--open" : "ai-report"}>
      <button
        type="button"
        className={className}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        disabled={busy !== null}
        onClick={() => (open ? close() : void prepare())}
      >
        {open ? "Fermer le signalement" : "Signaler"}
      </button>
      {error && !open ? (
        <span className="ai-report-error tiny" role="alert">
          {error}
        </span>
      ) : null}
      {done && !open ? (
        <span className="ai-report-done tiny muted" role="status">
          Diagnostic prêt : choisis où l’envoyer.
        </span>
      ) : null}
      {open && fields ? (
        <div className="ai-report__panel" id={panelId} role="group" aria-label="Signaler cette sortie IA">
          <p className="tiny muted">{AI_OUTPUT_NOTE}</p>
          <DiagnosticFieldList fields={fields} />
          <p className="tiny muted">{AI_REPORT_NOTE}</p>
          <p className="tiny muted">
            Rien n’est envoyé tant que tu ne choisis pas une application dans le sélecteur Android.
          </p>
          <div className="ai-report__actions">
            <button
              type="button"
              className="btn btn--ghost btn--small"
              disabled={busy === "share"}
              onClick={close}
            >
              Annuler
            </button>
            <button
              type="button"
              className="btn btn--small"
              disabled={busy === "share"}
              onClick={() => void share()}
            >
              {busy === "share" ? "Ouverture…" : "Ouvrir le partage"}
            </button>
          </div>
          {error ? (
            <p className="diagnostic-field__error tiny" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
