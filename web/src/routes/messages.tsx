import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bridge } from "../bridge/client";
import { BridgeCallError } from "../bridge/types";
import {
  ConversationListScreen,
  NewDiscussionScreen,
  ThreadScreen,
} from "../features/messages/MessagesScreen";
import {
  messagePreview,
  parseDiscussions,
  parseMessages,
  parseRecipients,
  searchDiscussions,
  sortDiscussions,
  type Discussion,
  type DiscussionMessage,
  type DiscussionRecipient,
} from "../features/messages/model";
import { useApp } from "../ui/AppContext";

type Mode = "list" | "thread" | "new";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function reportable(error: unknown, notify: (message: string, kind?: "info" | "error") => void): void {
  if (error instanceof BridgeCallError && error.code === "auth_required") {
    window.dispatchEvent(new Event("vsn:auth"));
  }
  notify(errorMessage(error, "action impossible"), "error");
}

export default function MessagesRoute() {
  const { notify, refreshTick } = useApp();
  // Entrée d’historique sentinelle : le fil et la rédaction sont des MODES de
  // /messages, pas des routes. Le retour système revient donc à la liste.
  const sentinel = useRef(0);
  const [mode, setMode] = useState<Mode>("list");
  const [threads, setThreads] = useState<Discussion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [query, setQuery] = useState("");
  const [previews, setPreviews] = useState<Record<string, string>>({});

  const [open, setOpen] = useState<Discussion | null>(null);
  const [messages, setMessages] = useState<DiscussionMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const [recipients, setRecipients] = useState<DiscussionRecipient[]>([]);
  const [recipientsLoading, setRecipientsLoading] = useState(false);
  const [recipientsError, setRecipientsError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const loadThreads = useCallback(async () => {
    setLoading(true);
    try {
      const result = await bridge.messages();
      setThreads(sortDiscussions(parseDiscussions(result.payload)));
      setError(null);
      setStale(false);
    } catch (e) {
      if (e instanceof BridgeCallError && e.code === "auth_required") {
        window.dispatchEvent(new Event("vsn:auth"));
      }
      setError(errorMessage(e, "messagerie indisponible"));
      setStale(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads, refreshTick]);

  const loadThread = useCallback(async (discussion: Discussion) => {
    setThreadLoading(true);
    setThreadError(null);
    try {
      const result = await bridge.thread(discussion.id);
      if (result.error) setThreadError(result.error);
      const parsed = parseMessages(result.payload);
      setMessages(parsed);
      const last = parsed[parsed.length - 1];
      if (last) {
        setPreviews((current) => ({ ...current, [discussion.id]: messagePreview(last.body) }));
      }
    } catch (e) {
      if (e instanceof BridgeCallError && e.code === "auth_required") {
        window.dispatchEvent(new Event("vsn:auth"));
      }
      setThreadError(errorMessage(e, "fil indisponible"));
    } finally {
      setThreadLoading(false);
    }
  }, []);

  const resetToList = useCallback(() => {
    setMode("list");
    setOpen(null);
    setMessages([]);
    setDraft("");
    setThreadError(null);
  }, []);

  /** Une entrée d’historique de plus, même URL : le retour système la consomme
   *  et l’écran reste sur /messages (le fil n’est pas une route). */
  const pushSentinel = useCallback(() => {
    try {
      window.history.pushState({ vsn: "messages-mode" }, "", window.location.href);
      sentinel.current += 1;
    } catch {
      // Historique indisponible : le bouton Retour de l’écran reste le chemin.
    }
  }, []);

  const openThread = useCallback(
    (discussion: Discussion) => {
      pushSentinel();
      setOpen(discussion);
      setMode("thread");
      setMessages([]);
      setDraft("");
      void loadThread(discussion);
    },
    [loadThread, pushSentinel],
  );

  const backToList = useCallback(() => {
    const hadSentinel = sentinel.current > 0;
    sentinel.current = 0;
    resetToList();
    if (hadSentinel) window.history.back();
  }, [resetToList]);

  // Le retour système (PopState) consomme la sentinelle : on retombe sur la
  // liste, sans quitter l’onglet. Le bouton Retour de l’écran fait de même.
  useEffect(() => {
    if (mode === "list") return;
    const onPop = () => {
      sentinel.current = 0;
      resetToList();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [mode, resetToList]);

  const setRead = useCallback(
    async (discussion: Discussion, read: boolean) => {
      try {
        const result = await bridge.setRead(discussion.id, read);
        if (!result.ok) {
          notify(result.error || "État de lecture refusé.", "error");
          return;
        }
        setOpen((current) =>
          current && current.id === discussion.id
            ? { ...current, unreadCount: read ? 0 : Math.max(current.unreadCount, 1) }
            : current,
        );
        notify(read ? "Discussion marquée comme lue." : "Discussion marquée comme non lue.");
        await loadThreads();
      } catch (e) {
        reportable(e, notify);
      }
    },
    [loadThreads, notify],
  );

  const reply = useCallback(async () => {
    if (!open) return;
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      const result = await bridge.reply(open.id, body);
      if (!result.ok) {
        notify(result.error || "Réponse impossible.", "error");
        return;
      }
      setDraft("");
      notify("Message envoyé.");
      await loadThread(open);
      await loadThreads();
    } catch (e) {
      reportable(e, notify);
    } finally {
      setSending(false);
    }
  }, [draft, loadThread, loadThreads, notify, open]);

  const remove = useCallback(async () => {
    if (!open) return;
    const subject = open.subject;
    try {
      const result = await bridge.deleteMessage(open.id);
      if (!result.ok) {
        notify(result.error || "Suppression impossible.", "error");
        return;
      }
      notify(`« ${subject} » supprimée.`);
      backToList();
      await loadThreads();
    } catch (e) {
      reportable(e, notify);
    }
  }, [backToList, loadThreads, notify, open]);

  const startNew = useCallback(async () => {
    pushSentinel();
    setMode("new");
    setRecipients([]);
    setRecipientsError(null);
    setRecipientsLoading(true);
    try {
      const result = await bridge.recipients();
      setRecipients(parseRecipients(result.payload));
    } catch (e) {
      if (e instanceof BridgeCallError && e.code === "auth_required") {
        window.dispatchEvent(new Event("vsn:auth"));
      }
      setRecipientsError(errorMessage(e, "destinataires indisponibles"));
    } finally {
      setRecipientsLoading(false);
    }
  }, [pushSentinel]);

  const create = useCallback(
    async (subject: string, body: string, picked: string[]) => {
      setCreating(true);
      try {
        const result = await bridge.createMessage(picked, subject, body);
        if (!result.ok) {
          notify(result.error || "Création impossible.", "error");
          return;
        }
        notify("Discussion envoyée.");
        backToList();
        await loadThreads();
      } catch (e) {
        reportable(e, notify);
      } finally {
        setCreating(false);
      }
    },
    [backToList, loadThreads, notify],
  );

  const visible = useMemo(() => searchDiscussions(threads, query), [threads, query]);

  if (mode === "new") {
    return (
      <NewDiscussionScreen
        recipients={recipients}
        loading={recipientsLoading}
        error={recipientsError}
        sending={creating}
        onBack={backToList}
        onRetry={() => void startNew()}
        onCreate={(subject, body, picked) => void create(subject, body, picked)}
      />
    );
  }

  if (mode === "thread" && open) {
    return (
      <ThreadScreen
        discussion={open}
        messages={messages}
        loading={threadLoading}
        error={threadError}
        draft={draft}
        sending={sending}
        onDraftChange={setDraft}
        onReply={() => void reply()}
        onBack={backToList}
        onToggleRead={() => void setRead(open, open.unreadCount !== 0)}
        onDelete={() => void remove()}
        onRefresh={() => void loadThread(open)}
      />
    );
  }

  return (
    <ConversationListScreen
      discussions={visible}
      query={query}
      loading={loading}
      error={error}
      stale={stale}
      previews={previews}
      onQueryChange={setQuery}
      onOpen={openThread}
      onMarkRead={(discussion) => void setRead(discussion, true)}
      onNew={() => void startNew()}
      onRefresh={() => void loadThreads()}
    />
  );
}
