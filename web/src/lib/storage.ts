// Préférences d'affichage : `localStorage` peut lever (mode privé, quota,
// WebView verrouillée). Une préférence ne doit jamais empêcher le démarrage.

export interface LocalStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStore(): LocalStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readLocal(key: string, store: LocalStore | null = defaultStore()): string | null {
  if (!store) return null;
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string, store: LocalStore | null = defaultStore()): boolean {
  if (!store) return false;
  try {
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
