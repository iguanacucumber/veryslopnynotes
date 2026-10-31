// Le scraper ne fait que page -> ManualDoc ; l'assistant devoirs tourne sur le
// téléphone (`android/core/`). Ici : le document et la troncature sûre.
export interface ManualDoc {
  readonly id: string;
  readonly platform: string;
  readonly title: string;
  readonly subject: string;
  readonly page: number;
  readonly excerpt: string;
}

const HIGH_SURROGATE = { min: 0xd800, max: 0xdbff };

function endsWithHighSurrogate(s: string): boolean {
  if (!s.length) return false;
  const c = s.charCodeAt(s.length - 1);
  return c >= HIGH_SURROGATE.min && c <= HIGH_SURROGATE.max;
}

// Troncature sans jamais séparer une paire de surrogates (sinon demi-caractère
// orphelin en base). Si la coupe tombe sur un surrogate haut, on le remplace
// par "…" : longueur conservée, texte bien formé.
export function truncateManualText(text: string, maxLen: number): string {
  if (maxLen <= 0) return "";
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  return endsWithHighSurrogate(cut) ? `${cut.slice(0, -1)}…` : cut;
}
