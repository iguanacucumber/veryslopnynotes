import { useState } from "react";
import { bridge } from "../../bridge/client";
import { loadNewsReadIds } from "../news/readState";
import { actionMessage } from "./action";

/**
 * Offre d'export placée AVANT une purge : notes, fiches de révision et fil du
 * professeur disparaissent définitivement ensuite. L'utilisateur reste libre
 * de continuer sans exporter, mais la purge ne peut pas partir pendant que le
 * fichier se prépare.
 */
export function useExportBeforePurge() {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function exportNow(): Promise<void> {
    setError("");
    setExporting(true);
    try {
      const response = await bridge.exportData([...loadNewsReadIds()]);
      if (!response.ok) {
        setError(response.message || "Export impossible : réessaie dans un instant.");
        return;
      }
      setDone(true);
    } catch (caught) {
      setError(actionMessage(caught, "Export impossible : réessaie dans un instant."));
    } finally {
      setExporting(false);
    }
  }

  function reset(): void {
    setExporting(false);
    setError("");
    setDone(false);
  }

  return { exporting, error, done, exportNow, reset };
}

export type PurgeExportState = ReturnType<typeof useExportBeforePurge>;

export function ExportBeforePurge({
  state,
  disabled = false,
}: {
  state: PurgeExportState;
  disabled?: boolean;
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <p className="tiny" style={{ margin: 0 }}>
        <strong>Exporte avant de continuer.</strong> Tes notes et ton cahier de cours, tes fiches
        de révision et la discussion avec le professeur seront définitivement supprimés. Sans
        export, ces données sont perdues.
      </p>
      {state.done ? (
        <p className="tiny" role="status" style={{ margin: "6px 0 0", color: "var(--muted)" }}>
          Export prêt : choisis où l’envoyer.
        </p>
      ) : null}
      {state.error ? (
        <p className="tiny" role="alert" style={{ margin: "6px 0 0", color: "var(--danger-ink)" }}>
          {state.error}
        </p>
      ) : null}
      <button
        type="button"
        className="btn btn--ghost btn--small"
        disabled={disabled || state.exporting}
        onClick={() => void state.exportNow()}
        style={{ marginTop: 8 }}
      >
        {state.exporting ? "Préparation…" : state.done ? "Exporter à nouveau" : "Exporter mes données"}
      </button>
    </div>
  );
}
