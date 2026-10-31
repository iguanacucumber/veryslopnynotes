import { useEffect, useState } from "react";
import { bridge } from "../../bridge/client";
import type { SettingsSnapshot } from "../../bridge/types";
import { STORAGE_UNAVAILABLE_MESSAGE } from "../../lib/session";
import { useApp } from "../../ui/AppContext";
import { Card } from "../../ui/components";
import { Dialog } from "../../ui/Dialog";
import { AssistantOverviewCard } from "./AssistantOverviewCard";
import { actionMessage } from "./action";
import { MAX_API_KEY_CHARS, llmSaveError } from "./model";

export function AssistantCards({ snapshot, loading }: { snapshot: SettingsSnapshot | null; loading: boolean }) {
  const { notify, storageUnavailable } = useApp();
  const [llmConfigured, setLlmConfigured] = useState(false);
  const [llmKey, setLlmKey] = useState("");
  const [keyVisible, setKeyVisible] = useState(false);
  const [llmError, setLlmError] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [forgetAsk, setForgetAsk] = useState(false);
  const [forgettingKey, setForgettingKey] = useState(false);

  useEffect(() => {
    if (snapshot) setLlmConfigured(snapshot.llmConfigured === true);
  }, [snapshot]);

  async function saveKey(): Promise<void> {
    const key = llmKey.trim();
    if (key === "") {
      setLlmError("Colle une clé avant d'enregistrer.");
      return;
    }
    setLlmError("");
    setSavingKey(true);
    try {
      const response = await bridge.saveLlmKey(key);
      const refusal = llmSaveError(response);
      if (refusal !== "") {
        setLlmError(refusal);
        return;
      }
      setLlmConfigured(true);
      setLlmKey("");
      setKeyVisible(false);
      notify("Clé de l'assistant enregistrée.");
    } catch (error) {
      // Jamais le message natif ici : il pourrait recopier la saisie.
      setLlmError(actionMessage(error, "Clé non enregistrée : réessaie dans un instant."));
    } finally {
      setSavingKey(false);
    }
  }

  async function forgetKey(): Promise<void> {
    // La suppression ne part que du dialogue de confirmation.
    setLlmError("");
    setForgettingKey(true);
    try {
      await bridge.forgetLlmKey();
      setLlmConfigured(false);
      notify("Clé de l'assistant oubliée.");
    } catch (error) {
      setLlmError(actionMessage(error, "Clé non supprimée : réessaie dans un instant."));
    } finally {
      setForgettingKey(false);
      setForgetAsk(false);
    }
  }

  return (
    <>
      <AssistantOverviewCard configured={llmConfigured} />

      <Card className="card--flat">
        <strong style={{ display: "block" }}>Connexion OpenRouter</strong>
        <label className="tiny muted" htmlFor="llm-key" style={{ display: "block", marginTop: 12 }}>
          Clé OpenRouter
        </label>
        <div className="row">
          <input
            id="llm-key"
            className="field grow"
            type={keyVisible ? "text" : "password"}
            value={llmKey}
            maxLength={MAX_API_KEY_CHARS}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            disabled={loading}
            placeholder={llmConfigured ? "Nouvelle clé (facultatif)" : "Colle ta clé ici"}
            onChange={(event) => {
              setLlmKey(event.target.value.slice(0, MAX_API_KEY_CHARS));
              if (llmError) setLlmError("");
            }}
          />
          <button
            type="button"
            className="btn btn--ghost btn--small"
            aria-pressed={keyVisible}
            disabled={loading}
            onClick={() => setKeyVisible((value) => !value)}
          >
            {keyVisible ? "Masquer" : "Afficher"}
          </button>
        </div>
        <p className="tiny muted" style={{ margin: "6px 0 0" }}>
          Chiffrée localement, elle est envoyée directement au fournisseur OpenRouter avec chaque
          demande — jamais au serveur de l’établissement.
        </p>
        {storageUnavailable ? (
          // La clé vit en MÉMOIRE (Keystore mort) : elle disparaît à la fermeture.
          // Sans ce message, l'utilisateur croit sa clé enregistrée.
          <p className="tiny" role="alert" style={{ color: "var(--danger-ink)", margin: "6px 0 0" }}>
            {STORAGE_UNAVAILABLE_MESSAGE}
          </p>
        ) : null}
        {llmError ? (
          <p className="tiny" role="alert" style={{ color: "var(--danger-ink)", margin: "6px 0 0" }}>
            {llmError}
          </p>
        ) : null}
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            disabled={loading || forgettingKey || !llmConfigured}
            onClick={() => setForgetAsk(true)}
          >
            Oublier la clé
          </button>
          <button
            type="button"
            className="btn btn--small"
            disabled={loading || savingKey || llmKey.trim() === ""}
            onClick={() => void saveKey()}
          >
            {savingKey ? "Enregistrement…" : "Enregistrer la clé"}
          </button>
        </div>
      </Card>

      <Dialog
        open={forgetAsk}
        title="Oublier la clé de l’assistant ?"
        role="alertdialog"
        description="L’assistant deviendra inactif sur cet appareil. Tes cours, tes fiches et le manuel enregistré restent en place."
        busy={forgettingKey}
        onClose={() => setForgetAsk(false)}
        actions={
          <>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              data-autofocus
              disabled={forgettingKey}
              onClick={() => setForgetAsk(false)}
            >
              Annuler
            </button>
            <button
              type="button"
              className="btn btn--danger btn--small"
              disabled={forgettingKey}
              onClick={() => void forgetKey()}
            >
              {forgettingKey ? "Suppression…" : "Oublier la clé"}
            </button>
          </>
        }
      />
    </>
  );
}
