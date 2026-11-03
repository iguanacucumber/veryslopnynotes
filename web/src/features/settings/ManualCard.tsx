import { useEffect, useState } from "react";
import { bridge } from "../../bridge/client";
import type { SettingsSnapshot } from "../../bridge/types";
import { useApp } from "../../ui/AppContext";
import { Card } from "../../ui/components";
import { actionMessage } from "./action";
import { MANUAL_RIGHTS_ATTESTATION, MAX_MANUAL_URL_CHARS, manualCanSave, manualSaveNotice } from "./model";

/** L'adresse part au pont natif, jamais au serveur de l'établissement ; rien n'est stocké ici. */
export function ManualCard({ snapshot, loading }: { snapshot: SettingsSnapshot | null; loading: boolean }) {
  const { notify } = useApp();
  // Vide tant que l'instantané n'est pas lu : une adresse non enregistrée ne
  // doit pas passer pour une valeur lue (I14).
  const [manualUrl, setManualUrl] = useState("");
  const [manualRights, setManualRights] = useState(false);
  const [manualConfigured, setManualConfigured] = useState(false);
  const [manualAuto, setManualAuto] = useState(false);
  const [manualReady, setManualReady] = useState(false);
  const [manualLevel, setManualLevel] = useState("");
  const [manualSpecialties, setManualSpecialties] = useState<string[]>([]);
  const [manualError, setManualError] = useState("");
  const [manualNotice, setManualNotice] = useState("");
  const [savingManual, setSavingManual] = useState(false);

  useEffect(() => {
    if (!snapshot) return;
    setManualUrl(typeof snapshot.manualUrl === "string" ? snapshot.manualUrl : "");
    setManualConfigured(snapshot.manualConfigured === true);
    setManualAuto(snapshot.manualAuto === true);
    setManualReady(snapshot.manualReady === true);
    setManualLevel(typeof snapshot.manualLevel === "string" ? snapshot.manualLevel : "");
    setManualSpecialties(Array.isArray(snapshot.manualSpecialties) ? snapshot.manualSpecialties : []);
  }, [snapshot]);

  async function saveManual(): Promise<void> {
    const value = manualUrl.trim();
    if (value === "") {
      setManualError("Colle l'adresse de ton manuel avant d'enregistrer.");
      return;
    }
    if (!manualRights) {
      setManualError("Coche l'attestation avant d'enregistrer.");
      return;
    }
    setManualError("");
    setManualNotice("");
    setSavingManual(true);
    try {
      const response = await bridge.saveManualUrl(value);
      if (!response.ok) {
        setManualError(response.message || "Adresse refusée : vérifie-la.");
        return;
      }
      setManualUrl(value);
      setManualRights(false);
      setManualConfigured(true);
      setManualAuto(response.auto === true);
      setManualReady(response.ready === true);
      setManualLevel(typeof response.level === "string" ? response.level : "");
      setManualSpecialties(Array.isArray(response.specialties) ? response.specialties : []);
      const { notice, kind } = manualSaveNotice(response);
      setManualNotice(notice);
      notify(notice, kind);
    } catch (error) {
      setManualError(actionMessage(error, "Manuel non enregistré : réessaie dans un instant."));
    } finally {
      setSavingManual(false);
    }
  }

  async function forgetManual(): Promise<void> {
    setManualError("");
    setManualNotice("");
    setSavingManual(true);
    try {
      const response = await bridge.saveManualUrl("");
      if (!response.ok) {
        setManualError(response.message || "Manuel non supprimé : réessaie dans un instant.");
        return;
      }
      setManualUrl("");
      setManualRights(false);
      setManualConfigured(false);
      setManualAuto(false);
      setManualReady(false);
      setManualLevel("");
      setManualSpecialties([]);
      setManualNotice("Manuel oublié.");
      notify("Manuel oublié.");
    } catch (error) {
      setManualError(actionMessage(error, "Manuel non supprimé : réessaie dans un instant."));
    } finally {
      setSavingManual(false);
    }
  }

  const manualGuess = [manualLevel, manualSpecialties.join(", ")]
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join(" · ");
  const manualStatus = manualAuto ? "Automatique" : manualReady ? "Prêt" : "Non récupéré";
  // Instantané non lu : ni une adresse ni « Non récupéré » ne sont des faits
  // sur ce compte.
  const unread = snapshot === null && !loading;
  const blocked = loading || unread || savingManual;

  return (
    <Card className="card--flat">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <strong className="grow" style={{ display: "block" }}>
          Manuel de l’élève (facultatif)
        </strong>
        {manualConfigured ? (
          <span
            className={`chip settings-manual__status${
              manualAuto || manualReady ? " chip--active" : " settings-manual__status--warn"
            }`}
          >
            {manualStatus}
          </span>
        ) : null}
      </div>
      <p className="tiny muted" style={{ margin: "2px 0 0" }}>
        L’assistant choisit l’ouvrage selon ta classe et la matière du devoir, puis en cite un
        extrait dans l’aide devoirs et les fiches de révision. L’adresse est lue par le scraper
        facultatif, jamais par l’établissement.
      </p>
      {unread ? (
        <p className="tiny" role="status" style={{ color: "var(--danger-ink)", margin: "8px 0 0" }}>
          Réglages non lus : l’état du manuel est inconnu, rien n’est affiché comme enregistré.
        </p>
      ) : null}
      <label className="tiny muted" htmlFor="manual-url" style={{ display: "block", marginTop: 12 }}>
        Adresse du manuel
      </label>
      <input
        id="manual-url"
        className="field"
        type="url"
        value={manualUrl}
        maxLength={MAX_MANUAL_URL_CHARS}
        inputMode="url"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        disabled={blocked}
        aria-invalid={manualError !== ""}
        aria-describedby="manual-help"
        placeholder="https://manuel.exemple.fr/chapitre"
        onChange={(event) => {
          setManualUrl(event.target.value);
          setManualRights(false);
          setManualConfigured(false);
          setManualAuto(false);
          setManualReady(false);
          setManualNotice("");
          if (manualError) setManualError("");
        }}
      />
      <p id="manual-help" className="tiny muted" style={{ margin: "6px 0 0" }}>
        Colle l’adresse d’un manuel que tu as le droit d’utiliser, ou le catalogue de ton
        éditeur s’il l’autorise. L’assistant choisit l’ouvrage selon ta classe et la matière du
        devoir ; la récupération passe par le scraper facultatif de la section Avancé.
      </p>
      <label
        className="tiny muted"
        style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 10, cursor: "pointer" }}
      >
        <input
          type="checkbox"
          checked={manualRights}
          disabled={blocked}
          style={{ flex: "none", width: 18, height: 18, margin: 0, accentColor: "var(--brand-solid)" }}
          onChange={(event) => {
            setManualRights(event.target.checked);
            if (manualError) setManualError("");
          }}
        />
        <span>{MANUAL_RIGHTS_ATTESTATION}</span>
      </label>
      {manualConfigured && !manualNotice ? (
        <p
          className="tiny"
          role="status"
          style={{
            color: manualAuto || manualReady ? "var(--brand-deep)" : "var(--danger-ink)",
            margin: "6px 0 0",
          }}
        >
          {manualAuto
            ? manualGuess === ""
              ? "Manuel automatique : l’ouvrage suivra la matière du devoir."
              : `Manuel automatique (${manualGuess}) : l’ouvrage suivra la matière du devoir.`
            : manualReady
              ? "Manuel récupéré : l’assistant peut le citer."
              : "Manuel pas encore récupéré : enregistre-le pour réessayer."}
        </p>
      ) : null}
      {manualNotice ? (
        <p
          className="tiny"
          role="status"
          style={{
            color: manualAuto || manualReady ? "var(--brand-deep)" : "var(--danger-ink)",
            margin: "6px 0 0",
          }}
        >
          {manualNotice}
        </p>
      ) : null}
      {manualError ? (
        <p className="tiny" role="alert" style={{ color: "var(--danger-ink)", margin: "6px 0 0" }}>
          {manualError}
        </p>
      ) : null}
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
        <button
          type="button"
          className="btn btn--ghost btn--small"
          disabled={blocked || !manualConfigured}
          onClick={() => void forgetManual()}
        >
          Oublier le manuel
        </button>
        <button
          type="button"
          className="btn btn--small"
          disabled={blocked || !manualCanSave(manualUrl, manualRights)}
          onClick={() => void saveManual()}
        >
          {savingManual ? "Enregistrement…" : "Enregistrer le manuel"}
        </button>
      </div>
    </Card>
  );
}
