// La réponse d'un envoi ne peut écrire que dans le fil ouvert au moment de
// l'envoi. Si l'élève change de fil avant la résolution, la réponse est PÉRIMÉE
// et n'écrit rien : sinon les messages du fil A s'affichent sous l'en-tête du fil
// B et le brouillon tapé dans B disparaît. Le compteur vit ici (pas dans la
// route) pour être testable.

import { createSeq, type Seq } from "../../lib/seq";

export interface ReplyGuard {
  setDisplayedThread(threadId: string | null): void;
  start(): number;
  /** `null` = réponse PÉRIMÉE : elle n'écrit rien dans l'écran. */
  resolveThreadId(token: number): string | null;
  isCurrent(token: number): boolean;
}

export function createReplyGuard(): ReplyGuard {
  const seq: Seq = createSeq();
  let displayed: string | null = null;
  let sent: string | null = null;
  return {
    setDisplayedThread(threadId) {
      // Même fil : l'envoi reste valable.
      if (displayed === threadId) return;
      displayed = threadId;
      // Changement de fil : tout envoi en vol devient PÉRIMÉ.
      seq.invalidate();
    },
    start() {
      sent = displayed;
      return seq.next();
    },
    resolveThreadId(token) {
      if (!seq.isCurrent(token)) return null;
      return sent;
    },
    isCurrent(token) {
      return seq.isCurrent(token);
    },
  };
}

/** Seul le brouillon ENVOYÉ est effacé ; un brouillon tapé pendant l'attente
 *  n'est pas celui qu'on a envoyé et reste. */
export function draftAfterReply(currentDraft: string, sentDraft: string): string {
  return currentDraft === sentDraft ? "" : currentDraft;
}
