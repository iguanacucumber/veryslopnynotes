import { useState } from "react";
import { bridge } from "../../bridge/client";
import { useApp } from "../../ui/AppContext";
import { Dialog } from "../../ui/Dialog";
import { ListRow, Rows } from "../../ui/components";
import { IconTrash } from "../../ui/icons";
import { useViewNavigate } from "../../ui/viewTransition";
import { actionMessage } from "./action";
import { DELETE_ALL_ARTIFACTS, failedArtifactLabels } from "./deleteAll";
import { ExportBeforePurge, useExportBeforePurge } from "./ExportBeforePurge";

/**
 * « Supprimer toutes mes données » : la confirmation liste l'inventaire
 * complet, puis le natif exécute la purge orchestrée. Un échec partiel reste
 * affiché avec les éléments concernés, jamais un succès mensonger.
 */
export function DeleteAllCard() {
  const { refresh, notify, closeSession } = useApp();
  const navigate = useViewNavigate();
  const exportState = useExportBeforePurge();
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);
  const [error, setError] = useState("");

  async function removeAll(): Promise<void> {
    if (exportState.exporting) return;
    setBusy(true);
    setFailed([]);
    setError("");
    try {
      const result = await bridge.deleteAllData();
      if (!result.ok) {
        setFailed(result.failed);
        setError("Suppression incomplète : certains éléments n’ont pas pu être effacés.");
        return;
      }
      closeSession();
      refresh();
      setAsk(false);
      notify("Données du compte et de l’assistant supprimées ; les réglages d’interface restent.");
      navigate("/pairing", { replace: true });
    } catch (cause) {
      setError(actionMessage(cause, "Suppression impossible : réessaie dans un instant."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Rows>
        <ListRow
          danger
          title="Supprimer toutes mes données"
          subtitle="Session, caches, fichiers, photos, clé et serveur"
          leading={<IconTrash size={22} />}
          onClick={() => {
            setFailed([]);
            setError("");
            exportState.reset();
            setAsk(true);
          }}
        />
      </Rows>

      <Dialog
        open={ask}
        title="Supprimer toutes mes données ?"
        role="alertdialog"
        description="Cette action est irréversible. Les éléments suivants seront effacés de cet appareil :"
        icon={<IconTrash size={20} />}
        busy={busy}
        onClose={() => setAsk(false)}
        actions={
          <>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              data-autofocus
              disabled={busy}
              onClick={() => setAsk(false)}
            >
              Annuler
            </button>
            <button
              type="button"
              className="btn btn--danger btn--small"
              disabled={busy || exportState.exporting}
              onClick={() => void removeAll()}
            >
              {busy ? "Suppression…" : "Tout supprimer"}
            </button>
          </>
        }
      >
        <ExportBeforePurge state={exportState} disabled={busy} />
        <ul className="delete-all__artifacts">
          {DELETE_ALL_ARTIFACTS.map((artifact) => (
            <li key={artifact.id}>
              <strong>{artifact.label}</strong>
              <span className="tiny muted">{artifact.detail}</span>
            </li>
          ))}
        </ul>
        <p className="tiny muted">
          Les réglages d’interface (thème, schéma, rappel du manuel) restent sur cet appareil après
          cette suppression.
        </p>
        {error ? (
          <p className="delete-all__error tiny" role="alert">
            {error}
          </p>
        ) : null}
        {failed.length > 0 ? (
          <ul className="delete-all__failed tiny">
            {failedArtifactLabels(failed).map((label, index) => (
              <li key={`${label}-${index}`}>{label}</li>
            ))}
          </ul>
        ) : null}
      </Dialog>
    </>
  );
}
