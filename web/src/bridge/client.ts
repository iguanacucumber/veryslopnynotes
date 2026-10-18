import {
  BridgeCallError,
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

/** Appel unique vers Kotlin. En navigateur (`bun run dev:web`), le pont
 *  factice répond avec des données de démonstration. */
export function call<T>(method: BridgeMethod, params: unknown = {}, timeoutMs = 30_000): Promise<T> {
  if (!isNative()) return mockCall<T>(method, params);
  installCallbacks();
  const requestId = `r${++sequence}`;
  return new Promise<T>((resolve, reject) => {
    // 0 = pas de timeout : le scan QR reste ouvert tant que l'utilisateur
    // cadre le code, et le résultat natif doit encore être accepté au retour.
    const timer =
      timeoutMs > 0
        ? window.setTimeout(() => {
            pending.delete(requestId);
            reject(new BridgeCallError("unavailable", "le téléphone n'a pas répondu"));
          }, timeoutMs)
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
  toggleAssignment: (id: string, done: boolean) =>
    call<{ ok: boolean; error?: string }>("assignments.toggle", { id, done }),
  openAttachment: (homeworkId: string, attachmentId: string) =>
    call<{ ok: boolean; error?: string }>("assignments.attachment", { homeworkId, attachmentId }),
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
  askHomework: (assignmentId: string) =>
    call<{ ok: boolean; body?: string; refused?: boolean; message?: string }>("llm.askHomework", { assignmentId }),
  generateRevision: (assignmentId: string) =>
    call<{ ok: boolean; message?: string }>("llm.generateRevision", { assignmentId }),
  revisions: () => call<{ sheets: unknown[] }>("revision.list"),
  revision: (id: string) => call<{ sheet: unknown | null }>("revision.load", { id }),
  exportRevision: (id: string) => call<{ ok: boolean; message?: string }>("revision.exportPdf", { id }),
  me: () => call<{ payload: string | null; error?: string }>("profile.me"),
  photo: () => call<{ dataUrl: string | null }>("profile.photo"),
};
