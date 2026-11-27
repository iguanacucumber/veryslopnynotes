import { foldForSearch } from "./message-format";
import type { DiscussionRecipient } from "./message-parse";

export interface RecipientGroup {
  kind: string;
  label: string;
  recipients: DiscussionRecipient[];
}

const RECIPIENT_KIND_ORDER = ["teacher", "student", "administration"];
const RECIPIENT_LABELS: Record<string, string> = {
  teacher: "Professeurs",
  student: "Élèves",
  administration: "Administration",
};
const RECIPIENT_FALLBACK = "Destinataire";

export function recipientKindLabel(kind: string): string {
  return RECIPIENT_LABELS[kind] ?? RECIPIENT_FALLBACK;
}

export function groupRecipients(recipients: DiscussionRecipient[]): RecipientGroup[] {
  if (recipients.length === 0) return [];
  const known = RECIPIENT_KIND_ORDER.filter((kind) => recipients.some((r) => r.kind === kind));
  const extras = [...new Set(recipients.map((r) => r.kind))].filter((k) => !RECIPIENT_KIND_ORDER.includes(k));
  return [...known, ...extras].map((kind) => ({
    kind,
    label: recipientKindLabel(kind),
    recipients: recipients.filter((r) => r.kind === kind),
  }));
}

export function recipientMatches(r: DiscussionRecipient, query: string): boolean {
  const needle = foldForSearch(query);
  if (!needle) return true;
  return foldForSearch(r.displayName).includes(needle);
}

export function pickedCountLabel(count: number): string {
  return count > 1 ? `${count} destinataires` : `${count} destinataire`;
}
