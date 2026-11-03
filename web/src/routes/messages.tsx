import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { bridge } from "../bridge/client";
import { BridgeCallError } from "../bridge/types";
import {
  ConversationListScreen,
  NewDiscussionScreen,
  ThreadScreen,
} from "../features/messages/MessagesScreen";
import {
  isMessagesPayloadReadable,
  mergeEnrichedDiscussions,
  mergeOlderMessages,
  messagePreview,
  nextEnrichBatch,
  parseDiscussions,
  parseEnrichedDiscussions,
  parseMessages,
  parseParticipants,
  parseRecipients,
  searchDiscussions,
  sortDiscussions,
  threadPageStart,
  threadPageTotal,
  type Discussion,
  type DiscussionMessage,
  type DiscussionRecipient,
  type EnrichedDiscussion,
} from "../features/messages/model";
import { createReplyGuard, draftAfterReply } from "../features/messages/reply";
import { ErrorBox, Loading } from "../ui/components";
import { useApp } from "../ui/AppContext";
import { useViewNavigate } from "../ui/viewTransition";
import { failureCause, type FreshnessCause } from "../lib/freshness";
import { createSeq } from "../lib/seq";
import "../features/messages/messages.css";

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
  const { id } = useParams();
  const location = useLocation();
  const go = useViewNavigate();
  // Fil et rédaction sont des SOUS-ROUTES : le retour système et la flèche de
  // la coquille visent la même URL, sans sentinelle d'historique.
  const composing = location.pathname === "/messages/new";
  const mode: Mode = composing ? "new" : id ? "thread" : "list";

  const [threads, setThreads] = useState<Discussion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [cause, setCause] = useState<FreshnessCause | null>(null);
  const [query, setQuery] = useState("");
  const [previews, setPreviews] = useState<Record<string, string>>({});

  const [messages, setMessages] = useState<DiscussionMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [threadTotal, setThreadTotal] = useState(0);
  const [threadStart, setThreadStart] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const [recipients, setRecipients] = useState<DiscussionRecipient[]>([]);
  const [recipientsLoading, setRecipientsLoading] = useState(false);
  const [recipientsError, setRecipientsError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // La liste porte les métadonnées du fil (objet, participants) : un lien
  // direct ou une restauration Android retrouve le fil sans état de navigation.
  const open = useMemo(() => (id ? threads.find((d) => d.id === id) ?? null : null), [id, threads]);

  // Une réponse PÉRIMÉE est ignorée : sinon les messages du fil A s'affichent
  // sous l'en-tête du fil B (A répond après B).
  const threadsSeq = useRef(createSeq());
  const threadSeq = useRef(createSeq());
  const olderSeq = useRef(createSeq());
  const enrichSeq = useRef(createSeq());
  const loadedThread = useRef<string | null>(null);
  // Fils déjà enrichis (ou en vol) et dates connues : une ligne ne redemande
  // jamais son enrichissement tant que la liste vit.
  const enrichedIds = useRef(new Set<string>());
  const enrichingIds = useRef(new Set<string>());
  const enrichedDates = useRef(new Map<string, EnrichedDiscussion>());

  // La réponse d'un envoi n'écrit que dans le fil OUVERT à l'envoi : une
  // réponse périmée ne doit ni changer de fil ni effacer le brouillon.
  const replyGuard = useRef(createReplyGuard());
  const threadRefresh = useRef(refreshTick);

  const loadThreads = useCallback(async () => {
    const seq = threadsSeq.current.next();
    setLoading(true);
    try {
      const result = await bridge.messages();
      if (!threadsSeq.current.isCurrent(seq)) return;
      const parsed = parseDiscussions(result.payload);
      // La liste porte déjà les dates de la fenêtre initiale : elles nourrissent
      // le cache local, puis les fils enrichis au défilement les rejoignent.
      for (const d of parsed) {
        if (!d.lastMessageAt && !d.updatedAt) continue;
        enrichedIds.current.add(d.id);
        enrichedDates.current.set(d.id, {
          id: d.id,
          lastMessageAt: d.lastMessageAt,
          updatedAt: d.updatedAt,
        });
      }
      setThreads(
        sortDiscussions(mergeEnrichedDiscussions(parsed, [...enrichedDates.current.values()])),
      );
      // Un payload illisible n'est pas « aucune discussion » (I14) ; un échec
      // non-session avec cache est signalé par le pont.
      setError(
        isMessagesPayloadReadable(result.payload)
          ? (result.error ?? null)
          : "Discussions illisibles : la donnée n’a pas pu être lue.",
      );
      const reported = result.error ?? null;
      setStale(result.stale ?? Boolean(reported));
      setFetchedAt(result.fetchedAt ?? 0);
      setCause(failureCause(reported, undefined, result.cause ?? null));
    } catch (e) {
      if (!threadsSeq.current.isCurrent(seq)) return;
      if (e instanceof BridgeCallError && e.code === "auth_required") {
        window.dispatchEvent(new Event("vsn:auth"));
      }
      const message = errorMessage(e, "messagerie indisponible");
      setError(message);
      setStale(true);
      setFetchedAt(0);
      setCause(failureCause(message, undefined, null));
    } finally {
      if (threadsSeq.current.isCurrent(seq)) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads, refreshTick]);

  const loadThread = useCallback(async (discussion: Discussion) => {
    const seq = threadSeq.current.next();
    olderSeq.current.invalidate();
    setThreadLoading(true);
    setThreadError(null);
    setLoadingOlder(false);
    try {
      const result = await bridge.thread(discussion.id);
      // Réponse PÉRIMÉE : un autre fil a été ouvert entre-temps.
      if (!threadSeq.current.isCurrent(seq)) return;
      if (result.error) setThreadError(result.error);
      const parsed = parseMessages(result.payload);
      setMessages(parsed);
      setThreadTotal(threadPageTotal(result.payload, parsed.length));
      setThreadStart(threadPageStart(result.payload));
      // Un payload ILLISIBLE n'est pas un fil vide : c'est une erreur.
      if (!result.error && !isMessagesPayloadReadable(result.payload)) {
        setThreadError("Fil illisible : la donnée n’a pas pu être lue.");
      }
      // Les participants arrivent AVEC les messages du fil.
      const participants = parseParticipants(result.payload);
      if (participants.length > 0) {
        setThreads((current) =>
          current.map((d) => (d.id === discussion.id ? { ...d, participants } : d)),
        );
      }
      const last = parsed[parsed.length - 1];
      if (last) {
        setPreviews((current) => ({ ...current, [discussion.id]: messagePreview(last.body) }));
      }
    } catch (e) {
      if (!threadSeq.current.isCurrent(seq)) return;
      if (e instanceof BridgeCallError && e.code === "auth_required") {
        window.dispatchEvent(new Event("vsn:auth"));
      }
      setThreadError(errorMessage(e, "fil indisponible"));
    } finally {
      if (threadSeq.current.isCurrent(seq)) setThreadLoading(false);
    }
  }, []);

  // « Charger plus ancien » : une page native de plus, jamais tout le fil.
  const loadOlder = useCallback(async () => {
    if (!open || threadStart <= 0 || loadingOlder) return;
    const seq = olderSeq.current.next();
    const target = open.id;
    setLoadingOlder(true);
    try {
      const result = await bridge.thread(target, threadStart);
      if (!olderSeq.current.isCurrent(seq) || loadedThread.current !== target) return;
      if (result.error) {
        setThreadError(result.error);
        return;
      }
      if (!isMessagesPayloadReadable(result.payload)) {
        setThreadError("Fil illisible : la donnée n’a pas pu être lue.");
        return;
      }
      const older = parseMessages(result.payload);
      setMessages((current) => mergeOlderMessages(older, current));
      setThreadStart(threadPageStart(result.payload));
      setThreadTotal(threadPageTotal(result.payload, older.length));
    } catch (e) {
      if (!olderSeq.current.isCurrent(seq)) return;
      if (e instanceof BridgeCallError && e.code === "auth_required") {
        window.dispatchEvent(new Event("vsn:auth"));
      }
      setThreadError(errorMessage(e, "fil indisponible"));
    } finally {
      if (olderSeq.current.isCurrent(seq)) setLoadingOlder(false);
    }
  }, [loadingOlder, open, threadStart]);

  // Enrichissement des seules lignes visibles, par lots bornés (12 max).
  const handleVisible = useCallback((ids: string[]) => {
    const done = new Set<string>([...enrichedIds.current, ...enrichingIds.current]);
    const pending = nextEnrichBatch(ids, done);
    if (pending.length === 0) return;
    for (const id of pending) enrichingIds.current.add(id);
    const seq = enrichSeq.current.next();
    void (async () => {
      try {
        const result = await bridge.enrich(pending);
        if (!enrichSeq.current.isCurrent(seq)) {
          for (const id of pending) enrichingIds.current.delete(id);
          return;
        }
        if (result.error || !isMessagesPayloadReadable(result.payload)) {
          for (const id of pending) enrichingIds.current.delete(id);
          return;
        }
        const rows = parseEnrichedDiscussions(result.payload);
        for (const id of pending) {
          enrichingIds.current.delete(id);
          enrichedIds.current.add(id);
        }
        for (const row of rows) enrichedDates.current.set(row.id, row);
        if (rows.length > 0) {
          // Pas de tri ici : une ligne enrichie en défilant ne doit pas sauter
          // sous le doigt. Le tri complet revient au prochain chargement.
          setThreads((current) => mergeEnrichedDiscussions(current, rows));
        }
      } catch (e) {
        for (const id of pending) enrichingIds.current.delete(id);
        if (e instanceof BridgeCallError && e.code === "auth_required") {
          window.dispatchEvent(new Event("vsn:auth"));
        }
      }
    })();
  }, []);

  // Le fil affiché vient de l'URL : un lien direct charge le fil dès que la
  // liste a livré ses métadonnées. Quitter le fil invalide la requête en vol.
  useEffect(() => {
    if (mode !== "thread" || !open) return;
    if (loadedThread.current === open.id) return;
    loadedThread.current = open.id;
    replyGuard.current.setDisplayedThread(open.id);
    setSending(false);
    setMessages([]);
    setThreadTotal(0);
    setThreadStart(0);
    setLoadingOlder(false);
    setDraft("");
    setThreadError(null);
    void loadThread(open);
  }, [mode, open, loadThread]);

  useEffect(() => {
    if (mode === "thread") return;
    loadedThread.current = null;
    threadSeq.current.invalidate();
    olderSeq.current.invalidate();
    replyGuard.current.setDisplayedThread(null);
    setSending(false);
  }, [mode]);

  // Le geste global « Actualiser » recharge aussi le fil OUVERT, sinon il
  // serait le seul écran que le geste global ne rafraîchit pas.
  useEffect(() => {
    if (threadRefresh.current === refreshTick) return;
    threadRefresh.current = refreshTick;
    if (mode === "thread" && open) void loadThread(open);
  }, [refreshTick, mode, open, loadThread]);

  const backToList = useCallback(() => {
    threadSeq.current.invalidate();
    olderSeq.current.invalidate();
    replyGuard.current.setDisplayedThread(null);
    setSending(false);
    go("/messages", { replace: true });
  }, [go]);

  const openThread = useCallback(
    (discussion: Discussion) => {
      go(`/messages/${encodeURIComponent(discussion.id)}`);
    },
    [go],
  );

  const setRead = useCallback(
    async (discussion: Discussion, read: boolean) => {
      try {
        const result = await bridge.setRead(discussion.id, read);
        if (!result.ok) {
          notify(result.error || "État de lecture refusé.", "error");
          return;
        }
        setThreads((current) =>
          current.map((d) =>
            d.id === discussion.id
              ? { ...d, unreadCount: read ? 0 : Math.max(d.unreadCount, 1) }
              : d,
          ),
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
    const sentDraft = draft;
    const token = replyGuard.current.start();
    setSending(true);
    try {
      const result = await bridge.reply(open.id, body);
      if (!result.ok) {
        notify(result.error || "Réponse impossible.", "error");
        return;
      }
      // La réponse n'écrit que dans le fil ouvert à l'envoi : fil changé ou
      // écran refermé = PÉRIMÉE, elle ne recharge aucun fil, n'efface aucun
      // brouillon.
      const target = replyGuard.current.resolveThreadId(token);
      notify("Message envoyé.");
      if (target !== null) {
        // Le brouillon n'est effacé que s'il est ENCORE celui envoyé.
        setDraft((current) => draftAfterReply(current, sentDraft));
        await loadThread(open);
      }
      await loadThreads();
    } catch (e) {
      reportable(e, notify);
    } finally {
      // Un envoi plus récent a pris la main : l'état d'envoi n'est plus le nôtre.
      if (replyGuard.current.isCurrent(token)) setSending(false);
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

  const loadRecipients = useCallback(async () => {
    setRecipients([]);
    setRecipientsError(null);
    setRecipientsLoading(true);
    try {
      const result = await bridge.recipients();
      setRecipients(parseRecipients(result.payload));
      // Un payload illisible n'est pas « aucun destinataire » (I14).
      setRecipientsError(
        isMessagesPayloadReadable(result.payload)
          ? (result.error ?? null)
          : "Destinataires illisibles : la donnée n’a pas pu être lue.",
      );
    } catch (e) {
      if (e instanceof BridgeCallError && e.code === "auth_required") {
        window.dispatchEvent(new Event("vsn:auth"));
      }
      setRecipientsError(errorMessage(e, "destinataires indisponibles"));
    } finally {
      setRecipientsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (composing) void loadRecipients();
  }, [composing, loadRecipients]);

  const startNew = useCallback(() => {
    go("/messages/new");
  }, [go]);

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
        onRetry={() => void loadRecipients()}
        onCreate={(subject, body, picked) => void create(subject, body, picked)}
      />
    );
  }

  if (mode === "thread") {
    if (!open) {
      return loading ? (
        <Loading label="Chargement de la discussion…" />
      ) : (
        <ErrorBox message={error ?? "Discussion introuvable."}>
          {error ? (
            <button type="button" className="btn btn--small" onClick={() => void loadThreads()}>
              Réessayer
            </button>
          ) : null}
          <button type="button" className="btn btn--small" onClick={backToList}>
            Retour à la messagerie
          </button>
        </ErrorBox>
      );
    }
    // Le fil de l'URL n'est pas encore chargé : ne jamais montrer les messages
    // du fil précédent sous le nouveau sujet.
    if (loadedThread.current !== open.id) return <Loading label="Chargement de la discussion…" />;
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
        onToggleRead={() => void setRead(open, open.unreadCount !== 0)}
        onDelete={() => void remove()}
        onRefresh={() => void loadThread(open)}
        total={threadTotal}
        loadingOlder={loadingOlder}
        onLoadOlder={() => void loadOlder()}
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
      fetchedAt={fetchedAt}
      cause={cause}
      previews={previews}
      onQueryChange={setQuery}
      onOpen={openThread}
      onMarkRead={(discussion) => void setRead(discussion, true)}
      onNew={() => void startNew()}
      onRefresh={() => void loadThreads()}
      onVisible={handleVisible}
    />
  );
}
