import { useEffect, useState, type ReactNode } from "react";
import { useViewNavigate as useNavigate } from "../../ui/viewTransition";
import { bridge } from "../../bridge/client";
import { BridgeCallError } from "../../bridge/types";
import { useApp } from "../../ui/AppContext";
import { Avatar, Card, Divider, EmptyState, ErrorBox, Loading, Page, Section } from "../../ui/components";
import { IconChevronRight, IconClose, IconUser } from "../../ui/icons";
import {
  accountCountLabel,
  isSafePhotoDataUrl,
  parseProfilePayload,
  profileSubtitle,
  type Profile,
} from "./model";

function messageOf(error: unknown): string {
  if (error instanceof BridgeCallError) {
    if (error.code === "auth_required") {
      window.dispatchEvent(new Event("vsn:auth"));
      return "Session expirée : rescane le QR de l'établissement.";
    }
    if (error.code === "unavailable") return "Téléphone injoignable : réessaie dans un instant.";
  }
  return error instanceof Error && error.message.trim() !== "" ? error.message : "Profil indisponible.";
}

function LinkRow({
  title,
  subtitle,
  onClick,
}: {
  title: string;
  subtitle?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="row"
      style={{
        width: "100%",
        minHeight: 52,
        padding: "10px 4px",
        border: 0,
        background: "transparent",
        textAlign: "left",
        color: "inherit",
        borderRadius: "var(--radius-sm)",
      }}
    >
      <span className="grow">
        <span style={{ display: "block", fontWeight: 600 }}>{title}</span>
        {subtitle ? (
          <span className="tiny muted" style={{ display: "block" }}>
            {subtitle}
          </span>
        ) : null}
      </span>
      <IconChevronRight size={18} />
    </button>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return (
    <Card className="card--flat">
      <div style={{ padding: "4px 12px" }}>{children}</div>
    </Card>
  );
}

export default function ProfileScreen() {
  const { refresh, refreshTick, notify } = useApp();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [accountCount, setAccountCount] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [logoutAsk, setLogoutAsk] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    setError("");
    void (async () => {
      const [meResult, accountsResult] = await Promise.allSettled([bridge.me(), bridge.accounts()]);
      if (!alive) return;
      if (accountsResult.status === "fulfilled") {
        const count = accountsResult.value?.count;
        setAccountCount(typeof count === "number" && Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : null);
      }
      if (meResult.status === "rejected") {
        setError(messageOf(meResult.reason));
        setLoaded(true);
        return;
      }
      const result = meResult.value;
      const parsed = parseProfilePayload(result.payload);
      setProfile(parsed);
      if (result.error) setError(result.error);
      if (parsed) {
        try {
          const photoResult = await bridge.photo();
          if (alive) setPhoto(isSafePhotoDataUrl(photoResult.dataUrl) ? photoResult.dataUrl : null);
        } catch {
          if (alive) setPhoto(null);
        }
      } else {
        setPhoto(null);
      }
      if (alive) setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [refreshTick, attempt]);

  useEffect(() => {
    if (!logoutAsk) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loggingOut) setLogoutAsk(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [logoutAsk, loggingOut]);

  const subtitle = profile ? profileSubtitle(profile) : "";

  async function logout(): Promise<void> {
    setLoggingOut(true);
    setLogoutError("");
    try {
      await bridge.logout();
      setLogoutAsk(false);
      setProfile(null);
      setPhoto(null);
      setAccountCount(0);
      refresh();
      notify("Session fermée : caches purgés.");
      navigate("/pairing", { replace: true });
    } catch (e) {
      setLogoutError(messageOf(e));
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <Page>
      {!loaded ? <Loading label="Lecture du profil…" /> : null}

      {error && !profile ? (
        <ErrorBox message={error}>
          <button
            type="button"
            className="btn btn--small"
            style={{ marginTop: 10 }}
            onClick={() => setAttempt((value) => value + 1)}
          >
            Réessayer
          </button>
        </ErrorBox>
      ) : null}

      {error && profile ? (
        <p className="t-body-m" role="alert" style={{ color: "var(--danger-ink)", margin: 0 }}>
          {error}
        </p>
      ) : null}

      {loaded && !profile && !error ? (
        <EmptyState
          icon={<IconUser size={28} />}
          title="Aucune information"
          body="Aucune information publiée pour ce compte."
          action={
            <button type="button" className="btn btn--small" onClick={() => setAttempt((value) => value + 1)}>
              Réessayer
            </button>
          }
        />
      ) : null}

      {profile ? (
        <Card className="card--brand">
          <div className="row">
            <Avatar name={profile.displayName.replace(/[-_]/g, " ")} size={72} src={photo} />
            <div className="grow">
              <h2 className="t-headline" style={{ margin: 0, overflowWrap: "anywhere" }}>
                {profile.displayName}
              </h2>
              {subtitle ? (
                <p className="t-body-m" style={{ margin: "2px 0 0", color: "var(--hero-soft)" }}>
                  {subtitle}
                </p>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      <Section title="Compte">
        <Rows>
          <LinkRow
            title="Appairage QR + PIN"
            subtitle="Connecte ou reconnecte l'appareil à l'établissement"
            onClick={() => navigate("/pairing")}
          />
          <Divider />
          <div className="row row--between" style={{ padding: "12px 4px" }}>
            <span className="t-body-m">{accountCount === null ? "Comptes indisponibles" : accountCountLabel(accountCount)}</span>
            {accountCount !== null && accountCount > 0 ? <span className="chip">{accountCount}</span> : null}
          </div>
        </Rows>
      </Section>

      <Section title="Ressources">
        <Rows>
          <LinkRow title="Fiches de révision" onClick={() => navigate("/fiches")} />
          <Divider />
          <LinkRow title="Messages" onClick={() => navigate("/messages")} />
          <Divider />
          <LinkRow title="Actualités" onClick={() => navigate("/news")} />
          <Divider />
          <LinkRow title="Cantine de la semaine" onClick={() => navigate("/canteen")} />
          <Divider />
          <LinkRow title="Vie scolaire" onClick={() => navigate("/attendance")} />
        </Rows>
      </Section>

      <Section title="Réglages">
        <Rows>
          <LinkRow title="Réglages" subtitle="Thème, matières, clé de l'assistant" onClick={() => navigate("/settings")} />
        </Rows>
      </Section>

      <Section title="Session">
        <Rows>
          <button
            type="button"
            onClick={() => {
              setLogoutError("");
              setLogoutAsk(true);
            }}
            className="row"
            style={{
              width: "100%",
              minHeight: 52,
              padding: "10px 4px",
              border: 0,
              background: "transparent",
              textAlign: "left",
              color: "var(--danger-ink)",
              borderRadius: "var(--radius-sm)",
            }}
          >
            <span className="grow">
              <span style={{ display: "block", fontWeight: 700 }}>Se déconnecter</span>
              <span className="tiny muted" style={{ display: "block" }}>
                Session invalidée, caches purgés
              </span>
            </span>
          </button>
        </Rows>
      </Section>

      {logoutAsk ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            background: "rgba(0,0,0,0.42)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={() => {
            if (!loggingOut) setLogoutAsk(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="logout-title"
            aria-describedby="logout-body"
            className="card"
            style={{ width: "100%", maxWidth: 420 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="row row--between" style={{ alignItems: "flex-start" }}>
              <h2 className="t-title" id="logout-title" style={{ margin: 0 }}>
                Se déconnecter
              </h2>
              <button
                type="button"
                className="icon-btn"
                aria-label="Fermer"
                disabled={loggingOut}
                onClick={() => setLogoutAsk(false)}
              >
                <IconClose size={18} />
              </button>
            </div>
            <p className="t-body-m muted" id="logout-body" style={{ margin: "8px 0 14px" }}>
              La session appairée est invalidée et les données en cache de cet appareil sont purgées. Il faudra appairer à
              nouveau pour revenir.
            </p>
            {logoutError ? (
              <p className="tiny" role="alert" style={{ color: "var(--danger-ink)" }}>
                {logoutError}
              </p>
            ) : null}
            <div className="row row--between" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn btn--ghost btn--small" disabled={loggingOut} onClick={() => setLogoutAsk(false)}>
                Annuler
              </button>
              <button type="button" className="btn btn--danger btn--small" disabled={loggingOut} onClick={() => void logout()}>
                {loggingOut ? "Déconnexion…" : "Se déconnecter"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Page>
  );
}
