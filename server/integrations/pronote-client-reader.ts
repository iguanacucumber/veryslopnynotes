// Lectures via Client pronotets (session Pronote).
// Hiérarchie : Domain → PronoteReader → PronoteClientReader → pronotets → HTTP (I2).
// Sorties marquées Untrusted (I6). Erreurs typées sans secret.
// Pagination : limit clampée 1..100 (défaut 50), cursor = offset opaque, nextCursor null = fin.
// Mappers : Grade pronotets (grade/outOf strings) → contrat (value/scale numbers).
// ponytail: mappers purs minimaux, pas de lib date.
//
// #197 : ce fichier est une FAÇADE. Les lectures et leurs mappers vivent dans
// `client-reader/<domaine>.ts` (notes, lessons, school-life, social, profile,
// capabilities) ; les primitives partagées dans `client-reader/primitives.ts`.
// La classe ci-dessous ne délègue que : ni méthode ajoutée, ni méthode retirée,
// ni comportement changé. C'est le SEUL point d'entrée côté intégrations.
import type {
  AbsenceRecord,
  Assignment,
  CanteenMenu,
  Capabilities,
  Discussion,
  Grade,
  Message,
  NewsItem,
  Period,
  Punishment,
  Recipient,
  TimetableEntry,
  UserInfo,
} from "../../shared/contracts/models";
import type { PronotePage, PronotePageOptions, PronoteReader, PronoteTimetableOptions } from "../domain/ports";
import type { ProvidedAverages } from "../domain/averages";
import type { PedagogicResource } from "../domain/ports";

import { getGrades, getPeriods, getProvidedAverages } from "./client-reader/notes";
import { getAssignments, getTimetable, setAssignmentDone } from "./client-reader/lessons";
import { getNews, getResources } from "./client-reader/resources";
import { getAttendance, getMenus, getPunishments } from "./client-reader/school-life";
import {
  createDiscussion,
  deleteDiscussion,
  getDiscussionMessages,
  getDiscussionRecipients,
  getDiscussions,
  replyToDiscussion,
  setDiscussionRead,
} from "./client-reader/social";
import { getUserInfo } from "./client-reader/profile";
import { getCapabilities } from "./client-reader/capabilities";
import type { ReaderCtx } from "./client-reader/primitives";

export interface PronoteClientReaderOptions {
  /** Résolveur session injecté (PronoteSessionStore.requireClient). */
  readonly sessions: ReaderCtx["sessions"];
  readonly logger?: (message: string) => void;
}

export class PronoteClientReader implements PronoteReader {
  private readonly ctx: ReaderCtx;

  constructor(options: PronoteClientReaderOptions) {
    if (!options.sessions) throw new Error("sessions requises (PronoteSessionStore injecté)");
    this.ctx = {
      sessions: options.sessions,
      logger: options.logger ?? (() => {}),
    };
  }

  // --- notes (#74) ---

  getGrades(accountId: string, page?: PronotePageOptions): Promise<PronotePage<Grade>> {
    return getGrades(this.ctx, accountId, page);
  }

  getPeriods(accountId: string): Promise<PronotePage<Period>> {
    return getPeriods(this.ctx, accountId);
  }

  getProvidedAverages(accountId: string): Promise<PronotePage<ProvidedAverages>> {
    return getProvidedAverages(this.ctx, accountId);
  }

  // --- cours (#75, #76, #79, #84) ---

  getAssignments(accountId: string, page?: PronotePageOptions): Promise<PronotePage<Assignment>> {
    return getAssignments(this.ctx, accountId, page);
  }

  setAssignmentDone(accountId: string, assignmentId: string, done: boolean): Promise<Assignment> {
    return setAssignmentDone(this.ctx, accountId, assignmentId, done);
  }

  getTimetable(accountId: string, options?: PronoteTimetableOptions): Promise<PronotePage<TimetableEntry>> {
    return getTimetable(this.ctx, accountId, options);
  }

  getResources(accountId: string, page?: PronotePageOptions): Promise<PronotePage<PedagogicResource>> {
    return getResources(this.ctx, accountId, page);
  }

  getNews(accountId: string, page?: PronotePageOptions): Promise<PronotePage<NewsItem>> {
    return getNews(this.ctx, accountId, page);
  }

  // --- vie scolaire (#77, #81) ---

  getMenus(accountId: string, options?: PronoteTimetableOptions): Promise<PronotePage<CanteenMenu>> {
    return getMenus(this.ctx, accountId, options);
  }

  getAttendance(accountId: string, page?: PronotePageOptions): Promise<PronotePage<AbsenceRecord>> {
    return getAttendance(this.ctx, accountId, page);
  }

  getPunishments(accountId: string, page?: PronotePageOptions): Promise<PronotePage<Punishment>> {
    return getPunishments(this.ctx, accountId, page);
  }

  // --- messagerie (#80) ---

  getDiscussions(accountId: string, page?: PronotePageOptions): Promise<PronotePage<Discussion>> {
    return getDiscussions(this.ctx, accountId, page);
  }

  getDiscussionMessages(accountId: string, discussionId: string): Promise<PronotePage<Message>> {
    return getDiscussionMessages(this.ctx, accountId, discussionId);
  }

  getDiscussionRecipients(accountId: string): Promise<PronotePage<Recipient>> {
    return getDiscussionRecipients(this.ctx, accountId);
  }

  createDiscussion(accountId: string, subject: string, body: string, recipientIds: string[]): Promise<void> {
    return createDiscussion(this.ctx, accountId, subject, body, recipientIds);
  }

  replyToDiscussion(accountId: string, discussionId: string, body: string): Promise<void> {
    return replyToDiscussion(this.ctx, accountId, discussionId, body);
  }

  setDiscussionRead(accountId: string, discussionId: string, read: boolean): Promise<void> {
    return setDiscussionRead(this.ctx, accountId, discussionId, read);
  }

  deleteDiscussion(accountId: string, discussionId: string): Promise<void> {
    return deleteDiscussion(this.ctx, accountId, discussionId);
  }

  // --- profil (#82) et capacités (#87) ---

  getUserInfo(accountId: string): Promise<PronotePage<UserInfo>> {
    return getUserInfo(this.ctx, accountId);
  }

  getCapabilities(accountId: string): Promise<Capabilities> {
    return getCapabilities(this.ctx, accountId);
  }
}
