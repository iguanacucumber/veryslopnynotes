import { useEffect, useId, useState } from "react";
import { bridge } from "../../bridge/client";
import { BridgeCallError } from "../../bridge/types";
import { useApp } from "../../ui/AppContext";
import { Dialog } from "../../ui/Dialog";
import { IconBook } from "../../ui/icons";
import { MAX_MANUAL_URL_CHARS, DEFAULT_MANUAL_URL } from "./model";

function errorMessage(error: unknown): string {
  if (error instanceof BridgeCallError) {
    if (error.code === "auth_required") return "Session expirée : rescane le QR de l'établissement.";
    if (error.code === "unavailable") return "Téléphone injoignable : réessaie dans un instant.";
  }
  return "Manuel non enregistré : réessaie dans un instant.";
}

/** Invitation unique au manuel : seulement si l'assistant est configuré, jamais
 *  revue après enregistrement ou refus (le champ reste dans Réglages). */
export function ManualPrompt() {
  const { notify } = useApp();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(DEFAULT_MANUAL_URL);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputId = useId();

  useEffect(() => {
    let alive = true;
    void bridge
      .settings()
      .then((snapshot) => {
        if (!alive) return;
        setOpen(
          snapshot.llmConfigured === true &&
            snapshot.manualConfigured !== true &&
            (snapshot.manualUrl ?? "") === "" &&
            snapshot.manualPromptSeen !== true,
        );
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  function dismiss() {
    if (busy) return;
    setOpen(false);
    // Jamais bloquant : au pire l'invitation reviendra au prochain lancement.
    void bridge.dismissManualPrompt().catch(() => undefined);
  }

  async function save() {
    if (busy) return;
    const value = url.trim();
    if (value === "") {
      setError("Colle l'adresse de ton manuel avant d'enregistrer.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await bridge.saveManualUrl(value);
      if (!response.ok) {
        setError(response.message || "Adresse refusée : vérifie-la.");
        return;
      }
      setOpen(false);
      if (response.auto) {
        const guess = [response.level, (response.specialties ?? []).join(", ")]
          .filter((part) => typeof part === "string" && part.trim() !== "")
          .join(" · ");
        notify(
          guess === ""
            ? "Manuel automatique activé : l’ouvrage suivra la matière du devoir."
            : `Manuel automatique activé (${guess}).`,
        );
      } else {
        notify(
          response.ready
            ? "Manuel prêt : l'assistant peut le citer."
            : response.message || "Adresse enregistrée, mais le manuel n'a pas pu être récupéré.",
          response.ready ? "info" : "error",
        );
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      title="Ton manuel, une seule fois"
      description="L’assistant choisit l’ouvrage selon ta classe et la matière du devoir. Garde l’adresse par défaut, ou colle celle d’un manuel précis. Ton adresse part uniquement vers le scraper configuré dans Réglages, jamais vers l’établissement ni vers le fournisseur LLM."
      icon={<IconBook size={20} />}
      busy={busy}
      onClose={dismiss}
      actions={
        <>
          <button type="button" className="btn btn--ghost btn--small" disabled={busy} onClick={dismiss}>
            Plus tard
          </button>
          <button type="button" className="btn btn--small" disabled={busy || url.trim() === ""} onClick={() => void save()}>
            {busy ? "Enregistrement…" : "Enregistrer"}
          </button>
        </>
      }
    >
      <label className="tiny muted" htmlFor={inputId} style={{ display: "block", marginBottom: 6 }}>
        Adresse du manuel
      </label>
      <input
        id={inputId}
        className="field"
        type="url"
        value={url}
        maxLength={MAX_MANUAL_URL_CHARS}
        inputMode="url"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        disabled={busy}
        aria-invalid={error !== ""}
        aria-describedby={error ? `${inputId}-error` : `${inputId}-help`}
        placeholder="https://manuel.exemple.fr/chapitre"
        data-autofocus
        onChange={(event) => {
          setUrl(event.target.value);
          if (error) setError("");
        }}
      />
      <p id={`${inputId}-help`} className="tiny muted" style={{ margin: "6px 0 0" }}>
        L’adresse par défaut est le catalogue : l’assistant y choisit le manuel de la matière.
        Le scraper facultatif doit être renseigné dans Réglages.
      </p>
      {error ? (
        <p id={`${inputId}-error`} className="tiny" role="alert" style={{ color: "var(--danger-ink)", margin: "6px 0 0" }}>
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
