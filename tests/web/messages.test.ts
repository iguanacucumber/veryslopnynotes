import { useParisTz } from "./setup";

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createSeq } from "../../web/src/lib/seq";
import { createReplyGuard, draftAfterReply } from "../../web/src/features/messages/reply";
import { ConversationListScreen, NewDiscussionScreen, ThreadScreen } from "../../web/src/features/messages/MessagesScreen";
import { readBridgeSource } from "../unit/fixtures/bridge-source";
import {
  isMessagesPayloadReadable,
  MESSAGE_WINDOW,
  nextMessageWindow,
  visibleMessages,
  type Discussion,
  type DiscussionMessage,
  type DiscussionRecipient,
} from "../../web/src/features/messages/model";

useParisTz();

const ROOT = join(import.meta.dir, "..", "..");

// #501 : ouvrir le fil A, revenir à la liste, ouvrir le fil B — la réponse de
// A arrivant APRÈS celle de B affichait les messages de A sous l'en-tête de B.
//
// Le dépôt n'a pas de rendu React dans les tests : la règle est donc dans une
// fonction pure (`web/src/lib/seq.ts`), testée ici, et l'écran l'UTILISE
// (vérifié par le garde de source ci-dessous).
describe("web messagerie : une réponse périmée n'écrit plus dans l'écran", () => {
  test("la séquence ignore la réponse d'une demande dépassée", () => {
    const seq = createSeq();
    const a = seq.next();
    const b = seq.next();
    // A est périmée (B est demandée après) : sa réponse est ignorée.
    expect(seq.isCurrent(a)).toBe(false);
    expect(seq.isCurrent(b)).toBe(true);
  });

  test("invalider une demande en vol la rend périmée", () => {
    const seq = createSeq();
    const a = seq.next();
    expect(seq.isCurrent(a)).toBe(true);
    seq.invalidate();
    expect(seq.isCurrent(a)).toBe(false);
  });

  test("l'écran de messagerie utilise la séquence pour ses deux chargements", () => {
    const route = readFileSync(join(ROOT, "web/src/routes/messages.tsx"), "utf8");
    // Le fil ET la liste : une réponse périmée ne doit rien écrire.
    expect(route).toContain("createSeq()");
    expect(route).toContain("threadSeq.current.next()");
    expect(route).toContain("threadsSeq.current.next()");
    expect(route).toContain("threadSeq.current.isCurrent(seq)");
    // Refermer le fil invalide la demande en vol.
    expect(route).toContain("threadSeq.current.invalidate()");
  });
});

// #537 : un payload CORROMPU (JSON illisible) ne doit JAMAIS être présenté
// comme une absence de donnée (I14 : « invalide » n'est jamais « vide »).
// L'écran est RENDU : c'est ce que l'élève voit, pas ce que le code dit.
describe("messagerie : un fil illisible est une ERREUR, pas un fil vide (#537)", () => {
  const discussion: Discussion = {
    id: "d1",
    subject: "Cahier de texte",
    participants: [],
    unreadCount: 0,
    lastMessageAt: "",
    updatedAt: "",
  };

  function renderThread(error: string | null): string {
    return renderToStaticMarkup(
      createElement(ThreadScreen, {
        discussion,
        messages: [],
        loading: false,
        error,
        draft: "",
        sending: false,
        onDraftChange: () => {},
        onReply: () => {},
        onToggleRead: () => {},
        onDelete: () => {},
        onRefresh: () => {},
      }),
    );
  }

  test("avec une erreur, l'écran ne dit PAS « Ce fil est vide »", () => {
    const html = renderThread("Fil illisible : la donnée n’a pas pu être lue.");
    expect(html).toContain("Fil illisible");
    // L'état vide affirmerait un fait faux : on ne sait pas que le fil est vide.
    expect(html).not.toContain("Ce fil est vide");
  });

  test("sans erreur, un fil sans message est bien un fil vide", () => {
    const html = renderThread(null);
    expect(html).toContain("Ce fil est vide");
  });

  test("le prédicat distingue le payload illisible du payload lisible", () => {
    expect(isMessagesPayloadReadable("pas du json")).toBe(false);
    expect(isMessagesPayloadReadable("[]")).toBe(false);
    expect(isMessagesPayloadReadable("{}")).toBe(true);
    expect(isMessagesPayloadReadable('{"messages":[]}')).toBe(true);
    expect(isMessagesPayloadReadable(null)).toBe(false);
  });

  test("la route signale le payload illisible (elle ne le montre pas comme vide)", () => {
    const route = readFileSync(join(ROOT, "web/src/routes/messages.tsx"), "utf8");
    expect(route).toContain("isMessagesPayloadReadable");
    expect(route).toContain("Fil illisible");
  });
});

