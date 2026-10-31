import { useEffect, useState } from "react";
import { bridge } from "../../bridge/client";
import type { SettingsSnapshot } from "../../bridge/types";
import { useApp } from "../../ui/AppContext";
import { Card } from "../../ui/components";
import { actionMessage } from "./action";
import { validateServerHost } from "./model";

/** L'instantané du conteneur amorce le champ ; l'enregistrement reste local à la carte. */
export function ServerCard({ snapshot, loading }: { snapshot: SettingsSnapshot | null; loading: boolean }) {
  const { notify } = useApp();
  const [host, setHost] = useState("");
  const [hostError, setHostError] = useState("");
  const [hostSaved, setHostSaved] = useState("");
  const [savingHost, setSavingHost] = useState(false);

  useEffect(() => {
    setHost(typeof snapshot?.serverHost === "string" ? snapshot.serverHost : "");
  }, [snapshot]);

  async function saveHost(): Promise<void> {
    setHostSaved("");
    const result = validateServerHost(host);
    if (!result.ok) {
      setHostError(result.message);
      return;
    }
    setHostError("");
    setSavingHost(true);
    try {
      const response = await bridge.saveServer(result.value);
      if (!response.ok) {
        setHostError("Adresse refusée : vérifie le domaine et le port.");
        return;
      }
      setHost(result.value);
      setHostSaved("Adresse du serveur enregistrée.");
      notify("Adresse du serveur enregistrée.");
    } catch (error) {
      setHostError(actionMessage(error, "Adresse non enregistrée : réessaie dans un instant."));
    } finally {
      setSavingHost(false);
    }
  }

  return (
    <Card className="card--flat">
      <strong style={{ display: "block" }}>Scraper de manuels (facultatif)</strong>
      <p className="tiny muted" style={{ margin: "2px 0 0" }}>
        Sert uniquement à récupérer les manuels. L’établissement et l’assistant fonctionnent sans ce serveur.
      </p>
      <label className="tiny muted" htmlFor="server-host" style={{ display: "block", marginTop: 12 }}>
        Adresse du serveur
      </label>
      <input
        id="server-host"
        className="field"
        value={host}
        maxLength={300}
        inputMode="url"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        disabled={loading}
        aria-invalid={hostError !== ""}
        aria-describedby="server-help"
        placeholder="https://serveur.exemple"
        onChange={(event) => {
          setHost(event.target.value);
          setHostSaved("");
          if (hostError) setHostError("");
        }}
      />
      <p id="server-help" className="tiny muted" style={{ margin: "6px 0 0" }}>
        Domaine seul ou adresse complète. HTTP n'est accepté que pour l'émulateur et la boucle locale.
      </p>
      {hostError ? (
        <p className="tiny" role="alert" style={{ color: "var(--danger-ink)", margin: "6px 0 0" }}>
          {hostError}
        </p>
      ) : null}
      {hostSaved ? (
        <p className="tiny" role="status" style={{ color: "var(--brand-deep)", margin: "6px 0 0" }}>
          {hostSaved}
        </p>
      ) : null}
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
        <button
          type="button"
          className="btn btn--small"
          disabled={loading || savingHost || host.trim() === ""}
          onClick={() => void saveHost()}
        >
          {savingHost ? "Enregistrement…" : "Enregistrer l'adresse"}
        </button>
      </div>
    </Card>
  );
}
