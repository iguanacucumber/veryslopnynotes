// Contrat du pont natif. Aucun de ces appels n'est un accès réseau direct :
// la WebView est verrouillée par CSP (`connect-src 'none'`) et seul le Kotlin
// exécute les lectures/écritures Pronote.
export type BridgeMethod =
  | "app.ready"
  | "app.theme"
  | "app.setTheme"
  | "app.back"
  | "session.status"
  | "session.restore"
  | "session.logout"
  | "session.accounts"
  | "pairing.scanQr"
  | "pairing.pair"
  | "pairing.cancel"
  | "resources.cached"
  | "resources.load"
  | "resources.invalidate"
  | "resources.sync"
  | "capabilities.load"
  | "capabilities.refresh"
  | "assignments.toggle"
  | "assignments.attachment"
  | "messages.list"
  | "messages.thread"
  | "messages.reply"
  | "messages.create"
  | "messages.setRead"
  | "messages.delete"
  | "messages.recipients"
  | "settings.get"
  | "settings.saveServer"
  | "settings.subjectPrefs"
  | "settings.saveSubject"
  | "llm.status"
  | "llm.saveKey"
  | "llm.forgetKey"
  | "llm.askHomework"
  | "llm.generateRevision"
  | "revision.list"
  | "revision.load"
  | "revision.exportPdf"
  | "profile.me"
  | "profile.photo";

export type ResourceKey =
  | "grades"
  | "assignments"
  | "timetable"
  | "discussions"
  | "news"
  | "canteen"
  | "attendance"
  | "punishments"
  | "alerts"
  | "capabilities"
  | "profile"
  | "periods";

export interface ResourceParams {
  key: ResourceKey;
  query?: string;
  force?: boolean;
}

/** Enveloppe commune. Un échec réseau n'est jamais un throw Natif : `error`
 *  porte le message déjà borné, `payload` le cache éventuel. */
export interface ResourceResult {
  payload: string | null;
  fetchedAt: number;
  stale: boolean;
  error: string | null;
}

export interface BridgeError {
  code: "auth_required" | "bad_request" | "unavailable" | "unknown";
  message: string;
}

export class BridgeCallError extends Error {
  constructor(
    readonly code: BridgeError["code"],
    message: string,
  ) {
    super(message);
    this.name = "BridgeCallError";
  }
}

export interface SessionStatus {
  state: "restored" | "no_session" | "dead" | "offline";
  message?: string;
}

export interface SettingsSnapshot {
  theme: "SYSTEM" | "LIGHT" | "DARK";
  serverHost: string;
  llmConfigured: boolean;
  accountCount: number;
}

export interface SubjectPref {
  subject: string;
  color: string | null;
  emoji: string | null;
  label: string | null;
}

export interface PairParams {
  qr: { login: string; jeton: string; url: string };
  pin: string;
}

export interface PairResult {
  ok: boolean;
  code?: string;
  message?: string;
}