// #783 : un échec NON-session du pont rendait `payload: null` en succès, donc
// zéro fil et `error = null`. Le pont doit lever `unavailable` (I14).
describe("pont messages — un échec est une ERREUR, jamais zéro fil (#783)", () => {
  const bridge = readBridgeSource();
  const listStart = bridge.indexOf("internal fun VsnBridge.messagesList()");
  const threadStart = bridge.indexOf("internal fun VsnBridge.messagesThread(");
  const replyStart = bridge.indexOf("internal fun VsnBridge.messagesReply(");
  const list = bridge.slice(listStart, threadStart);
  const thread = bridge.slice(threadStart, replyStart);

  test("messages.list ne rend plus payload null en succès", () => {
    expect(list).not.toContain("payload ?: JSONObject.NULL");
    expect(list).toContain('?: throw BridgeFailure("unavailable"');
    expect(list).toContain('cachedPayload ?: throw BridgeFailure("unavailable"');
    expect(list).toContain('put("error", outcome.message)');
  });

  test("messages.thread lève unavailable sur un échec ou un fil absent", () => {
    expect(thread).toContain('if (error != null) throw BridgeFailure("unavailable", error)');
    expect(thread).toContain('if (thread == null) throw BridgeFailure("unavailable"');
  });

  test("la liste web rend l'erreur du pont et le payload illisible", () => {
    const route = readFileSync(join(ROOT, "web/src/routes/messages.tsx"), "utf8");
    expect(route).toContain("isMessagesPayloadReadable(result.payload)");
    expect(route).toContain("Discussions illisibles");
    expect(route).toContain("result.error");
  });
});

