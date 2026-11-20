// Identifiants = données locales (aucun secret), plafonnés à 500 entrées.
export const NEWS_READ_STORAGE_KEY = "vsn:news:read";
export const NEWS_READ_MAX = 500;
const NEWS_READ_MAX_ID = 200;
export interface ReadStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// Repli mémoire quand le stockage est absent ou refuse une écriture : sans
// lui, chaque marquage repartirait de zéro et seul le dernier ID resterait lu.
const memory = new Set<string>();
let memoryOwner: ReadStore | null = null;
// Effacement demandé mais écriture refusée : le stockage ne doit pas
// ressusciter les IDs de l'ancien compte pendant la session.
let clearedStore: ReadStore | null = null;

function replaceMemory(ids: Iterable<string>, owner: ReadStore | null): void {
  memory.clear();
  for (const id of ids) memory.add(id);
  memoryOwner = owner;
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

/** Stockage absent ou corrompu : jamais une exception ; le repli mémoire
 *  conserve les IDs marqués pendant la session. */
export function loadNewsReadIds(store: ReadStore | null = defaultStore()): Set<string> {
  if (!store) return new Set(memoryOwner === null ? memory : []);
  if (store === clearedStore) {
    return new Set(memoryOwner === store || memoryOwner === null ? memory : []);
  }
  try {
    const raw = store.getItem(NEWS_READ_STORAGE_KEY);
    const stored = normalize(raw ? (JSON.parse(raw) as unknown) : []);
    // Les IDs marqués pendant une écriture refusée restent lisibles.
    return new Set((memoryOwner === store ? [...stored, ...memory] : stored).slice(-NEWS_READ_MAX));
  } catch {
    return new Set(memoryOwner === store ? memory : []);
  }
}

export function markNewsRead(id: string, store: ReadStore | null = defaultStore()): Set<string> {
  const clean = id.trim().slice(0, NEWS_READ_MAX_ID);
  const previous = loadNewsReadIds(store);
  if (!clean) return previous;
  // Un identifiant déjà lu ne consomme pas une seconde place dans la borne.
  const next = [...new Set([...previous, clean])].slice(-NEWS_READ_MAX);
  if (store) {
    try {
      store.setItem(NEWS_READ_STORAGE_KEY, JSON.stringify(next));
      memory.clear();
      memoryOwner = store;
      clearedStore = null;
    } catch {
      // Quota ou stockage indisponible : le repli mémoire garde l'état.
      replaceMemory(next, store);
    }
  } else {
    replaceMemory(next, null);
  }
  return new Set(next);
}

/** Déconnexion ou changement de compte (I16) : les IDs lus du compte
 *  précédent ne s'appliquent pas au suivant. */
export function clearNewsReadIds(store: ReadStore | null = defaultStore()): void {
  memory.clear();
  memoryOwner = null;
  clearedStore = store;
  if (!store) return;
  try {
    store.setItem(NEWS_READ_STORAGE_KEY, "[]");
  } catch {
    // Stockage indisponible : le tombstone mémoire masque les anciens IDs.
  }
}
