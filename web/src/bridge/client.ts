import {
  BRIDGE_TIMEOUTS,
  BridgeCallError,
  DEFAULT_TIMEOUT_MS,
  type BridgeError,
  type BridgeMethod,
  type SessionStatus,
  type SettingsSnapshot,
  type PairParams,
  type PairResult,
  type ResourceParams,
  type ResourceResult,
  type SubjectPref,
} from "./types";
import { mockCall } from "./mock";

/** Surface exposée au JS : UNE seule méthode (miroir de `VsnBridge`). */
interface VsnNative {
  call(requestId: string, method: string, paramsJson: string): void;
}

declare global {
  interface Window {
    VSN?: VsnNative;
    __vsnResolve?: (requestId: string, resultJson: string) => void;
    __vsnReject?: (requestId: string, errorJson: string) => void;
  }
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: number;
};

const pending = new Map<string, Pending>();
let sequence = 0;

function installCallbacks(): void {
  if (window.__vsnResolve) return;
  window.__vsnResolve = (requestId, resultJson) => {
    const entry = pending.get(requestId);
    if (!entry) return;
    pending.delete(requestId);
    window.clearTimeout(entry.timer);
    try {
      entry.resolve(JSON.parse(resultJson) as unknown);
    } catch {
      entry.reject(new BridgeCallError("unknown", "réponse native illisible"));
    }
  };
  window.__vsnReject = (requestId, errorJson) => {
    const entry = pending.get(requestId);
    if (!entry) return;
    pending.delete(requestId);
    window.clearTimeout(entry.timer);
    let error: BridgeError = { code: "unknown", message: "erreur native" };
    try {
      const parsed = JSON.parse(errorJson) as Partial<BridgeError>;
      if (parsed.code && parsed.message) error = parsed as BridgeError;
    } catch {
      // garde le repli
    }
    entry.reject(new BridgeCallError(error.code, error.message));
  };
}

export function isNative(): boolean {
  return typeof window.VSN?.call === "function";
}

/**
 * Abandon : le natif est prévenu que l'appel est lâché, sa réponse tardive
 * sera ignorée. Signal best-effort et SANS promesse : une promesse oubliée
 * deviendrait un rejet non géré si le pont ne répondait jamais.
 */
function abort(requestId: string): void {
  try {
    window.VSN!.call(`c${++sequence}`, "bridge.cancel", JSON.stringify({ requestId }));
  } catch {
    // Pont mort : il n'y a plus de réponse à attendre.
  }
}

/** Nombre d'appels en attente — sonde de test (fuite mémoire). */
export function pendingCount(): number {
  return pending.size;
}

/** Appel unique vers Kotlin. En navigateur (`bun run dev:web`), le pont
 *  factice répond avec des données de démonstration. */
export function call<T>(method: BridgeMethod, params: unknown = {}, timeoutMs?: number): Promise<T> {
  if (!isNative()) return mockCall<T>(method, params);
  installCallbacks();
  const requestId = `r${++sequence}`;
  // Le JS attend TOUJOURS plus longtemps que le plafond natif de la méthode
  // (#371) : sinon il abandonne avant la réponse native et la perd.
  const budget = timeoutMs ?? BRIDGE_TIMEOUTS[method] ?? DEFAULT_TIMEOUT_MS;
  return new Promise<T>((resolve, reject) => {
    // 0 = pas de timeout : le scan QR reste ouvert tant que l'utilisateur
    // cadre le code, et le résultat natif doit encore être accepté au retour.
    const timer =
      budget > 0
        ? window.setTimeout(() => {
            // Abandon propre : l'entrée `pending` est libérée (la réponse
            // tardive sera ignorée) et le natif est prévenu.
            pending.delete(requestId);
            abort(requestId);
            reject(new BridgeCallError("unavailable", "le téléphone n'a pas répondu"));
          }, budget)
        : 0;
    pending.set(requestId, {
      resolve: (value) => resolve(value as T),
      reject,
      timer,
    });
    try {
      window.VSN!.call(requestId, method, JSON.stringify(params));
    } catch {
      pending.delete(requestId);
      window.clearTimeout(timer);
      reject(new BridgeCallError("unknown", "pont natif indisponible"));
    }
  });
}

