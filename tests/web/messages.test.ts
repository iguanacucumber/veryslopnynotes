import { useParisTz } from "./setup";

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createSeq } from "../../web/src/lib/seq";
import { ThreadScreen } from "../../web/src/features/messages/MessagesScreen";
import { isMessagesPayloadReadable, type Discussion } from "../../web/src/features/messages/model";

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