// #524 : la réponse d'un ENVOI qui arrive APRÈS le changement de fil
// n'écrit que dans le fil qui était OUVERT au moment de l'envoi. Sinon les
// messages du fil A s'affichaient sous l'en-tête du fil B, et le brouillon
// tapé dans B disparaissait.
//
// Le dépôt ne rend pas les ROUTES : la règle est dans une fonction PURE
// (`web/src/features/messages/reply.ts`), testée ici, et la route l'UTILISE
// (garde de source ci-dessous) — même motif que `web/src/lib/seq.ts` (#501).
describe("messagerie : une réponse d'envoi tardive n'écrase pas le fil ouvert (#524)", () => {
  const threadA: Discussion = {
    id: "A",
    subject: "Fil A",
    participants: [],
    unreadCount: 0,
    lastMessageAt: null,
    updatedAt: null,
  };
  const threadB: Discussion = {
    id: "B",
    subject: "Fil B",
    participants: [],
    unreadCount: 0,
    lastMessageAt: null,
    updatedAt: null,
  };

  function message(id: string, discussionId: string, body: string): DiscussionMessage {
    return { id, discussionId, authorName: "", body, sentAt: "", attachments: [] };
  }

  function renderScreen(
    discussion: Discussion,
    messages: DiscussionMessage[],
    draft: string,
    sending = false,
  ): string {
    return renderToStaticMarkup(
      createElement(ThreadScreen, {
        discussion,
        messages,
        loading: false,
        error: null,
        draft,
        sending,
        onDraftChange: () => {},
        onReply: () => {},
        onToggleRead: () => {},
        onDelete: () => {},
        onRefresh: () => {},
      }),
    );
  }

  test("répondre puis changer de fil : la réponse d'A est ignorée", () => {
    const guard = createReplyGuard();
    // Fil A ouvert : l'élève envoie une réponse.
    guard.setDisplayedThread("A");
    const token = guard.start();
    // La réponse n'est pas encore arrivée : il revient à la liste et ouvre B.
    guard.setDisplayedThread(null);
    guard.setDisplayedThread("B");
    // Ce que voit l'élève : le fil B, ses messages, son brouillon.
    let screen = { threadId: "B", messages: ["b1"], draft: "brouillon de B" };
    // La réponse d'A arrive : la route ne recharge que le fil que la garde
    // autorise, et n'efface le brouillon que dans ce cas.
    const target = guard.resolveThreadId(token);
    if (target !== null) {
      screen = { threadId: target, messages: ["a1", "a2"], draft: "" };
    }
    // La réponse est PÉRIMÉE : les messages de B restent ceux de B et son
    // brouillon survit.
    expect(target).toBeNull();
    expect(screen.messages).toEqual(["b1"]);
    expect(screen.draft).toBe("brouillon de B");
  });

  test("la réponse d'un envoi s'applique à son propre fil", () => {
    const guard = createReplyGuard();
    guard.setDisplayedThread("A");
    const token = guard.start();
    expect(guard.resolveThreadId(token)).toBe("A");
  });

  test("revenir au fil d'origine ne ressuscite pas une réponse périmée", () => {
    const guard = createReplyGuard();
    guard.setDisplayedThread("A");
    const token = guard.start();
    guard.setDisplayedThread("B");
    guard.setDisplayedThread("A");
    expect(guard.resolveThreadId(token)).toBeNull();
  });

  test("un envoi plus récent prend la main (l'ancien ne remet plus l'état d'envoi)", () => {
    const guard = createReplyGuard();
    guard.setDisplayedThread("A");
    const first = guard.start();
    const second = guard.start();
    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });

  test("un brouillon tapé pendant l'envoi n'est pas effacé", () => {
    // Le brouillon envoyé part…
    expect(draftAfterReply("bonjour", "bonjour")).toBe("");
    // …mais celui tapé pendant l'attente reste.
    expect(draftAfterReply("brouillon de B", "bonjour")).toBe("brouillon de B");
  });

  test("l'écran du fil B montre les messages de B, pas ceux d'un autre fil", () => {
    const html = renderScreen(threadB, [message("b1", "B", "message de B")], "brouillon de B");
    expect(html).toContain("Fil B");
    expect(html).toContain("message de B");
    expect(html).not.toContain("message de A");
    expect(html).toContain("brouillon de B");
  });

  test("le fil n'ajoute pas une seconde flèche Retour", () => {
    // La coquille porte la seule flèche : son retour vise `/messages` par la
    // route du fil, sans doublon dans l'écran.
    const html = renderScreen(threadA, [], "", false);
    expect(html).not.toContain('aria-label="Retour à la liste des discussions"');
  });

  test("la route utilise la garde et n'efface le brouillon que par elle", () => {
    const route = readFileSync(join(ROOT, "web/src/routes/messages.tsx"), "utf8");
    expect(route).toContain("createReplyGuard()");
    expect(route).toContain("replyGuard.current.start()");
    expect(route).toContain("replyGuard.current.resolveThreadId(token)");
    // Un envoi plus récent a pris la main : l'ancien ne remet plus l'état
    // d'envoi.
    expect(route).toContain("replyGuard.current.isCurrent(token)");
    // Changer de fil invalide l'envoi en vol.
    expect(route).toContain("replyGuard.current.setDisplayedThread(");
    // Le brouillon n'est plus effacé en dur : il l'est seulement s'il est
    // ENCORE celui envoyé.
    expect(route).toContain("draftAfterReply(current, sentDraft)");
  });
});

describe("messagerie — fil et composition sont des sous-routes", () => {
  test("la coquille et le retour Android partagent la même URL", () => {
    const app = readFileSync(join(ROOT, "web/src/App.tsx"), "utf8");
    expect(app).toContain('path="/messages/new"');
    expect(app).toContain('path="/messages/:id"');
    const route = readFileSync(join(ROOT, "web/src/routes/messages.tsx"), "utf8");
    expect(route).toContain("useParams()");
    // Plus de mode local contre l'historique : l'URL est la source.
    expect(route).not.toContain("pushState");
    expect(route).not.toContain("popstate");
  });
});

