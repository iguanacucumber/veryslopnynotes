import { useState } from "react";
import { bridge } from "../../bridge/client";
import type { DiagnosticValue } from "../../bridge/types";
import { useApp } from "../../ui/AppContext";
import { Card } from "../../ui/components";
import { Dialog } from "../../ui/Dialog";
import { actionMessage } from "./action";

const FIELD_LABELS: Record<string, string> = {
  format: "Format du fichier",
  schemaVersion: "Version du format",
  generatedAt: "Généré le",
  appVersion: "Version de l’application",
  androidVersion: "Version Android",
  androidApi: "Niveau d’API Android",
  webViewVersion: "Version de la WebView",
  errorCode: "Dernier code d’erreur",
  resource: "Ressource concernée",
  classLevel: "Niveau de classe",
  authState: "État de la session",
  withheld: "Volontairement exclus",
};

const FIELD_ORDER = Object.keys(FIELD_LABELS);

function orderedFields(fields: Record<string, DiagnosticValue>): [string, DiagnosticValue][] {
  return Object.entries(fields).sort(([a], [b]) => {
    const ia = FIELD_ORDER.indexOf(a);
    const ib = FIELD_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

function showValue(value: DiagnosticValue): string {
  return Array.isArray(value) ? value.join(", ") : String(value);
}

/** Le même aperçu sert au diagnostic des Réglages et au signalement IA. */
export function DiagnosticFieldList({
  fields,
}: {
  fields: Record<string, DiagnosticValue>;
}) {
  return (
    <dl className="diagnostic-fields">
      {orderedFields(fields).map(([key, value]) => (
        <div className="diagnostic-field" key={key}>
          <dt>{FIELD_LABELS[key] ?? key}</dt>
          <dd>{showValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Diagnostic de support : un aperçu figé, puis le sélecteur Android.
 * Aucun envoi automatique ; l'aperçu affiché EST le fichier partagé.
 */
export function DiagnosticExportCard() {
  const { notify } = useApp();
  const [fields, setFields] = useState<Record<string, DiagnosticValue> | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"preview" | "share" | null>(null);
  const [error, setError] = useState("");

  async function prepare(): Promise<void> {
    setError("");
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
      notify("Diagnostic prêt : choisis où l’envoyer.");
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
    <>
      <Card className="card--flat">
        <strong style={{ display: "block" }}>Exporter un diagnostic</strong>
        <p className="tiny muted" style={{ margin: "2px 0 0" }}>
          Un petit fichier pour le support : version de l’app, Android, WebView, dernier code
          d’erreur, ressource concernée, niveau de classe et état de la session.
        </p>
        <p className="tiny muted" style={{ margin: "6px 0 0" }}>
          Les champs exacts sont affichés avant le partage. Aucun nom, aucune adresse, aucun jeton,
          aucune note, aucun message et aucun journal n’y figure. Rien n’est envoyé automatiquement :
          Android ouvre le sélecteur et tu choisis la destination.
        </p>
        {error && !open ? (
          <p className="tiny" role="alert" style={{ color: "var(--danger-ink)", margin: "6px 0 0" }}>
            {error}
          </p>
        ) : null}
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
          <button
            type="button"
            className="btn btn--small"
            disabled={busy !== null}
            onClick={() => void prepare()}
          >
            {busy === "preview" ? "Préparation…" : "Préparer le diagnostic"}
          </button>
        </div>
      </Card>

      <Dialog
        open={open && fields !== null}
        title="Partager ce diagnostic ?"
        description="Voici exactement les champs du fichier. Rien n’est envoyé tant que tu ne choisis pas une application dans le sélecteur Android."
        busy={busy === "share"}
        onClose={close}
        actions={
          <>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              data-autofocus
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
          </>
        }
      >
        {fields ? <DiagnosticFieldList fields={fields} /> : null}
        <p className="tiny muted">
          Aucun envoi réseau, aucun stockage hors de l’appareil : le fichier vit dans le cache,
          purgé avec le compte.
        </p>
        {error ? (
          <p className="diagnostic-field__error tiny" role="alert">
            {error}
          </p>
        ) : null}
      </Dialog>
    </>
  );
}
