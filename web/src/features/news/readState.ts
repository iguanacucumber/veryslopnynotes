// Identifiants = données locales (aucun secret), plafonnés à 500 entrées.
export const NEWS_READ_STORAGE_KEY = "vsn:news:read";
export const NEWS_READ_MAX = 500;
const NEWS_READ_MAX_ID = 200;

export interface ReadStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStore(): ReadStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function normalize(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    if (out.length >= NEWS_READ_MAX) break;
    if (typeof raw !== "string") continue;
    const id = raw.trim().slice(0, NEWS_READ_MAX_ID);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Stockage absent ou corrompu : ensemble vide, jamais une exception. */
export function loadNewsReadIds(store: ReadStore | null = defaultStore()): Set<string> {
  if (!store) return new Set();
  try {
    const raw = store.getItem(NEWS_READ_STORAGE_KEY);
    return new Set(normalize(raw ? (JSON.parse(raw) as unknown) : []));
  } catch {
    return new Set();
  }
}

export function markNewsRead(id: string, store: ReadStore | null = defaultStore()): Set<string> {
  const clean = id.trim().slice(0, NEWS_READ_MAX_ID);
  const previous = loadNewsReadIds(store);
  if (!clean) return previous;
  const next = [...previous, clean].slice(-NEWS_READ_MAX);
  if (store) {
    try {
      store.setItem(NEWS_READ_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Quota ou stockage indisponible : l'état mémoire reste cohérent.
    }
  }
  return new Set(next);
}