describe("messagerie — recherche, lignes de liste et fil collé", () => {
  const discussion: Discussion = {
    id: "d1",
    subject: "Cahier de texte — Mme Martin",
    participants: ["Mme Martin"],
    unreadCount: 3,
    lastMessageAt: "2026-10-21T08:00:00.000Z",
    updatedAt: "2026-10-21T08:00:00.000Z",
  };

  function renderList(list: Discussion[], query: string): string {
    return renderToStaticMarkup(
      createElement(ConversationListScreen, {
        discussions: list,
        query,
        loading: false,
        error: null,
        stale: false,
        previews: { d1: "Pensez à rendre le TP." },
        onQueryChange: () => {},
        onOpen: () => {},
        onMarkRead: () => {},
        onNew: () => {},
        onRefresh: () => {},
      }),
    );
  }

  test("la recherche utilise le champ partagé", () => {
    const html = renderList([discussion], "");
    expect(html).toContain('class="search-field"');
    expect(html).not.toContain('class="field"');
    expect(html).toContain("Rechercher une discussion");
  });

  test("sans résultat, l'action efface la recherche au lieu d'actualiser", () => {
    const html = renderList([], "introuvable");
    expect(html).toContain("Effacer la recherche");
    expect(html).not.toContain("Actualiser");
  });

  test("le sujet et la date occupent deux niveaux, le nom peut s'étendre", () => {
    const html = renderList([discussion], "");
    expect(html).toContain("messages-card__name");
    expect(html).toContain("messages-card__date");
    expect(html).toContain("messages-card__preview");
    // Plus de style inline qui tronque le nom sur une ligne.
    expect(html).not.toContain("text-overflow:ellipsis;white-space:nowrap");
  });

  test("le fil suit le bas et garde son compositeur hors de la liste", () => {
    const source = readFileSync(
      join(ROOT, "web/src/features/messages/MessagesScreen.tsx"),
      "utf8",
    );
    expect(source).toContain("useStickToBottom");
    expect(source).toContain("messages-thread__log-wrap");
    expect(source).toContain("messages-composer");
    expect(source).toContain("toBottom()");
    expect(source).toContain("role=\"log\"");
  });
});

// #918 : une ERREUR n'est pas un état vide (I14). La liste, les destinataires et
// le fil ne doivent jamais affirmer « aucun » quand la donnée est inconnue.
describe("messagerie : une erreur n'est jamais un état vide (#918)", () => {
  const discussion: Discussion = {
    id: "d1",
    subject: "Cahier de texte",
    participants: [],
    unreadCount: 0,
    lastMessageAt: null,
    updatedAt: null,
  };

  function renderList(discussions: Discussion[], query: string, error: string | null): string {
    return renderToStaticMarkup(
      createElement(ConversationListScreen, {
        discussions,
        query,
        loading: false,
        error,
        stale: Boolean(error),
        previews: {},
        onQueryChange: () => {},
        onOpen: () => {},
        onMarkRead: () => {},
        onNew: () => {},
        onRefresh: () => {},
      }),
    );
  }

  function renderNew(recipients: DiscussionRecipient[], error: string | null): string {
    return renderToStaticMarkup(
      createElement(NewDiscussionScreen, {
        recipients,
        loading: false,
        error,
        sending: false,
        onRetry: () => {},
        onCreate: () => {},
      }),
    );
  }

  test("liste : erreur et zéro fil affichent l'erreur et « Réessayer », pas « Aucune discussion »", () => {
    const html = renderList([], "", "messagerie indisponible");
    expect(html).toContain("messagerie indisponible");
    expect(html).toContain("Réessayer");
    expect(html).not.toContain("Aucune discussion.");
  });

  test("liste : une recherche sans résultat sous erreur ne dit pas « aucun sujet »", () => {
    const html = renderList([], "introuvable", "messagerie indisponible");
    expect(html).not.toContain("Aucune discussion ne correspond");
    expect(html).not.toContain("Aucun sujet ne porte ces mots");
  });

  test("nouvelle discussion : erreur et zéro destinataire affichent « Réessayer », pas un établissement sans destinataire", () => {
    const html = renderNew([], "destinataires indisponibles");
    expect(html).toContain("destinataires indisponibles");
    expect(html).toContain("Réessayer");
    expect(html).not.toContain("Aucun destinataire publié");
  });

  test("sans erreur, un vrai vide reste un état vide", () => {
    expect(renderList([], "", null)).toContain("Aucune discussion.");
    expect(renderNew([], null)).toContain("Aucun destinataire publié");
  });

  test("fil : erreur et zéro message gardent l'erreur et « Réessayer »", () => {
    const html = renderToStaticMarkup(
      createElement(ThreadScreen, {
        discussion,
        messages: [],
        loading: false,
        error: "fil indisponible",
        draft: "",
        sending: false,
        onDraftChange: () => {},
        onReply: () => {},
        onToggleRead: () => {},
        onDelete: () => {},
        onRefresh: () => {},
      }),
    );
    expect(html).toContain("fil indisponible");
    expect(html).toContain("Réessayer");
    expect(html).not.toContain("Ce fil est vide");
  });

  test("la route traite un payload de destinataires illisible comme une erreur", () => {
    const route = readFileSync(join(ROOT, "web/src/routes/messages.tsx"), "utf8");
    const start = route.indexOf("const loadRecipients");
    const end = route.indexOf("useEffect(", start);
    const block = route.slice(start, end);
    expect(block).toContain("isMessagesPayloadReadable(result.payload)");
    expect(block).toContain("result.error");
    expect(block).toContain("Destinataires illisibles");
  });
});

