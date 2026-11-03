import { useState } from "react";
import { bridge } from "../../bridge/client";
import { loadNewsReadIds } from "../news/readState";
import { useApp } from "../../ui/AppContext";
import { Card } from "../../ui/components";
import { actionMessage } from "./action";

/**
 * Export local : le natif prépare un JSON et ouvre le partage Android.
 * L'interface ne reçoit ni chemin ni contenu — seulement les compteurs du
 * manifeste et la liste des familles volontairement absentes.
 */
export function DataExportCard() {
  const { notify } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function exportData(): Promise<void> {
    setError("");
    setBusy(true);
    try {
      const response = await bridge.exportData([...loadNewsReadIds()]);
      if (!response.ok) {
        setError(response.message || "Export impossible : réessaie dans un instant.");
        return;
      }
      const total = (response.sections ?? []).reduce((sum, section) => sum + section.count, 0);
      notify(
        total > 0
          ? `Export prêt (${total} élément${total > 1 ? "s" : ""}) : choisis où l’envoyer.`
          : "Export prêt : choisis où l’envoyer.",
      );
    } catch (caught) {
      setError(actionMessage(caught, "Export impossible : réessaie dans un instant."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="card--flat">
      <strong style={{ display: "block" }}>Exporter mes données</strong>
      <p className="tiny muted" style={{ margin: "2px 0 0" }}>
        Un fichier JSON avec tes notes, ton cahier de cours, tes fiches de révision, la discussion
        du professeur, le manuel mémorisé, tes préférences de matières et l’état de lecture des
        actualités.
      </p>
      <p className="tiny muted" style={{ margin: "6px 0 0" }}>
        Le partage passe par Android ; l’application n’envoie rien au réseau. Le jeton de session,
        la clé de l’assistant, l’adresse du serveur et l’adresse du manuel ne sont jamais inclus.
      </p>
      {error ? (
        <p className="tiny" role="alert" style={{ color: "var(--danger-ink)", margin: "6px 0 0" }}>
          {error}
        </p>
      ) : null}
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
        <button
          type="button"
          className="btn btn--small"
          disabled={busy}
          onClick={() => void exportData()}
        >
          {busy ? "Préparation…" : "Exporter mes données"}
        </button>
      </div>
    </Card>
  );
}
