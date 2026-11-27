export const NOW = new Date(2026, 9, 21, 12, 0, 0); // mercredi 21 octobre 2026, midi local

export const VALID = {
  id: "a3",
  subject: "NUMERIQUE SC.INFORM.",
  title: "TP — base de données",
  dueDate: "2026-10-23T18:00:00.000Z",
  done: false,
  description: "Terminer les requêtes SQL et rendre le script.",
  attachments: [{ id: "att1", label: "sujet-tp.pdf", ref: "homework:1:file:0:att1" }],
};

export function payload(items: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ assignments: items, ...extra });
}
