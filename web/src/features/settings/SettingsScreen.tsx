import { useEffect, useState } from "react";
import { bridge } from "../../bridge/client";
import type { SettingsSnapshot } from "../../bridge/types";
import { useApp } from "../../ui/AppContext";
import { Avatar, ErrorBox, ListRow, Loading, Page, Rows, Section } from "../../ui/components";
import { IconBook, IconInfo, IconSettings, IconShield, IconSparkles, IconTrash } from "../../ui/icons";
import { useViewNavigate } from "../../ui/viewTransition";
import { parseProfilePayload, type Profile } from "../profile/model";
import { AdvancedSection, SelfHostingNotice } from "./AdvancedSection";
import { AppearanceCard } from "./AppearanceCard";
import { AssistantCards } from "./AssistantCards";
import { DataExportCard } from "./DataExportCard";
import { DeleteAllCard } from "./DeleteAllCard";
import { DiagnosticExportCard } from "./DiagnosticExportCard";
import { ManualCard } from "./ManualCard";
import { ServerCard } from "./ServerCard";
import { SubjectPrefsCard } from "./SubjectPrefsCard";
import { actionMessage } from "./action";
import "./settings.css";

/** Une lecture d'instantané, puis chaque carte tient son propre état de formulaire. */
export default function SettingsScreen() {
  const { refreshTick } = useApp();
  const navigate = useViewNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingsError, setSettingsError] = useState("");
  const [reload, setReload] = useState(0);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void bridge
      .me()
      .then((result) => {
        if (alive) setProfile(parseProfilePayload(result.payload));
      })
      .catch(() => {
        if (alive) setProfile(null);
      });
    return () => {
      alive = false;
    };
  }, [refreshTick]);

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

  const tiles = [
    {
      target: "reglages-apparence",
      label: "Apparence",
      detail: "Thèmes, palettes",
      tone: "appearance",
      Icon: IconSettings,
    },
    {
      target: "reglages-matieres",
      label: "Matières",
      detail: "Icônes, couleurs",
      tone: "subjects",
      Icon: IconBook,
    },
    {
      target: "reglages-assistant",
      label: "Assistant",
      detail: "Clé, sources",
      tone: "assistant",
      Icon: IconSparkles,
    },
    {
      target: "reglages-avance",
      label: "Avancé",
      detail: "Serveur, manuel",
      tone: "device",
      Icon: IconShield,
    },
    {
      target: "reglages-suppression",
      label: "Données",
      detail: "Tout supprimer",
      tone: "device",
      Icon: IconTrash,
    },
  ];
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "auto" });
  };

  return (
    <Page className="settings">
      <div className="settings-profile">
        <Avatar name={profile?.displayName ?? "?"} size={72} />
        <strong className="settings-profile__name">{profile?.displayName ?? "Mon compte"}</strong>
        <span className="settings-profile__sub">
          {profile
            ? [profile.classLabel, profile.periodName].filter(Boolean).join(" · ")
            : "Réglages de l’application"}
        </span>
      </div>

      <div className="settings-tiles">
        {tiles.map(({ target, label, detail, tone, Icon }) => (
          <button
            key={target}
            type="button"
            className={`settings-tile settings-tile--${tone}`}
            onClick={() => scrollTo(target)}
          >
            <span className="settings-tile__icon" aria-hidden="true">
              <Icon size={32} />
            </span>
            <span className="settings-tile__label">{label}</span>
            <span className="settings-tile__detail">{detail}</span>
          </button>
        ))}
      </div>

      {loading ? <Loading label="Lecture des réglages…" /> : null}

      {settingsError ? (
        <ErrorBox message={settingsError}>
          <button type="button" className="btn btn--small" onClick={() => setReload((n) => n + 1)}>
            Réessayer
          </button>
        </ErrorBox>
      ) : null}

      <Section id="reglages-apparence" title="Apparence">
        <AppearanceCard />
      </Section>

      <Section id="reglages-matieres" title="Matières">
        <SubjectPrefsCard
          loading={loading}
          reload={reload}
          onRetry={() => setReload((n) => n + 1)}
        />
      </Section>

      <Section id="reglages-assistant" title="Assistant">
        <AssistantCards snapshot={snapshot} loading={loading} />
      </Section>

      <Section id="reglages-donnees" title="Données">
        <DataExportCard />
      </Section>

      <AdvancedSection open={advancedOpen} onToggle={() => setAdvancedOpen((open) => !open)}>
        <SelfHostingNotice />
        <ServerCard snapshot={snapshot} loading={loading} />
        <ManualCard snapshot={snapshot} loading={loading} />
      </AdvancedSection>

      <Section title="Aide">
        <Rows>
          <ListRow
            title="Aide et FAQ"
            subtitle="QR, PIN, réseau, caméra, assistant, dépannage · Android 8.0+, WebView 100+"
            leading={<IconInfo size={22} />}
            onClick={() => navigate("/help")}
          />
          <ListRow
            title="À propos et licences"
            subtitle="Version, source, licences"
            leading={<IconShield size={22} />}
            onClick={() => navigate("/about")}
          />
        </Rows>
        <DiagnosticExportCard />
      </Section>

      <Section id="reglages-suppression" title="Données">
        <DeleteAllCard />
      </Section>

      <div className="row" style={{ justifyContent: "center", color: "var(--muted)" }}>
        <IconSettings size={16} />
        <span className="tiny">Réglages enregistrés sur cet appareil</span>
      </div>
    </Page>
  );
}
