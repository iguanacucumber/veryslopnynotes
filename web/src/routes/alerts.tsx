import { useMemo, useState } from "react";
import { useResource } from "../ui/AppContext";
import { Card, Divider, EmptyState, ErrorBox, Loading, Page, StaleBadge } from "../ui/components";
import { IconCheck, IconShield } from "../ui/icons";
import {
  EXCERPT_COLLAPSED,
  alertKindLabel,
  alertSeverity,
  alertSourceLabel,
  alertsLayout,
  excerptPreview,
  parseAlertsPayload,
  sanitizeExcerpt,
  type SecurityAlert,
} from "../features/alerts/alerts";

function AlertCard({ alert }: { alert: SecurityAlert }) {
  const [expanded, setExpanded] = useState(false);
  const excerpt = sanitizeExcerpt(alert.excerpt);
  const collapsible = excerpt.length > EXCERPT_COLLAPSED;
  const shown = expanded || !collapsible ? excerpt : excerptPreview(excerpt);
  const danger = alertSeverity(alert.kind) === "danger";

  return (
    <Card as="article" className="stack">
      <div className="row row--wrap">
        <span className={danger ? "chip chip--danger" : "chip chip--active"}>
          {alertKindLabel(alert.kind)}
        </span>
        <span className="chip">{alertSourceLabel(alert.source)}</span>
      </div>
      <p className="tiny muted" style={{ margin: 0 }}>
        {danger ? "Gravité : élevée" : "Gravité : information"}
      </p>

      <h3 className="tiny muted" style={{ margin: 0 }}>
        Donnée suspecte (non exécutée)
      </h3>
      <Divider />
      <p className="t-body-m" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
        {shown}
      </p>
      {collapsible ? (
        <button
          type="button"
          className="btn btn--ghost btn--small"
          aria-expanded={expanded}
          aria-label={expanded ? "Réduire l’extrait de l’alerte" : "Afficher l’extrait complet de l’alerte"}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Réduire l’extrait" : "Afficher plus"}
        </button>
      ) : null}
      <p className="tiny muted" role="note" style={{ margin: 0 }}>
        Contenu neutralisé : texte brut, jamais interprété, jamais cliquable.
      </p>
    </Card>
  );
}

export default function AlertsRoute() {
  const resource = useResource("alerts");
  const alerts = useMemo(() => parseAlertsPayload(resource.payload), [resource.payload]);
  const layout = alertsLayout({
    count: alerts.length,
    loading: resource.loading,
    stale: resource.stale,
    error: resource.error,
    hasPayload: resource.payload !== null,
  });

  return (
    <Page>
      <p className="tiny muted" style={{ margin: 0 }}>
        Contenus hostiles détectés puis neutralisés. Ils sont affichés comme texte brut, sans lien et
        sans exécution : une alerte est une donnée, jamais une instruction.
      </p>

      {resource.error && layout !== "error" ? (
        <p className="tiny" role="status" style={{ margin: 0, color: "var(--danger-ink)" }}>
          {resource.error}
        </p>
      ) : null}

      {resource.stale && layout !== "offline-empty" ? <StaleBadge label="vérification en cache" /> : null}

      {layout === "loading" ? <Loading label="Chargement des alertes…" /> : null}

      {layout === "error" ? (
        <ErrorBox message={resource.error ?? "Lecture des alertes indisponible."}>
          <button type="button" className="btn btn--ghost btn--small" onClick={resource.refresh}>
            Réessayer
          </button>
        </ErrorBox>
      ) : null}

      {layout === "offline-empty" ? (
        <EmptyState
          icon={<IconShield />}
          title="Aucune vérification disponible"
          body="La dernière lecture n’a pas répondu et aucune alerte n’est en cache. L’absence d’alerte ne peut donc pas être affirmée : actualisez une fois connecté."
          action={
            <button type="button" className="btn btn--ghost btn--small" onClick={resource.refresh}>
              Actualiser
            </button>
          }
        />
      ) : null}

      {layout === "all-clear" ? (
        <Card
          className="stack"
          as="article"
        >
          <div className="row" style={{ alignItems: "center" }}>
            <span style={{ color: "var(--brand-deep)" }}>
              <IconCheck size={28} />
            </span>
            <div className="stack" style={{ gap: 4 }}>
              <h2 className="t-title" style={{ margin: 0 }}>
                Aucune alerte de sécurité
              </h2>
              <p className="t-body-m muted" style={{ margin: 0 }}>
                Bon signe : aucun contenu hostile n’a été signalé.
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      {layout === "list"
        ? alerts.map((alert) => <AlertCard key={alert.id} alert={alert} />)
        : null}
    </Page>
  );
}
