import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Avatar,
  Card,
  EmptyState,
  ErrorBox,
  Loading,
  Page,
  SearchField,
  StaleBadge,
} from "../../ui/components";
import { Dialog } from "../../ui/Dialog";
import {
  IconChevronDown,
  IconMessage,
  IconPlus,
  IconSend,
  IconTrash,
  IconWarning,
} from "../../ui/icons";
import { useStickToBottom } from "../../ui/useStickToBottom";
import {
  conversationCountLabel,
  conversationDateLabel,
  formatDateTime,
  groupRecipients,
  isOwnMessage,
  MESSAGE_WINDOW,
  nextMessageWindow,
  pickedCountLabel,
  recipientMatches,
  remainingMessages,
  visibleMessages,
  type Discussion,
  type DiscussionMessage,
  type DiscussionRecipient,
  type RecipientGroup,
} from "./model";

interface ListProps {
  discussions: Discussion[];
  query: string;
  loading: boolean;
  error: string | null;
  stale: boolean;
  previews: Record<string, string>;
  onQueryChange: (query: string) => void;
  onOpen: (discussion: Discussion) => void;
  onMarkRead: (discussion: Discussion) => void;
  onNew: () => void;
  onRefresh: () => void;
  onVisible?: (ids: string[]) => void;
}

