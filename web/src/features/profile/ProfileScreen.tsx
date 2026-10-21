import { useEffect, useState } from "react";
import { useViewNavigate as useNavigate } from "../../ui/viewTransition";
import { bridge } from "../../bridge/client";
import { BridgeCallError } from "../../bridge/types";
import { useApp } from "../../ui/AppContext";
import { logoutSession } from "../../lib/session";
import {
  Avatar,
  Card,
  Divider,
  EmptyState,
  ErrorBox,
  ListRow,
  Loading,
  Page,
  Rows,
  Section,
} from "../../ui/components";
import { Dialog } from "../../ui/Dialog";
import { IconUser } from "../../ui/icons";
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

export default function ProfileScreen() {
  const { refresh, refreshTick, notify, closeSession } = useApp();
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

  const subtitle = profile ? profileSubtitle(profile) : "";

  async function logout(): Promise<void> {
    setLoggingOut(true);
    setLogoutError("");
    try {
      // La session est invalidée côté natif (caches purgés) : l'interface
      // se ferme dans la foulée, sinon l'accueil afficherait « aucune donnée
      // en cache » pour un compte déconnecté (#360).
      await logoutSession({ logout: bridge.logout, closeSession });
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
          icon={<IconUser size={30} />}
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
          <ListRow
            title="Appairage QR + PIN"
            subtitle="Connecte ou reconnecte l’appareil à l’établissement"
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
          <ListRow title="Fiches de révision" onClick={() => navigate("/fiches")} />
          <Divider />
          <ListRow title="Messagerie" onClick={() => navigate("/messages")} />
          <Divider />
          <ListRow title="Actualités" onClick={() => navigate("/news")} />
          <Divider />
          <ListRow title="Cantine de la semaine" onClick={() => navigate("/canteen")} />
          <Divider />
          <ListRow title="Vie scolaire" onClick={() => navigate("/attendance")} />
        </Rows>
      </Section>

      <Section title="Réglages">
        <Rows>
          <ListRow title="Préférences" subtitle="Thème, matières, clé de l’assistant" onClick={() => navigate("/settings")} />
        </Rows>
      </Section>

      <Section title="Session">
        <Rows>
          <ListRow
            title="Se déconnecter"
            subtitle="Session invalidée, caches purgés"
            danger
            trailing={null}
            onClick={() => {
              setLogoutError("");
              setLogoutAsk(true);
            }}
          />
        </Rows>
      </Section>

      <Dialog
        open={logoutAsk}
        title="Se déconnecter"
        description="La session appairée est invalidée et les données en cache de cet appareil sont purgées. Il faudra appairer à nouveau pour revenir."
        busy={loggingOut}
        onClose={() => setLogoutAsk(false)}
        actions={
          <>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              data-autofocus
              disabled={loggingOut}
              onClick={() => setLogoutAsk(false)}
            >
              Annuler
            </button>
            <button
              type="button"
              className="btn btn--danger btn--small"
              disabled={loggingOut}
              onClick={() => void logout()}
            >
              {loggingOut ? "Déconnexion…" : "Se déconnecter"}
            </button>
          </>
        }
      >
        {logoutError ? (
          <p className="tiny" role="alert" style={{ color: "var(--danger-ink)", margin: "10px 0 0" }}>
            {logoutError}
          </p>
        ) : null}
      </Dialog>
    </Page>
  );
}
