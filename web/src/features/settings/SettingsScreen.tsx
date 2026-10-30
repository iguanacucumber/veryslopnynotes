import { useEffect, useState } from "react";
import { bridge } from "../../bridge/client";
import type { SettingsSnapshot } from "../../bridge/types";
import { useApp } from "../../ui/AppContext";
import { ErrorBox, Loading, Page, Section } from "../../ui/components";
import { IconSettings } from "../../ui/icons";
import { AppearanceCard } from "./AppearanceCard";
import { AssistantCards } from "./AssistantCards";
import { ManualCard } from "./ManualCard";
import { ServerCard } from "./ServerCard";
import { SubjectPrefsCard } from "./SubjectPrefsCard";
import { actionMessage } from "./action";
import "./settings.css";

/**
 * Conteneur des réglages : UNE lecture de l'instantané (le pont est local),
 * chaque carte tient ensuite son propre état de formulaire. Aucun contexte
 * React : rien n'est partagé hors de la carte qui l'écrit.
 */
export default function SettingsScreen() {
  const { refreshTick } = useApp();
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingsError, setSettingsError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setSettingsError("");
    void (async () => {
      try {
        const next = await bridge.settings();
        if (alive) setSnapshot(next);
      } catch (error) {
        if (alive) setSettingsError(actionMessage(error, "Réglages indisponibles : réessaie dans un instant."));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [refreshTick, reload]);

  return (
    <Page>
      {loading ? <Loading label="Lecture des réglages…" /> : null}

      {settingsError ? (
        <ErrorBox message={settingsError}>
          <button type="button" className="btn btn--small" onClick={() => setReload((n) => n + 1)}>
            Réessayer
          </button>
        </ErrorBox>
      ) : null}

      <Section title="Apparence">
        <AppearanceCard />
      </Section>

      <Section title="Matières">
        <SubjectPrefsCard
          loading={loading}
          reload={reload}
          onRetry={() => setReload((n) => n + 1)}
        />
      </Section>

      <Section title="Assistant">
        <AssistantCards snapshot={snapshot} loading={loading} />
        <ManualCard snapshot={snapshot} loading={loading} />
      </Section>

      <Section title="Avancé">
        <ServerCard snapshot={snapshot} loading={loading} />
      </Section>

      <div className="row" style={{ justifyContent: "center", color: "var(--muted)" }}>
        <IconSettings size={16} />
        <span className="tiny">Réglages enregistrés sur cet appareil</span>
      </div>
    </Page>
  );
}
