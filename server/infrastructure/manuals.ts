// Manuels v1 — CHUNK/INDEX/RETRIEVE minimal + citation obligatoire (issues #25, #26, phase 8).
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

// Normalisation Unicode : on garde TOUTES les lettres/chiffres (latin, CJK,
// grec, arabe...) après retrait des diacritiques, sinon une requête hors
// alphabet latin ne peut jamais retrouver son chunk.
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(text: string): string[] {
  const n = normalize(text);
  return n ? n.split(" ") : [];
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

// Coupe dure d'un mot plus long que maxLen, sans casser un surrogate.
function hardSplitWord(word: string, maxLen: number): string[] {
  if (maxLen < 1) return [word];
  const out: string[] = [];
  let rest = word;
  while (rest.length > maxLen) {
    let piece = rest.slice(0, maxLen);
    if (endsWithHighSurrogate(piece)) piece = piece.slice(0, -1);
    if (!piece) break;
    out.push(piece);
    rest = rest.slice(piece.length);
  }
  if (rest) out.push(rest);
  return out;
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
    // Un mot plus long que maxLen doit être coupé, sinon le chunk dépasse la
    // limite promise (mot collé / URL / tableau sans espaces).
    if (t.length > maxLen) {
      flush();
      for (const piece of hardSplitWord(t, maxLen)) {
        cur = [piece];
        curLen = piece.length;
        flush();
      }
      continue;
    }
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

// Index versionné (#26) : manifeste persistant via StorageProvider.
// Rebuild = réécrit chunks + manifeste (idempotent, déterministe).
// Version mismatch/corrompu → null (appelant rebuild). Stdlib uniquement.
// ponytail: manifeste mono-clé, pas de migration multi-versions.
// Upgrade: migration v1→vN + index inversé si corpus > quelques centaines de chunks.
export const MANUAL_INDEX_VERSION = 1;
export const MANUAL_INDEX_KEY = "manuals:index:v1";

export interface ManualIndex {
  readonly version: number;
  readonly chunkKeys: string[];
  readonly chunkCount: number;
  /** ISO-8601 du build, traçabilité rebuild. */
  readonly builtAt: string;
}

export interface ParsedManualSource {
  readonly platform: string;
  readonly title: string;
  /** -1 si page illisible (source legacy). */
  readonly page: number;
}

// Inverse de formatSource : citation structurée pour corrigés phase 9
// (source + page + extrait = chunk.text). Pur, jamais de throw.
export function parseManualSource(source: string): ParsedManualSource {
  const parts = source.split("•").map((p) => p.trim());
  if (parts.length < 3) return { platform: parts[0] ?? source, title: parts[1] ?? source, page: -1 };
  const m = parts[parts.length - 1].match(/^p\.(\d+)$/);
  return {
    platform: parts[0],
    title: parts.slice(1, -1).join(" • ") || parts[1],
    page: m ? Number(m[1]) : -1,
  };
}

// Construit chunks + persiste + écrit manifeste. Idempotent : rebuild écrase.
// Deux docs de même docId ne s'écrasent pas (suffixe d'occurrence sur la clé),
// et les chunks du manifeste précédent absents du nouveau sont purgés.
export async function buildManualIndex(
  store: StorageProvider,
  docs: ManualDoc[],
  maxLen = 500,
): Promise<{ index: ManualIndex; chunks: ManualChunk[] }> {
  const chunks = docs.flatMap((d) => chunkManual(d, maxLen));
  const keys = uniqueChunkKeys(chunks);
  const previous = await loadManualIndex(store);
  await saveManualChunks(store, chunks, keys);
  if (previous) {
    const kept = new Set(keys);
    for (const key of previous.chunkKeys) if (!kept.has(key)) await store.set(key, EMPTY);
  }
  const index: ManualIndex = {
    version: MANUAL_INDEX_VERSION,
    chunkKeys: keys,
    chunkCount: chunks.length,
    builtAt: new Date().toISOString(),
  };
  await store.set(MANUAL_INDEX_KEY, enc.encode(JSON.stringify(index)));
  return { index, chunks };
}

// chunkKey = docId:index : deux chunks distincts de même docId:index (docId
// dupliqué par le scraper) doivent rester adressables -> suffixe #n.
function uniqueChunkKeys(chunks: ManualChunk[]): string[] {
  const seen = new Map<string, number>();
  return chunks.map((c) => {
    const base = chunkKey(c.docId, c.index);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}#${n + 1}`;
  });
}

function isManualIndex(v: unknown): v is ManualIndex {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    o["version"] === MANUAL_INDEX_VERSION &&
    Array.isArray(o["chunkKeys"]) &&
    (o["chunkKeys"] as unknown[]).every((k) => typeof k === "string") &&
    typeof o["chunkCount"] === "number" &&
    typeof o["builtAt"] === "string"
  );
}

// null si absent, corrompu ou version inconnue → rebuild côté appelant.
export async function loadManualIndex(store: StorageProvider): Promise<ManualIndex | null> {
  const raw = await store.get(MANUAL_INDEX_KEY);
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(dec.decode(raw));
    return isManualIndex(v) ? v : null;
  } catch {
    return null;
  }
}

// Charge tous les chunks via manifeste. Chunks illisibles = ignorés.
export async function loadIndexedChunks(store: StorageProvider): Promise<ManualChunk[]> {
  const index = await loadManualIndex(store);
  if (!index) return [];
  const out: ManualChunk[] = [];
  for (const key of index.chunkKeys) {
    const raw = await store.get(key);
    if (!raw || raw.length === 0) continue;
    try {
      const v = JSON.parse(dec.decode(raw)) as ManualChunk;
      if (v.docId && typeof v.text === "string" && typeof v.source === "string") out.push(v);
    } catch {
      continue;
    }
  }
  return out;
}

// Recherche citable sur index persisté (#26) : chaque hit porte
// source (platform • titre • p.N, parsable via parseManualSource)
// + extrait (chunk.text). Vide si index absent/requête vide/sans hit.
export async function searchManualIndex(
  store: StorageProvider,
  query: string,
  limit = 3,
): Promise<ManualChunk[]> {
  return retrieveManuals(await loadIndexedChunks(store), query, limit);
}

const CHUNK_PREFIX = "manuals:chunk:";

function chunkKey(docId: string, index: number): string {
  return `${CHUNK_PREFIX}${docId}:${index}`;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
/** Valeur vide = chunk purgé (StorageProvider n'a pas de delete). */
const EMPTY = new Uint8Array(0);

// keys optionnel = clés calculées par le caller (docId dupliqué), sinon
// chunkKey(docId, index).
export async function saveManualChunks(
  store: StorageProvider,
  chunks: ManualChunk[],
  keys?: readonly string[],
): Promise<void> {
  for (const [i, c] of chunks.entries()) {
    const key = keys?.[i] ?? chunkKey(c.docId, c.index);
    await store.set(key, enc.encode(JSON.stringify(c)));
  }
}

export async function loadManualChunk(
  store: StorageProvider,
  docId: string,
  index: number,
): Promise<ManualChunk | null> {
  const raw = await store.get(chunkKey(docId, index));
  if (!raw || raw.length === 0) return null;
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
