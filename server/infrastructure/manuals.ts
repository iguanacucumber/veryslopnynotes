// Manuels v1 — CHUNK/INDEX/RETRIEVE minimal + citation obligatoire (issue #25, phase 8).
// Dépend phases 3 (StorageProvider) et 6 (Untrusted via domain/ports + server/ai/untrusted).
// Contenu scrapé = donnée, jamais instruction : marquage Untrusted ici,
// délimiteurs nonce côté server/ai (buildSafePrompt). Aucun secret, aucun
// réseau, aucun PDF/URL réelle dans le repo — fixtures synthétiques uniquement.
// Stdlib uniquement (TextEncoder/Decoder), zéro dépendance ajoutée.
// ponytail: recherche par recouvrement mots simple, pas d'embeddings.
// Upgrade: index inversé + persistance versionnée si corpus > quelques centaines de chunks.
import { untrusted } from "../domain/ports";
import type { ManualProvider, StorageProvider, Untrusted } from "../domain/ports";

export interface ManualDoc {
  readonly id: string;
  readonly platform: string;
  readonly title: string;
  readonly subject: string;
  readonly page: number;
  readonly excerpt: string;
}

export interface ManualChunk {
  readonly docId: string;
  readonly index: number;
  readonly text: string;
  readonly source: string;
}

export function formatSource(doc: ManualDoc): string {
  return `${doc.platform} • ${doc.title} • p.${doc.page}`;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(text: string): string[] {
  const n = normalize(text);
  return n ? n.split(" ") : [];
}

// Découpe excerpt en chunks <= maxLen, frontières mots. Pur, déterministe.
export function chunkManual(doc: ManualDoc, maxLen = 500): ManualChunk[] {
  if (!doc.excerpt.trim()) return [];
  const source = formatSource(doc);
  const tokens = doc.excerpt.split(/\s+/);
  const out: ManualChunk[] = [];
  let cur: string[] = [];
  let curLen = 0;
  const flush = () => {
    if (!cur.length) return;
    out.push({ docId: doc.id, index: out.length, text: cur.join(" "), source });
    cur = [];
    curLen = 0;
  };
  for (const t of tokens) {
    const add = (cur.length ? 1 : 0) + t.length;
    if (curLen + add > maxLen && cur.length) flush();
    cur.push(t);
    curLen += add;
  }
  flush();
  return out;
}

// Score = mots requête retrouvés dans chunk. Pur, sans LLM (I7-safe).
export function retrieveManuals(chunks: ManualChunk[], query: string, limit = 3): ManualChunk[] {
  const q = new Set(words(query));
  if (!q.size || !chunks.length) return [];
  const scored = chunks.map((c) => {
    const cw = new Set(words(c.text));
    let s = 0;
    for (const w of q) if (cw.has(w)) s += 1;
    return { c, s };
  });
  scored.sort((a, b) => b.s - a.s || a.c.docId.localeCompare(b.c.docId) || a.c.index - b.c.index);
  return scored
    .filter((e) => e.s > 0)
    .slice(0, Math.max(0, limit))
    .map((e) => e.c);
}

// Citation obligatoire dans corrigés (FEATURES.md). Sources dédupliquées.
export function citeSources(chunks: ManualChunk[]): string {
  const seen: string[] = [];
  for (const c of chunks) if (!seen.includes(c.source)) seen.push(c.source);
  if (!seen.length) return "Sources : aucune (corpus vide).";
  return `Sources :\n${seen.map((s) => `- ${s}`).join("\n")}`;
}

export function formatCorrigeWithCitations(answer: string, chunks: ManualChunk[]): string {
  return `${answer.trim()}\n\n${citeSources(chunks)}`;
}

// Point d'entrée pipeline I6 : bruts scrapés marqués avant tout usage IA.
export function markManualsUntrusted(docs: ManualDoc[]): Untrusted<string>[] {
  return docs.map((d) => untrusted(`${d.title}\n${d.excerpt}`));
}

const CHUNK_PREFIX = "manuals:chunk:";

function chunkKey(docId: string, index: number): string {
  return `${CHUNK_PREFIX}${docId}:${index}`;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export async function saveManualChunks(store: StorageProvider, chunks: ManualChunk[]): Promise<void> {
  for (const c of chunks) {
    await store.set(chunkKey(c.docId, c.index), enc.encode(JSON.stringify(c)));
  }
}

export async function loadManualChunk(
  store: StorageProvider,
  docId: string,
  index: number,
): Promise<ManualChunk | null> {
  const raw = await store.get(chunkKey(docId, index));
  if (!raw) return null;
  try {
    const v = JSON.parse(dec.decode(raw)) as ManualChunk;
    if (!v.docId || typeof v.text !== "string" || typeof v.source !== "string") return null;
    return v;
  } catch {
    return null;
  }
}

// Provider local : corpus en mémoire, plateforme symbolique (jamais d'URL).
// Satisfait ManualProvider (platform) + recherche locale pour corrigés.
export class LocalManualProvider implements ManualProvider {
  readonly platform: string;
  private readonly chunks: ManualChunk[];

  constructor(platform: string, chunks: ManualChunk[] = []) {
    this.platform = platform;
    this.chunks = [...chunks];
  }

  search(query: string, limit = 3): ManualChunk[] {
    return retrieveManuals(this.chunks, query, limit);
  }

  get size(): number {
    return this.chunks.length;
  }
}