export function ConversationListScreen({
  discussions,
  query,
  loading,
  error,
  stale,
  previews,
  onQueryChange,
  onOpen,
  onMarkRead,
  onNew,
  onRefresh,
  onVisible,
}: ListProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Enrichissement VISIBLE : seules les lignes qui croisent la fenêtre sont
  // candidates ; la route borne chaque lot et ne redemande jamais un fil déjà vu.
  useEffect(() => {
    if (!onVisible || typeof IntersectionObserver === "undefined") return;
    const root = listRef.current;
    if (!root) return;
    const seen = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        let changed = false;
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.discussionId;
          if (!id || !entry.isIntersecting || seen.has(id)) continue;
          seen.add(id);
          changed = true;
        }
        if (changed) onVisible([...seen]);
      },
      { rootMargin: "0px 0px 160px 0px" },
    );
    for (const row of root.querySelectorAll<HTMLElement>("[data-discussion-id]")) {
      observer.observe(row);
    }
    return () => observer.disconnect();
  }, [discussions, onVisible]);

  return (
    <div className="stack">
      <div className="row row--wrap">
        <span className="grow t-body-m muted">{conversationCountLabel(discussions.length)}</span>
        {stale ? <StaleBadge /> : null}
        <button type="button" className="btn btn--ghost btn--small" onClick={onNew}>
          <IconPlus size={18} />
          Nouvelle discussion
        </button>
      </div>

      <SearchField
        value={query}
        onChange={onQueryChange}
        placeholder="Rechercher une discussion"
        label="Rechercher une discussion"
      />

      {error ? (
        <ErrorBox message={error}>
          <button type="button" className="btn btn--small" onClick={onRefresh}>
            Réessayer
          </button>
        </ErrorBox>
      ) : null}

      {loading && discussions.length === 0 ? (
        <Loading label="Chargement des discussions…" />
      ) : discussions.length === 0 ? (
        // Avec une erreur, la liste n'est pas connue comme vide (I14).
        error ? null : (
          <EmptyState
            icon={<IconMessage size={30} />}
            title={query.trim() ? "Aucune discussion ne correspond." : "Aucune discussion."}
            body={
              query.trim()
                ? "Aucun sujet ne porte ces mots."
                : "L’établissement n’a publié aucune discussion."
            }
            action={
              query.trim() ? (
                <button type="button" className="btn btn--small" onClick={() => onQueryChange("")}>
                  Effacer la recherche
                </button>
              ) : (
                <button type="button" className="btn btn--small" onClick={onRefresh}>
                  Actualiser
                </button>
              )
            }
          />
        )
      ) : (
        <div className="list" ref={listRef}>
          {discussions.map((discussion) => {
            const unread = Math.max(discussion.unreadCount, 0);
            const date = conversationDateLabel(discussion);
            const preview = previews[discussion.id] || discussion.participants.join(", ");
            return (
              <div key={discussion.id} data-discussion-id={discussion.id}>
                <Card as="article" className="card--flat messages-card">
                  <div className="messages-card__row">
                    <button
                      type="button"
                      className="messages-card__open"
                      onClick={() => onOpen(discussion)}
                    >
                      <Avatar name={discussion.subject} size={40} />
                      <span className="messages-card__text">
                        <span
                          className={`messages-card__name${
                            unread > 0 ? " messages-card__name--unread" : ""
                          }`}
                        >
                          {discussion.subject}
                        </span>
                        {date ? <span className="messages-card__date">{date}</span> : null}
                        {preview ? <span className="messages-card__preview">{preview}</span> : null}
                      </span>
                    </button>
                    {unread > 0 ? (
                      <button
                        type="button"
                        className="chip chip--active messages-card__unread"
                        aria-label={`${unread} message${unread > 1 ? "s" : ""} non lu${
                          unread > 1 ? "s" : ""
                        }, marquer comme lu`}
                        onClick={() => onMarkRead(discussion)}
                      >
                        {unread}
                      </button>
                    ) : null}
                  </div>
                </Card>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface ThreadProps {
  discussion: Discussion;
  messages: DiscussionMessage[];
  loading: boolean;
  error: string | null;
  draft: string;
  sending: boolean;
  onDraftChange: (value: string) => void;
  onReply: () => void;
  onToggleRead: () => void;
  onDelete: () => void;
  onRefresh: () => void;
  /** Total du fil annoncé par le pont ; absent = fenêtre locale (#966). */
  total?: number;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
}

export function ThreadScreen({
  discussion,
  messages,
  loading,
  error,
  draft,
  sending,
  onDraftChange,
  onReply,
  onToggleRead,
  onDelete,
  onRefresh,
  total,
  loadingOlder = false,
  onLoadOlder,
}: ThreadProps) {
  const titleId = useId();
  const logId = useId();
  const [confirming, setConfirming] = useState(false);
  const [windowLimit, setWindowLimit] = useState(MESSAGE_WINDOW);
  const olderAnchor = useRef<{ top: number; height: number } | null>(null);
  const focusOlderEnd = useRef(false);
  const olderEndRef = useRef<HTMLParagraphElement>(null);
  const replyId = useId();
  const read = discussion.unreadCount === 0;
  const paged = typeof total === "number";
  // Le fil s'ouvre sur le dernier message et reste collé tant que l'élève est
  // en bas ; remonter dans l'historique ne vole pas le scroll.
  const { ref: logRef, onScroll, away, toBottom } = useStickToBottom([
    messages.length,
    loading,
  ]);

  // Changer de fil repart de la fenêtre récente, jamais de l'historique déplié
  // du fil précédent.
  useEffect(() => {
    setWindowLimit(MESSAGE_WINDOW);
    olderAnchor.current = null;
    focusOlderEnd.current = false;
  }, [discussion.id]);

  const visible = paged ? messages : visibleMessages(messages, windowLimit);
  const hiddenCount = paged
    ? remainingMessages(total ?? messages.length, messages.length)
    : messages.length - visible.length;

  const loadOlder = () => {
    const box = logRef.current;
    if (box) olderAnchor.current = { top: box.scrollTop, height: box.scrollHeight };
    if (paged) {
      onLoadOlder?.();
      return;
    }
    const next = nextMessageWindow(windowLimit, messages.length);
    focusOlderEnd.current = next >= messages.length;
    setWindowLimit(next);
  };

  // Les messages anciens s'ajoutent AU-DESSUS : conserver le message lu sous
  // les yeux, sans réveiller l'ancrage automatique du fil.
  useLayoutEffect(() => {
    const box = logRef.current;
    const anchor = olderAnchor.current;
    if (box && anchor) {
      box.scrollTop = anchor.top + (box.scrollHeight - anchor.height);
      olderAnchor.current = null;
    }
    if (!paged && focusOlderEnd.current) {
      focusOlderEnd.current = false;
      olderEndRef.current?.focus({ preventScroll: true });
    }
  }, [windowLimit, messages.length, paged]);

  return (
    <Page className="messages-thread">
      <div className="messages-thread__head">
        <div className="row" style={{ alignItems: "center" }}>
          <div className="grow" style={{ minWidth: 0 }}>
            <h2 className="t-title" id={titleId} style={{ margin: 0 }}>
              {discussion.subject}
            </h2>
            {discussion.participants.length > 0 ? (
              <p className="tiny muted" style={{ margin: 0 }}>
                {discussion.participants.join(", ")}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Supprimer la discussion"
            onClick={() => setConfirming(true)}
          >
            <IconTrash />
          </button>
        </div>

        <div className="row row--wrap">
          <button type="button" className="btn btn--ghost btn--small" onClick={onToggleRead}>
            {read ? "Marquer non lu" : "Marquer lu"}
          </button>
        </div>

        {hiddenCount > 0 ? (
          <div className="row" style={{ justifyContent: "center" }}>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              aria-controls={logId}
              aria-busy={loadingOlder}
              disabled={loadingOlder}
              onClick={loadOlder}
            >
              {loadingOlder
                ? "Chargement des messages plus anciens…"
                : `Charger les messages plus anciens (${hiddenCount})`}
            </button>
          </div>
        ) : (total ?? messages.length) > MESSAGE_WINDOW ? (
          <p
            ref={olderEndRef}
            tabIndex={-1}
            className="tiny muted"
            style={{ margin: 0, textAlign: "center" }}
          >
            Tous les messages sont affichés.
          </p>
        ) : null}

        {error ? (
          <ErrorBox message={error}>
            <button type="button" className="btn btn--small" onClick={onRefresh}>
              Réessayer
            </button>
          </ErrorBox>
        ) : null}
      </div>

      <div className="ai-log-wrap messages-thread__log-wrap">
        <div
          ref={logRef}
          id={logId}
          className="messages-log"
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-label={`Messages — ${discussion.subject}`}
          onScroll={onScroll}
        >
          {loading ? (
            <Loading label="Chargement du fil…" />
          ) : messages.length === 0 ? (
            // Avec une erreur, le fil n'est pas connu comme vide : l'état vide serait un fait faux.
            error ? null : (
              <EmptyState icon={<IconMessage size={30} />} title="Aucun message." body="Ce fil est vide." />
            )
          ) : (
            visible.map((message) => <MessageBubble key={message.id} message={message} />)
          )}
        </div>
        {away ? (
          <button type="button" className="ai-jump" onClick={toBottom}>
            Dernier message
            <IconChevronDown size={16} />
          </button>
        ) : null}
      </div>

      <div className="messages-composer">
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="grow">
            <label className="sr-only" htmlFor={replyId}>
              Répondre
            </label>
            <textarea
              id={replyId}
              className="field"
              placeholder="Répondre"
              value={draft}
              maxLength={4000}
              onChange={(event) => onDraftChange(event.target.value)}
            />
          </div>
          <button
            type="button"
            className="icon-btn icon-btn--accent"
            aria-label={sending ? "Envoi en cours" : "Envoyer"}
            disabled={sending || draft.trim() === ""}
            onClick={() => {
              toBottom();
              onReply();
            }}
          >
            <IconSend />
          </button>
        </div>
      </div>

      {confirming ? (
        <ConfirmDeleteDialog
          subject={discussion.subject}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onDelete();
          }}
        />
      ) : null}
    </Page>
  );
}

function MessageBubble({ message }: { message: DiscussionMessage }) {
  const own = isOwnMessage(message);
  const time = formatDateTime(message.sentAt);
  return (
    <div style={{ display: "flex", justifyContent: own ? "flex-end" : "flex-start" }}>
      <div
        className="card card--flat"
        style={{
          maxWidth: "85%",
          padding: "10px 12px",
          background: own ? "var(--brand-pale)" : "var(--surface-variant)",
          textAlign: own ? "right" : "left",
        }}
      >
        {message.authorName ? (
          <p className="tiny" style={{ margin: 0, fontWeight: 700, overflowWrap: "anywhere" }}>
            {message.authorName}
          </p>
        ) : null}
        <p className="t-body-m" style={{ margin: "4px 0 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {message.body}
        </p>
        {message.attachments.length > 0 ? (
          <div className="row row--wrap" style={{ gap: 6, marginTop: 6 }}>
            {message.attachments.map((attachment) => (
              <span key={attachment.id} className="chip tiny" title={attachment.label}>
                {attachment.label}
              </span>
            ))}
          </div>
        ) : null}
        {time ? (
          <p className="tiny muted" style={{ margin: "4px 0 0" }}>
            {time}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ConfirmDeleteDialog({
  subject,
  onConfirm,
  onCancel,
}: {
  subject: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open
      role="alertdialog"
      title="Supprimer la discussion"
      description={`« ${subject} » sera supprimée. Cette action est définitive.`}
      icon={<IconWarning />}
      onClose={onCancel}
      actions={
        <>
          <button type="button" className="btn btn--ghost btn--small" data-autofocus onClick={onCancel}>
            Annuler
          </button>
          <button type="button" className="btn btn--danger btn--small" onClick={onConfirm}>
            Supprimer
          </button>
        </>
      }
    />
  );
}

interface NewProps {
  recipients: DiscussionRecipient[];
  loading: boolean;
  error: string | null;
  sending: boolean;
  onRetry: () => void;
  onCreate: (subject: string, body: string, recipients: string[]) => void;
}

export function NewDiscussionScreen({ recipients, loading, error, sending, onRetry, onCreate }: NewProps) {
  const subjectId = useId();
  const bodyId = useId();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  const groups: RecipientGroup[] = groupRecipients(recipients.filter((r) => recipientMatches(r, query)));
  const canSend = subject.trim() !== "" && body.trim() !== "" && picked.length > 0 && !sending;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSend) return;
    onCreate(subject.trim(), body.trim(), picked);
  };

  return (
    <form className="stack" onSubmit={submit}>
      <h2 className="t-title" style={{ margin: 0 }}>
        Nouvelle discussion
      </h2>

      <div>
        <label className="tiny muted" htmlFor={subjectId}>
          Objet
        </label>
        <input
          id={subjectId}
          className="field"
          value={subject}
          maxLength={200}
          onChange={(event) => setSubject(event.target.value)}
        />
      </div>

      <div>
        <label className="tiny muted" htmlFor={bodyId}>
          Message
        </label>
        <textarea
          id={bodyId}
          className="field field--area"
          value={body}
          maxLength={4000}
          onChange={(event) => setBody(event.target.value)}
        />
      </div>

      <SearchField
        value={query}
        onChange={setQuery}
        placeholder="Rechercher un destinataire"
        label="Rechercher un destinataire"
      />

      {error ? (
        <ErrorBox message={error}>
          <button type="button" className="btn btn--small" onClick={onRetry}>
            Réessayer
          </button>
        </ErrorBox>
      ) : null}

      {loading ? (
        <Loading label="Chargement des destinataires…" />
      ) : recipients.length === 0 ? (
        // Un échec ou un payload illisible n'est pas « personne publié » (I14).
        error ? null : (
          <EmptyState
            icon={<IconMessage size={30} />}
            title="Aucun destinataire publié par l’établissement."
            body="La messagerie est active, mais l’établissement ne publie personne."
          />
        )
      ) : groups.length === 0 ? (
        error ? null : (
          <EmptyState
            icon={<IconMessage size={30} />}
            title="Aucun destinataire ne correspond."
            body="Aucun nom ne porte ces mots."
            action={
              <button type="button" className="btn btn--small" onClick={() => setQuery("")}>
                Effacer la recherche
              </button>
            }
          />
        )
      ) : (
        <div className="stack">
          {groups.map((group) => (
            <section key={group.kind || "unknown"}>
              <h3 className="t-title-m muted" style={{ margin: "0 0 8px" }}>
                {group.label} · {group.recipients.length}
              </h3>
              <div className="row row--wrap" style={{ gap: 6 }}>
                {group.recipients.map((recipient) => {
                  const on = picked.includes(recipient.id);
                  return (
                    <button
                      key={recipient.id}
                      type="button"
                      className={`chip${on ? " chip--active" : ""}`}
                      aria-pressed={on}
                      onClick={() =>
                        setPicked((current) =>
                          current.includes(recipient.id)
                            ? current.filter((id) => id !== recipient.id)
                            : [...current, recipient.id],
                        )
                      }
                    >
                      {recipient.displayName}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <div className="row" style={{ justifyContent: "flex-end" }}>
        <span className="tiny muted grow">{pickedCountLabel(picked.length)}</span>
        <button type="submit" className="btn" disabled={!canSend}>
          {sending ? "Envoi…" : "Envoyer"}
        </button>
      </div>
    </form>
  );
}