// #966 : le pont livre tout l'historique du fil. L'écran n'en rend qu'une
// fenêtre récente, extensible par un bouton — pas un scroll infini.
describe("messagerie — le fil rend une fenêtre bornée de messages (#966)", () => {
  const ids = Array.from({ length: 120 }, (_, i) => `m-${String(i).padStart(3, "0")}`);

  function message(id: string): DiscussionMessage {
    return {
      id,
      discussionId: "d1",
      authorName: "",
      body: `corps-${id}`,
      sentAt: "",
      attachments: [],
    };
  }

  const discussion: Discussion = {
    id: "d1",
    subject: "Cahier de texte",
    participants: [],
    unreadCount: 0,
    lastMessageAt: null,
    updatedAt: null,
  };

  function renderThread(messages: DiscussionMessage[]): string {
    return renderToStaticMarkup(
      createElement(ThreadScreen, {
        discussion,
        messages,
        loading: false,
        error: null,
        draft: "",
        sending: false,
        onDraftChange: () => {},
        onReply: () => {},
        onToggleRead: () => {},
        onDelete: () => {},
        onRefresh: () => {},
      }),
    );
  }

  test("la fenêtre par défaut est le suffixe récent, ordre conservé", () => {
    const visible = visibleMessages(ids, MESSAGE_WINDOW);
    expect(visible).toHaveLength(MESSAGE_WINDOW);
    expect(visible).toEqual(ids.slice(ids.length - MESSAGE_WINDOW));
    // Un fil plus court que la fenêtre n'est pas tronqué.
    expect(visibleMessages(ids.slice(0, 7), MESSAGE_WINDOW)).toEqual(ids.slice(0, 7));
  });

  test("l'extension ne dépasse jamais le total et chaque pas ajoute des anciens", () => {
    expect(nextMessageWindow(MESSAGE_WINDOW, 120)).toBe(100);
    expect(nextMessageWindow(100, 120)).toBe(120);
    expect(nextMessageWindow(120, 120)).toBe(120);
    expect(nextMessageWindow(MESSAGE_WINDOW, 10)).toBe(10);

    let shown = MESSAGE_WINDOW;
    let previous = visibleMessages(ids, shown);
    let steps = 0;
    while (shown < ids.length) {
      const next = nextMessageWindow(shown, ids.length);
      expect(next).toBeGreaterThan(shown);
      const visible = visibleMessages(ids, next);
      // La fenêtre suivante est un SURENSEMBLE : aucun message perdu ni dupliqué.
      expect(visible.slice(visible.length - previous.length)).toEqual(previous);
      expect(visible.length - previous.length).toBe(next - shown);
      expect(new Set(visible).size).toBe(visible.length);
      previous = visible;
      shown = next;
      steps += 1;
      expect(steps).toBeLessThan(10);
    }
    expect(previous).toEqual(ids);
  });

  test("le rendu initial ne construit que les 50 derniers messages et garde le log", () => {
    const all = ids.map(message);
    const html = renderThread(all);
    const visible = visibleMessages(all, MESSAGE_WINDOW);

    for (const item of visible) expect(html).toContain(item.body);
    // Le premier message hors fenêtre n'est pas dans le DOM : le rendu est borné.
    expect(html).not.toContain(all[all.length - MESSAGE_WINDOW - 1]!.body);
    expect(html).toContain("Charger les messages plus anciens");
    expect(html).toContain('role="log"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-relevant="additions text"');
  });

  test("un fil déjà sous la fenêtre n'affiche ni bouton ni statut", () => {
    const html = renderThread(ids.slice(0, 40).map(message));
    expect(html).toContain("corps-m-000");
    expect(html).not.toContain("Charger les messages plus anciens");
    expect(html).not.toContain("Tous les messages sont affichés");
  });
});
