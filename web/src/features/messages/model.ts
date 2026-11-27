// Compatibilité : l'implémentation est répartie par thème dans ce répertoire.
export { parseInstant } from "../../lib/format";
export {
  MAX_ID,
  MAX_NAME,
  MAX_SUBJECT,
  MAX_BODY,
  MAX_PARTICIPANTS,
  MAX_UNREAD,
  MAX_ATTACHMENT_LABEL,
  MAX_ATTACHMENT_REF,
  UNKNOWN_UNREAD,
  RECIPIENT_KINDS,
  MAX_VISIBLE_ENRICH,
  parseDiscussions,
  parseEnrichedDiscussions,
  mergeEnrichedDiscussions,
  nextEnrichBatch,
  isMessagesPayloadReadable,
  parseMessages,
  parseParticipants,
  parseRecipients,
  isRecipientsPayloadReadable,
} from "./message-parse";
export type {
  MessageAttachment,
  Discussion,
  DiscussionMessage,
  DiscussionRecipient,
  EnrichedDiscussion,
} from "./message-parse";
export {
  MESSAGE_WINDOW,
  visibleMessages,
  threadPageTotal,
  threadPageStart,
  mergeOlderMessages,
  remainingMessages,
  nextMessageWindow,
} from "./message-thread";
export {
  discussionMillis,
  sortDiscussions,
  foldForSearch,
  discussionMatches,
  searchDiscussions,
  unreadBadgeCount,
  unreadTotal,
  isRead,
  unreadTotalLabel,
  conversationCountLabel,
  messagePreview,
  isOwnMessage,
  formatLongDate,
  formatDateTime,
  conversationDateLabel,
} from "./message-format";
export {
  recipientKindLabel,
  groupRecipients,
  recipientMatches,
  pickedCountLabel,
} from "./message-recipients";
export type { RecipientGroup } from "./message-recipients";
