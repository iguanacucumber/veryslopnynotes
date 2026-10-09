// Primitives partagées par les modules du lecteur (#197).
//
// bornées, conversions et typage d'erreur : rien ici ne parle à Pronote, donc
// chaque module de domaine s'appuie dessus sans réinventer le contrat.
// ponytail: plafond regex du bornage (`bounded`) — voir le commentaire de la
// fonction pour pourquoi le slice() en unités UTF-16 serait faux.
import { PronoteAuthError, PronoteReadError, PronoteWriteError } from "../../domain/ports";

/** Session Pronote injectée (PronoteSessionStore) : le seul accès au client. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ReaderCtx {
  readonly sessions: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    requireClient(accountId: string): any;
    currentAccountId?(): string | null;
    refreshSession?(accountId: string): Promise<void>;
  };
  readonly logger: (message: string) => void;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
export function clampLimit(limit?: number): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  const n = Math.floor(limit);
  if (n < 1) return DEFAULT_LIMIT;
  if (n > MAX_LIMIT) return MAX_LIMIT;
  return n;
}

export function parseOffset(cursor?: string): number {
  if (typeof cursor !== "string") return 0;
  const n = Number.parseInt(cursor.trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// Chaîne vide / espaces = valeur absente (non notée), jamais 0 : Number("")
// vaut 0 et ferait passer une note ou une moyenne de classe inexistante.
export function toNumber(v: unknown, fallback: number): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return fallback;
    const n = Number(t.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

export function toIso(d: unknown, fallback: string): string {
  if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString();
  if (typeof d === "string" && !Number.isNaN(Date.parse(d))) return new Date(d).toISOString();
  return fallback;
}

export function toReadError(err: unknown, what: string): PronoteReadError {
  if (err instanceof PronoteReadError) return err;
  if (err instanceof PronoteAuthError) {
    if (err.code === "session_expired") return new PronoteReadError(`${what} session expired`, "session_expired");
    if (err.code === "timeout") return new PronoteReadError(`${what} timeout`, "timeout");
    if (err.code === "network") return new PronoteReadError(`${what} network`, "network");
    return new PronoteReadError(`${what} pronote unavailable`, "pronote_unavailable");
  }
  const msg = err instanceof Error ? err.message : "";
  if (/session|expired|expir/i.test(msg)) return new PronoteReadError(`${what} session expired`, "session_expired");
  if (/timeout|timed out/i.test(msg)) return new PronoteReadError(`${what} timeout`, "timeout");
  if (/network|fetch failed|injoignable/i.test(msg)) return new PronoteReadError(`${what} network`, "network");
  return new PronoteReadError(`${what} pronote unavailable`, "pronote_unavailable");
}

/** Écriture (#75) : mêmes classes d'erreur que la lecture, plus `unsupported`. */
export function toWriteError(err: unknown, what: string): PronoteWriteError {
  if (err instanceof PronoteWriteError) return err;
  if (/unsupported|not.?implemented/i.test(err instanceof Error ? err.message : "")) {
    return new PronoteWriteError(`${what} unsupported`, "unsupported");
  }
  const read = toReadError(err, what);
  const code = read.code === "session_expired" ? "session_expired" : read.code;
  return new PronoteWriteError(`${what} ${code}`, code);
}

/**
 * Trim + borne dure. Vide après trim = "" (l'appelant le transforme en undefined).
 * La borne compte en POINTS DE CODE, comme `isOptionalBoundedString` du contrat
 * (models.ts) : un slice() en unités UTF-16 couperait un surrogate pair en son
 * demi-caractère orphelin, que le contrat rejetera ensuite (ou que le client
 * affichera en U+FFFD). Le chemin rapide `t.length <= max` (unités UTF-16) est
 * sûr : un texte plus court que la borne ne peut pas avoir de point de code en
 * excès, donc aucun couple ne peut être coupé.
 */
export function bounded(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  const points = [...t];
  return points.length > max ? points.slice(0, max).join("") : t;
}

/**
 * #87 : validation de session avant LECTURE. Renouvellement 5 min sérialisé
 * (timeout 10 s, retry 1) délégué au session store ; absent = aucun appel
 * (les adaptateurs de test et les stubs ne cassent pas). Une renewal
 * impossible remonte en erreur typée → l'app se ré-appaire.
 */
export async function refreshSession(ctx: ReaderCtx, id: string): Promise<void> {
  const refresh = ctx.sessions.refreshSession;
  if (typeof refresh !== "function") return;
  try {
    await refresh.call(ctx.sessions, id);
  } catch (err) {
    const mapped = toReadError(err, "session");
    ctx.logger(`session -> error ${mapped.code}`);
    throw mapped;
  }
}

/**
 * accountId vide = serveur mono-compte : on prend l'unique session appairée.
 * Aucun secret journalisé, juste une résolution de clé de session.
 * ponytail: multi-compte = l'app enverra l'accountId appairé (#82 /v1/me).
 */
export function resolveAccount(ctx: ReaderCtx, accountId: string): string {
  const id = (accountId ?? "").trim();
  if (id !== "") return id;
  try {
    return ctx.sessions.currentAccountId?.() ?? "";
  } catch {
    return "";
  }
}
