import { useId, useState } from "react";
import type { FormEvent } from "react";
import { Avatar, Card, EmptyState, ErrorBox, Loading, StaleBadge } from "../../ui/components";
import { IconBack, IconMessage, IconPlus, IconRefresh, IconSend, IconTrash, IconWarning } from "../../ui/icons";
import {
  conversationCountLabel,
  conversationDateLabel,
  formatDateTime,
  groupRecipients,
  isOwnMessage,
  pickedCountLabel,
  recipientMatches,
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
}: ListProps) {
  const searchId = useId();
  return (
    <div className="stack">
      <div className="row row--wrap">
        <span className="grow t-body-m muted">{conversationCountLabel(discussions.length)}</span>
        {stale ? <StaleBadge /> : null}
        <button type="button" className="btn btn--ghost btn--small" style={{ minHeight: 48 }} onClick={onNew}>
          <IconPlus size={18} />
          Nouvelle
        </button>
      </div>

      <div>
        <label className="sr-only" htmlFor={searchId}>
          Rechercher une discussion
        </label>
        <input
          id={searchId}
          className="field"
          type="search"
          placeholder="Rechercher une discussion"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>

      {error ? (
        <ErrorBox message={error}>
          <button type="button" className="btn btn--ghost btn--small" style={{ minHeight: 48 }} onClick={onRefresh}>
            Réessayer
          </button>
        </ErrorBox>
      ) : null}

      {loading && discussions.length === 0 ? (
        <Loading label="Chargement des discussions…" />
      ) : discussions.length === 0 ? (
        <EmptyState
          icon={<IconMessage size={30} />}
          title={query.trim() ? "Aucune discussion ne correspond." : "Aucune discussion."}
          body={
            query.trim()
              ? "Aucun sujet ni participant ne porte ces mots."
              : "L’établissement n’a publié aucune discussion."
          }
          action={
            <button type="button" className="btn btn--ghost btn--small" style={{ minHeight: 48 }} onClick={onRefresh}>
              Actualiser
            </button>
          }
        />
      ) : (
        <div className="list">
          {discussions.map((discussion) => {
            const unread = Math.max(discussion.unreadCount, 0);
            return (
              <Card key={discussion.id} as="article" className="card--flat">
                <div className="row" style={{ alignItems: "stretch", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => onOpen(discussion)}
                    aria-label={`Ouvrir la discussion « ${discussion.subject} »`}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      minHeight: 48,
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      border: 0,
                      background: "transparent",
                      textAlign: "left",
                      padding: 0,
                      color: "inherit",
                    }}
                  >
                    <Avatar name={discussion.subject} size={40} />
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span
                        className="t-body"
                        style={{
                          display: "block",
                          fontWeight: unread > 0 ? 800 : 600,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {discussion.subject}
                      </span>
                      <span
                        className="tiny muted"
                        style={{
                          display: "block",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {previews[discussion.id] || discussion.participants.join(", ")}
                      </span>
                    </span>
                  </button>
                  <span
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      gap: 4,
                      flex: "0 0 auto",
                    }}
                  >
                    <span className="tiny muted" style={{ textAlign: "right" }}>
                      {conversationDateLabel(discussion)}
                    </span>
                    {unread > 0 ? (
                      <button
                        type="button"
                        className="chip chip--active"
                        style={{ minHeight: 48, minWidth: 48, justifyContent: "center" }}
                        aria-label={`${unread} message${unread > 1 ? "s" : ""} non lu${
                          unread > 1 ? "s" : ""
                        }, marquer comme lu`}
                        onClick={() => onMarkRead(discussion)}
                      >
                        {unread}
                      </button>
                    ) : null}
                  </span>
                </div>
              </Card>
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
  onBack: () => void;
  onToggleRead: () => void;
  onDelete: () => void;
  onRefresh: () => void;
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
  onBack,
  onToggleRead,
  onDelete,
  onRefresh,
}: ThreadProps) {
  const titleId = useId();
  const [confirming, setConfirming] = useState(false);
  const replyId = useId();
  const read = discussion.unreadCount === 0;

  return (
    <div className="stack">
      <div className="row" style={{ alignItems: "center" }}>
        <button type="button" className="icon-btn" aria-label="Retour à la liste des discussions" onClick={onBack}>
          <IconBack />
        </button>
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
        <button type="button" className="icon-btn" aria-label="Supprimer la discussion" onClick={() => setConfirming(true)}>
          <IconTrash />
        </button>
      </div>

      <div className="row row--wrap">
        <button type="button" className="icon-btn" aria-label="Actualiser le fil" onClick={onRefresh}>
          <IconRefresh />
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--small"
          style={{ minHeight: 48 }}
          onClick={onToggleRead}
        >
          {read ? "Marquer non lu" : "Marquer lu"}
        </button>
      </div>

      {error ? (
        <ErrorBox message={error}>
          <button type="button" className="btn btn--ghost btn--small" style={{ minHeight: 48 }} onClick={onRefresh}>
            Réessayer
          </button>
        </ErrorBox>
      ) : null}

      {loading ? (
        <Loading label="Chargement du fil…" />
      ) : messages.length === 0 ? (
        <EmptyState icon={<IconMessage size={30} />} title="Aucun message." body="Ce fil est vide." />
      ) : (
        <div className="list" aria-labelledby={titleId}>
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
        </div>
      )}

      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="grow">
          <label className="sr-only" htmlFor={replyId}>
            Répondre
          </label>
          <textarea
            id={replyId}
            className="field"
            style={{ minHeight: 64 }}
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
          onClick={onReply}
        >
          <IconSend />
        </button>
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
    </div>
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
  const titleId = useId();
  const bodyId = useId();
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(0, 0, 0, 0.45)",
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <div
        className="card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        style={{ maxWidth: 440, width: "100%" }}
      >
        <div className="row" style={{ alignItems: "flex-start" }}>
          <span style={{ color: "var(--danger-ink)" }}>
            <IconWarning />
          </span>
          <div className="grow">
            <h2 className="t-title" id={titleId} style={{ margin: 0 }}>
              Supprimer la discussion
            </h2>
            <p className="t-body-m muted" id={bodyId} style={{ margin: "6px 0 0" }}>
              « {subject} » sera supprimée. Cette action est définitive.
            </p>
          </div>
        </div>
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" className="btn btn--ghost" autoFocus onClick={onCancel}>
            Annuler
          </button>
          <button type="button" className="btn btn--danger" onClick={onConfirm}>
            Supprimer
          </button>
        </div>
      </div>
    </div>
  );
}

interface NewProps {
  recipients: DiscussionRecipient[];
  loading: boolean;
  error: string | null;
  sending: boolean;
  onBack: () => void;
  onRetry: () => void;
  onCreate: (subject: string, body: string, recipients: string[]) => void;
}

export function NewDiscussionScreen({ recipients, loading, error, sending, onBack, onRetry, onCreate }: NewProps) {
  const subjectId = useId();
  const bodyId = useId();
  const searchId = useId();
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
      <div className="row">
        <button type="button" className="icon-btn" aria-label="Retour à la liste des discussions" onClick={onBack}>
          <IconBack />
        </button>
        <h2 className="t-title grow" style={{ margin: 0 }}>
          Nouvelle discussion
        </h2>
      </div>

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

      <div>
        <label className="tiny muted" htmlFor={searchId}>
          Rechercher un destinataire
        </label>
        <input
          id={searchId}
          className="field"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {error ? (
        <ErrorBox message={error}>
          <button type="button" className="btn btn--ghost btn--small" style={{ minHeight: 48 }} onClick={onRetry}>
            Réessayer
          </button>
        </ErrorBox>
      ) : null}

      {loading ? (
        <Loading label="Chargement des destinataires…" />
      ) : recipients.length === 0 ? (
        <EmptyState
          icon={<IconMessage size={30} />}
          title="Aucun destinataire publié par l’établissement."
          body="La messagerie est active, mais l’établissement ne publie personne."
        />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<IconMessage size={30} />}
          title="Aucun destinataire ne correspond."
          body="Aucun nom ne porte ces mots."
        />
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
                      style={{ minHeight: 48 }}
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
