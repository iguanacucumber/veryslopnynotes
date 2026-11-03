import { useEffect, useId, useState } from "react";
import { bridge } from "../../bridge/client";
import { BridgeCallError } from "../../bridge/types";
import { useApp } from "../../ui/AppContext";
import { Dialog } from "../../ui/Dialog";
import { IconBook } from "../../ui/icons";
import { MANUAL_RIGHTS_ATTESTATION, MAX_MANUAL_URL_CHARS, manualCanSave, manualPromptDue } from "./model";

function errorMessage(error: unknown): string {
  if (error instanceof BridgeCallError) {
    if (error.code === "auth_required") return "Session expirée : rescane le QR de l'établissement.";
    if (error.code === "unavailable") return "Téléphone injoignable : réessaie dans un instant.";
  }
  return "Manuel non enregistré : réessaie dans un instant.";
}

/** Invitation unique au manuel : seulement si l'assistant et un serveur sont
 *  configurés, jamais revue après enregistrement ou refus (le champ reste dans
 *  Réglages → Avancé). */
export function ManualPrompt() {
  const { notify } = useApp();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [rights, setRights] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputId = useId();

  useEffect(() => {
    let alive = true;
    void bridge
      .settings()
      .then((snapshot) => {
        if (!alive) return;
        setOpen(manualPromptDue(snapshot));
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
    if (!rights) {
      setError("Coche l'attestation avant d'enregistrer.");
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
      setRights(false);
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
      description="L’assistant choisit l’ouvrage selon ta classe et la matière du devoir. Colle l’adresse d’un manuel que tu as le droit d’utiliser. Ton adresse part uniquement vers le scraper configuré dans Réglages → Avancé, jamais vers l’établissement ni vers le fournisseur LLM."
      icon={<IconBook size={20} />}
      busy={busy}
      onClose={dismiss}
      actions={
        <>
          <button type="button" className="btn btn--ghost btn--small" disabled={busy} onClick={dismiss}>
            Plus tard
          </button>
          <button type="button" className="btn btn--small" disabled={busy || !manualCanSave(url, rights)} onClick={() => void save()}>
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
          setRights(false);
          if (error) setError("");
        }}
      />
      <p id={`${inputId}-help`} className="tiny muted" style={{ margin: "6px 0 0" }}>
        L’adresse n’est pas préremplie. Le scraper facultatif doit être renseigné dans Réglages → Avancé.
        L’assistant cite l’extrait « Manuel : titre ».
      </p>
      <label
        className="tiny muted"
        style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 10, cursor: "pointer" }}
      >
        <input
          type="checkbox"
          checked={rights}
          disabled={busy}
          style={{ flex: "none", width: 18, height: 18, margin: 0, accentColor: "var(--brand-solid)" }}
          onChange={(event) => {
            setRights(event.target.checked);
            if (error) setError("");
          }}
        />
        <span>{MANUAL_RIGHTS_ATTESTATION}</span>
      </label>
      {error ? (
        <p id={`${inputId}-error`} className="tiny" role="alert" style={{ color: "var(--danger-ink)", margin: "6px 0 0" }}>
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
