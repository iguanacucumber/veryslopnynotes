// La RÉPONSE d'un envoi : à quel fil a-t-elle le droit d'écrire ?
//
// Règle (#524) : la réponse d'un envoi ne peut écrire que dans le fil qui
// était OUVERT au moment de l'envoi. L'envoi est une ATTENTE (le pont natif
// répond plus tard) : si l'élève change de fil avant la résolution, la
// réponse est PÉRIMÉE et n'écrit RIEN — sinon les messages du fil A
// s'affichaient sous l'en-tête du fil B, et le brouillon tapé dans B
// disparaissait.
//
// Le mécanisme est celui de `web/src/lib/seq.ts` (#501) : un compteur
// monotone, invalidé quand l'écran change de fil. Il est ici, et pas dans le
// composant, pour être TESTABLE : le dépôt ne rend pas les routes dans les
// tests, donc une règle écrite dans la route ne serait pas vérifiée.

import { createSeq, type Seq } from "../../lib/seq";

export interface ReplyGuard {
  /** Le fil AFFICHÉ a changé (ouverture d'un fil, retour à la liste). */
  setDisplayedThread(threadId: string | null): void;
  /** Un envoi démarre dans le fil affiché : renvoie le jeton de l'envoi. */
  start(): number;
  /**
   * La réponse de l'envoi arrive : le fil qu'elle a le droit de recharger.
   * `null` = réponse PÉRIMÉE : elle n'écrit rien dans l'écran.
   */
  resolveThreadId(token: number): string | null;
  /** L'envoi est-il encore le dernier (donc encore en cours) ? */
  isCurrent(token: number): boolean;
}

export function createReplyGuard(): ReplyGuard {
  const seq: Seq = createSeq();
  let displayed: string | null = null;
  let sent: string | null = null;
  return {
    setDisplayedThread(threadId) {
      // Même fil : rien ne change, l'envoi reste valable.
      if (displayed === threadId) return;
      displayed = threadId;
      // L'écran a changé de fil : tout envoi en vol devient PÉRIMÉ.
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

/**
 * Le brouillon qui reste après l'envoi.
 *
 * Seul le brouillon ENVOYÉ est effacé : un brouillon tapé PENDANT l'attente
 * n'est pas celui qu'on a envoyé, il reste (l'élève ne perd pas ce qu'il
 * écrit).
 */
export function draftAfterReply(currentDraft: string, sentDraft: string): string {
  return currentDraft === sentDraft ? "" : currentDraft;
}