export const bridge = {
  ready: () => call<{ ok: true }>("app.ready"),
  theme: () => call<{ theme: SettingsSnapshot["theme"] }>("app.theme"),
  setTheme: (theme: SettingsSnapshot["theme"]) => call<{ ok: true }>("app.setTheme", { theme }),
  back: () => call<{ handled: boolean }>("app.back"),
  sessionStatus: () => call<SessionStatus>("session.status"),
  restore: () => call<SessionStatus>("session.restore"),
  logout: () => call<{ ok: true }>("session.logout"),
  accounts: () => call<{ count: number }>("session.accounts"),
  scanQr: () => call<{ qr: PairParams["qr"] | null; cancelled: boolean }>("pairing.scanQr", {}, 0),
  pair: (params: PairParams) => call<PairResult>("pairing.pair", params),
  cancelPairing: () => call<{ ok: true }>("pairing.cancel"),
  cached: (key: ResourceParams["key"]) => call<ResourceResult>("resources.cached", { key }),
  load: (params: ResourceParams) => call<ResourceResult>("resources.load", params),
  invalidate: (key: ResourceParams["key"]) => call<{ ok: true }>("resources.invalidate", { key }),
  sync: () => call<ResourceResult>("resources.sync"),
  capabilities: () => call<{ tabs: string[] }>("capabilities.load"),
  refreshCapabilities: () => call<{ tabs: string[] }>("capabilities.refresh"),
  toggleAssignment: (id: string, done: boolean, weekStart: string) =>
    call<{ ok: boolean; error?: string }>("assignments.toggle", { id, done, weekStart }),
  openAttachment: (homeworkId: string, attachmentId: string, weekStart: string) =>
    call<{ ok: boolean; error?: string }>("assignments.attachment", { homeworkId, attachmentId, weekStart }),
  messages: () => call<{ payload: string | null }>("messages.list"),
  thread: (id: string) => call<{ payload: string | null; error?: string }>("messages.thread", { id }),
  reply: (id: string, body: string) => call<{ ok: boolean; error?: string }>("messages.reply", { id, body }),
  createMessage: (recipients: string[], subject: string, body: string) =>
    call<{ ok: boolean; error?: string }>("messages.create", { recipients, subject, body }),
  setRead: (id: string, read: boolean) => call<{ ok: boolean; error?: string }>("messages.setRead", { id, read }),
  deleteMessage: (id: string) => call<{ ok: boolean; error?: string }>("messages.delete", { id }),
  recipients: () => call<{ payload: string | null }>("messages.recipients"),
  settings: () => call<SettingsSnapshot>("settings.get"),
  saveServer: (host: string) => call<{ ok: boolean; message?: string }>("settings.saveServer", { host }),
  subjectPrefs: () => call<{ prefs: SubjectPref[] }>("settings.subjectPrefs"),
  saveSubject: (pref: SubjectPref) => call<{ ok: true; prefs: SubjectPref[] }>("settings.saveSubject", pref),
  llmStatus: () => call<{ configured: boolean }>("llm.status"),
  saveLlmKey: (key: string) => call<{ ok: boolean; message?: string }>("llm.saveKey", { key }),
  forgetLlmKey: () => call<{ ok: true }>("llm.forgetKey"),
  askHomework: (assignmentId: string, weekStart: string) =>
    call<{ ok: boolean; body?: string; refused?: boolean; message?: string }>("llm.askHomework", { assignmentId, weekStart }),
  generateRevision: (assignmentId: string) =>
    call<{ ok: boolean; message?: string }>("llm.generateRevision", { assignmentId }),
  revisions: () => call<{ sheets: unknown[] }>("revision.list"),
  revision: (id: string) => call<{ sheet: unknown | null }>("revision.load", { id }),
  exportRevision: (id: string) => call<{ ok: boolean; message?: string }>("revision.exportPdf", { id }),
  me: () => call<{ payload: string | null; error?: string }>("profile.me"),
  photo: () => call<{ dataUrl: string | null }>("profile.photo"),
};
