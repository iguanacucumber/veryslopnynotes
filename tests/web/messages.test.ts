import { useParisTz } from "./setup";

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createSeq } from "../../web/src/lib/seq";
import { createReplyGuard, draftAfterReply } from "../../web/src/features/messages/reply";
import { ThreadScreen } from "../../web/src/features/messages/MessagesScreen";
import {
  isMessagesPayloadReadable,
  type Discussion,
  type DiscussionMessage,
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
        onBack: () => {},
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
        onBack: () => {},
        onToggleRead: () => {},
        onDelete: () => {},
        onRefresh: () => {},
      }),
    );
  }

  function backButton(html: string): string {
    return html.match(/<button[^>]*aria-label="Retour à la liste des discussions"[^>]*>/)?.[0] ?? "";
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

  test("pendant l'envoi, le bouton Retour est désactivé (pas de chevauchement)", () => {
    expect(backButton(renderScreen(threadA, [], "en cours", true))).toContain("disabled");
    // Hors envoi, le fil peut être refermé.
    expect(backButton(renderScreen(threadA, [], "", false))).not.toContain("disabled");
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
