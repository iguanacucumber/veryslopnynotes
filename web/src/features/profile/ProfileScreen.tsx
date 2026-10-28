import { useEffect, useState } from "react";
import { useViewNavigate as useNavigate } from "../../ui/viewTransition";
import { bridge } from "../../bridge/client";
import { BridgeCallError } from "../../bridge/types";
import { useApp } from "../../ui/AppContext";
import { logoutSession, STORAGE_UNAVAILABLE_MESSAGE } from "../../lib/session";
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
import { IconBook, IconSparkles, IconUser } from "../../ui/icons";
import {
  accountCountHint,
  accountCountLabel,
  isSafePhotoDataUrl,
  parseProfilePayload,
  profileSubtitle,
  switchableAccounts,
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
  const { refresh, refreshTick, notify, closeSession, storageUnavailable } = useApp();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [accountCount, setAccountCount] = useState<number | null>(null);
  const [accountsFailed, setAccountsFailed] = useState(false);
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
    setAccountsFailed(false);
    void (async () => {
      const [meResult, accountsResult] = await Promise.allSettled([bridge.me(), bridge.accounts()]);
      if (!alive) return;
      if (accountsResult.status === "fulfilled") {
        const count = accountsResult.value?.count;
        setAccountCount(typeof count === "number" && Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : null);
        setAccountsFailed(typeof count !== "number" || !Number.isFinite(count));
      } else {
        setAccountCount(null);
        setAccountsFailed(true);
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
  // Le compte de session vient en tête : les enfants publiés suivent, sans
  // doublon. Aucun choix ici : l'appareil ne sert qu'une session à la fois.
  const linkedAccounts = switchableAccounts(profile);

  function openPairing(): void {
    // Le profil n'existe que sur une session vivante : l'appairage REMPLACE
    // donc toujours le compte actif. L'écran d'appairage le dit à partir de
    // cet état de navigation.
    navigate("/pairing", { state: { replacing: true } });
  }

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
              <p className="account-hero__status">
                <span className="account-hero__dot" aria-hidden="true" />
                Compte actif sur cet appareil
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      {storageUnavailable ? (
        // #401 : même avertissement qu'à l'appairage. Un Keystore mort ne
        // conserve ni la session ni la clé de l'assistant : le profil ne doit
        // pas laisser croire que tout est enregistré.
        <div className="card card--danger" role="alert">
          <p className="t-body-m" style={{ margin: 0, color: "var(--danger-ink)" }}>
            {STORAGE_UNAVAILABLE_MESSAGE}
          </p>
        </div>
      ) : null}

      <Section title="Compte">
        <Rows>
          <ListRow
            title="Changer de compte"
            subtitle="Scanne le QR du compte à utiliser. La session actuelle est remplacée."
            onClick={openPairing}
          />
          <Divider />
          <div className="list-row list-row--static">
            <span className="grow">
              <span className="list-row__title">Comptes appairés</span>
              <span className="list-row__subtitle">
                {accountsFailed
                  ? "Nombre de comptes indisponible."
                  : accountCount === null
                    ? "Lecture en cours…"
                    : accountCountLabel(accountCount)}
              </span>
              {!accountsFailed && accountCount !== null && accountCount > 1 ? (
                <span className="list-row__subtitle">{accountCountHint(accountCount)}</span>
              ) : null}
            </span>
            {accountsFailed ? (
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => setAttempt((value) => value + 1)}
              >
                Réessayer
              </button>
            ) : null}
          </div>
          <Divider />
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

      {linkedAccounts.length > 1 ? (
        // Enfants publiés par /v1/me (#140) : lecture seule, car changer de
        // compte exige un nouvel appairage — pas un sélecteur qui ne change
        // aucune donnée.
        <Section title="Comptes liés">
          <Rows>
            {linkedAccounts.map((account, index) => (
              <div key={account.accountId}>
                {index > 0 ? <Divider /> : null}
                <div className="list-row list-row--static">
                  <span className="list-row__leading">
                    <Avatar name={account.displayName.replace(/[-_]/g, " ")} size={40} />
                  </span>
                  <span className="grow">
                    <span className="list-row__title">{account.displayName}</span>
                    {account.classLabel ? <span className="list-row__subtitle">{account.classLabel}</span> : null}
                  </span>
                  {index === 0 ? <span className="chip chip--active">Actif</span> : null}
                </div>
              </div>
            ))}
          </Rows>
        </Section>
      ) : null}

      <Section title="Assistant">
        <Rows>
          <ListRow
            title="Cahier de cours"
            subtitle="Tes cours, sources de l’assistant"
            leading={<IconBook size={22} />}
            onClick={() => navigate("/course-notes")}
          />
          <Divider />
          <ListRow
            title="Fiches de révision"
            subtitle="Générées depuis un devoir"
            leading={<IconSparkles size={22} />}
            onClick={() => navigate("/revision-sheets")}
          />
        </Rows>
      </Section>

      <Section title="Ressources">
        <Rows>
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

      <Dialog
        open={logoutAsk}
        title="Se déconnecter"
        role="alertdialog"
        description="La session appairée est invalidée et les données scolaires en cache (notes, devoirs, messages) sont supprimées de cet appareil. Tes préférences et la clé de l’assistant restent."
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
