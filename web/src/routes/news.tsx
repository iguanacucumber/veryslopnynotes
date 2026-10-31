import { useMemo, useState } from "react";
import { bridge } from "../bridge/client";
import { useResource } from "../ui/AppContext";
import { Card, EmptyState, ErrorBox, Loading, Page, Section, StaleBadge } from "../ui/components";
import { IconNews } from "../ui/icons";
import {
  needsNewsBody,
  newsBodyCollapsible,
  newsBodyFailed,
  newsBodyLoaded,
  newsBodyLoading,
  newsBodyState,
  newsBodyText,
  newsByline,
  newsGroups,
  parseNewsPayload,
  type NewsItem,
} from "../features/news/news";
import { loadNewsReadIds, markNewsRead } from "../features/news/readState";

function NewsCard({
  item,
  read,
  onMarkRead,
}: {
  item: NewsItem;
  read: boolean;
  onMarkRead: (id: string, title: string) => void;
}) {
  // Le corps arrive À LA DEMANDE (au dépliage) ; un corps déjà en cache
  // s'affiche tel quel.
  const [body, setBody] = useState(() => newsBodyState(item.body));
  const [expanded, setExpanded] = useState(false);
  const collapsible = newsBodyCollapsible(body);
  const text = newsBodyText(body, expanded);
  const byline = newsByline(item);

  const load = () => {
    if (!needsNewsBody(body)) return;
    setBody(newsBodyLoading(body));
    void bridge.newsItem(item.id).then(
      (result) => {
        setBody(newsBodyLoaded(body, typeof result?.body === "string" ? result.body : ""));
        setExpanded(true);
      },
      () => setBody(newsBodyFailed(body)),
    );
  };

  return (
    <Card as="article" className={`stack news-card${read ? "" : " news-card--unread"}`}>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <h3 className="t-title grow" style={{ margin: 0 }}>
          {item.title}
        </h3>
        {!read ? <span className="chip chip--active">Non lue</span> : null}
      </div>
      {byline ? (
        <p className="tiny muted" style={{ margin: 0 }}>
          {byline}
        </p>
      ) : null}
      {text ? (
        <p className="t-body-m" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
          {text}
        </p>
      ) : null}
      <div className="news-card__actions">
        {needsNewsBody(body) ? (
          <button
            type="button"
            className="btn btn--ghost btn--small"
            aria-label={`Lire l’actualité « ${item.title} »`}
            onClick={load}
          >
            Lire le texte
          </button>
        ) : null}
        {body.status === "loading" ? (
          <p className="tiny muted" role="status" style={{ margin: 0 }}>
            Chargement du texte…
          </p>
        ) : null}
        {body.error ? (
          <p className="tiny" role="status" style={{ margin: 0, color: "var(--danger-ink)" }}>
            {body.error}
          </p>
        ) : null}
        {collapsible ? (
          <button
            type="button"
            className="btn btn--ghost btn--small"
            aria-expanded={expanded}
            aria-label={`${expanded ? "Réduire" : "Lire la suite de"} l’actualité « ${item.title} »`}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Réduire le texte" : "Lire la suite"}
          </button>
        ) : null}
        {!read ? (
          <button
            type="button"
            className="btn btn--ghost btn--small"
            aria-label={`Marquer l’actualité « ${item.title} » comme lue`}
            onClick={() => onMarkRead(item.id, item.title)}
          >
            Marquer comme lue
          </button>
        ) : null}
      </div>
    </Card>
  );
}

export default function NewsRoute() {
  const resource = useResource("news");
  const items = useMemo(() => parseNewsPayload(resource.payload), [resource.payload]);
  const groups = useMemo(() => newsGroups(items), [items]);
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(() => loadNewsReadIds());
  const [announcement, setAnnouncement] = useState("");

  const markRead = (id: string, title: string) => {
    setReadIds(markNewsRead(id));
    setAnnouncement(`Actualité « ${title} » marquée comme lue.`);
  };

  return (
    <Page>
      <p className="sr-only" role="status">
        {announcement}
      </p>
      {resource.stale ? (
        <div className="row row--between">
          <span className="tiny muted">Dernières actualités en cache.</span>
          <StaleBadge />
        </div>
      ) : null}
      {resource.error && items.length > 0 ? (
        <p className="tiny" role="status" style={{ margin: 0, color: "var(--danger-ink)" }}>
          {resource.error}
        </p>
      ) : null}

      {items.length === 0 && resource.loading ? <Loading label="Chargement des actualités…" /> : null}

      {items.length === 0 && !resource.loading && resource.error ? (
        <ErrorBox message={resource.error}>
          <button type="button" className="btn btn--small" onClick={resource.refresh}>
            Réessayer
          </button>
        </ErrorBox>
      ) : null}

      {items.length === 0 && !resource.loading && !resource.error ? (
        <EmptyState
          icon={<IconNews size={30} />}
          title="Aucune actualité"
          body="L’établissement n’a rien publié pour le moment."
          action={
            <button type="button" className="btn btn--small" onClick={resource.refresh}>
              Actualiser
            </button>
          }
        />
      ) : null}

      {groups.map((group) => (
        <Section key={group.category} title={group.category}>
          <div className="stack">
            {group.items.map((item) => (
              <NewsCard
                key={item.id}
                item={item}
                read={item.read || readIds.has(item.id)}
                onMarkRead={markRead}
              />
            ))}
          </div>
        </Section>
      ))}
    </Page>
  );
}
