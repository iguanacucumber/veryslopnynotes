import {
  BRIDGE_TIMEOUTS,
  BridgeCallError,
  DEFAULT_TIMEOUT_MS,
  MAX_PARALLEL_READS,
  type AiContextSourceMeta,
  type BridgeError,
  type BridgeMethod,
  type ExerciseHelpParams,
  type ExerciseProposal,
  type ExerciseProposeParams,
  type LessonLoadResult,
  type LessonPhotoResult,
  type LessonsSnapshot,
  type LessonSaveResult,
  type ManualSaveResult,
  type SessionStatus,
  type SettingsSnapshot,
  type PairParams,
  type PairResult,
  type ResourceParams,
  type ResourceResult,
  type SubjectPref,
  type SubjectSaveResult,
  type TeacherSaveResult,
  type TeacherThread,
  type TeacherTurnParams,
  type TeacherTurnResult,
} from "./types";

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

/** Pont factice en développement SEULEMENT : hors DEV, la branche est morte
 *  et un pont absent échoue bruyamment, jamais de fausse école. */
async function devCall<T>(method: string, params: unknown): Promise<T> {
  if (import.meta.env.DEV) {
    const { mockCall } = await import("./mock");
    return mockCall<T>(method, params);
  }
  throw new BridgeCallError("unavailable", "pont natif indisponible");
}

/** Prévient le natif qu'un appel est lâché. Best-effort, sans promesse : une
 *  promesse oubliée deviendrait un rejet non géré. */
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

/** Méthodes qui partent vers l'établissement : le natif les sérialise, le JS
 *  aussi (sinon la N-ième expire avant son tour). Liste fermée : une lecture
 *  oubliée ici ramène le bug. */
const READ_METHODS = new Set<BridgeMethod>(["resources.load", "resources.sync"]);

/** `MAX_PARALLEL_READS` en vol au plus. Le minuteur JS part au DÉPART DANS LA
 *  FILE, pas à l'appel ; un rejet ne brise pas la file. */
let readSlots = MAX_PARALLEL_READS;
const readWaiters: Array<() => void> = [];

/** Prend un emplacement s'il y en a un libre (synchrone : le départ est immédiat). */
function tryTakeReadSlot(): boolean {
  if (readSlots <= 0) return false;
  readSlots -= 1;
  return true;
}

/** Attend un emplacement (départ différé : le timer part alors). */
function waitReadSlot(): Promise<void> {
  return new Promise<void>((resolve) => readWaiters.push(resolve));
}

/** Rend un emplacement. */
function releaseReadSlot(): void {
  const next = readWaiters.shift();
  if (next) next();
  else readSlots += 1;
}

function inReadLane<T>(run: () => Promise<T>): Promise<T> {
  if (tryTakeReadSlot()) return run().finally(releaseReadSlot);
  return waitReadSlot().then(() => run().finally(releaseReadSlot));
}

function callNative<T>(
  method: BridgeMethod,
  params: unknown,
  timeoutMs?: number,
): Promise<T> {
  installCallbacks();
  const requestId = `r${++sequence}`;
  // Toujours plus que le plafond natif, sinon la réponse native est perdue.
  const budget = timeoutMs ?? BRIDGE_TIMEOUTS[method] ?? DEFAULT_TIMEOUT_MS;
  return new Promise<T>((resolve, reject) => {
    // 0 = pas de timeout : le scan QR reste ouvert tant que l'utilisateur
    // cadre le code.
    const timer =
      budget > 0
        ? window.setTimeout(() => {
            // Libère `pending` (la réponse tardive sera ignorée) et prévient
            // le natif.
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

/** Appel unique vers Kotlin. En dev, le pont factice répond ; en production
 *  un pont absent est un ÉCHEC, jamais des données fictives. */
export function call<T>(method: BridgeMethod, params: unknown = {}, timeoutMs?: number): Promise<T> {
  if (!isNative()) return devCall<T>(method, params);
  // Une seule lecture en vol : le délai natif ne couvre pas l'attente en file.
  if (READ_METHODS.has(method)) return inReadLane(() => callNative<T>(method, params, timeoutMs));
  return callNative<T>(method, params, timeoutMs);
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
  // Démo : ni QR ni PIN, même contrat que `pair`.
  pairDemo: () => call<PairResult>("pairing.pairDemo"),
  cancelPairing: () => call<{ ok: true }>("pairing.cancel"),
  // Cache indexé par (ressource, requête) : l'entrée servie est celle de la
  // requête AFFICHÉE.
  cached: (key: ResourceParams["key"], query = "") => call<ResourceResult>("resources.cached", { key, query }),
  load: (params: ResourceParams) => call<ResourceResult>("resources.load", params),
  invalidate: (key: ResourceParams["key"]) => call<{ ok: true }>("resources.invalidate", { key }),
  sync: () => call<ResourceResult>("resources.sync"),
  capabilities: () => call<{ tabs: string[] }>("capabilities.load"),
  refreshCapabilities: () => call<{ tabs: string[] }>("capabilities.refresh"),
  // Corps d'une actualité chargé À LA DEMANDE (au dépliage).
  newsItem: (id: string) => call<{ body: string }>("news.item", { id }),
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
  saveManualUrl: (url: string) => call<ManualSaveResult>("settings.saveManualUrl", { url }),
  dismissManualPrompt: () => call<{ ok: boolean }>("settings.dismissManualPrompt"),
  subjectPrefs: () => call<{ prefs: SubjectPref[] }>("settings.subjectPrefs"),
  saveSubject: (pref: SubjectPref) => call<SubjectSaveResult>("settings.saveSubject", pref),
  lessons: () => call<LessonsSnapshot>("lessons.list"),
  lesson: (id: string) => call<LessonLoadResult>("lessons.load", { id }),
  saveLesson: (lesson: { id?: string; subject: string; title: string; text: string }) =>
    call<LessonSaveResult>("lessons.save", lesson),
  deleteLesson: (id: string) => call<LessonSaveResult>("lessons.delete", { id }),
  setLessonManual: (subject: string, enabled: boolean) =>
    call<LessonSaveResult>("lessons.setManual", { subject, enabled }),
  addLessonPhoto: (subject: string, source: "camera" | "gallery") =>
    call<LessonPhotoResult>("lessons.addPhoto", { subject, source }, BRIDGE_TIMEOUTS["lessons.addPhoto"]),

  llmStatus: () => call<{ configured: boolean }>("llm.status"),
  saveLlmKey: (key: string) => call<{ ok: boolean; message?: string }>("llm.saveKey", { key }),
  forgetLlmKey: () => call<{ ok: true }>("llm.forgetKey"),
  askHomework: (assignmentId: string, weekStart: string) =>
    call<{
      ok: boolean;
      answer?: string;
      steps?: string[];
      sources?: string[];
      refused?: boolean;
      message?: string;
      refusal?: string;
      actions?: string[];
      context?: AiContextSourceMeta[];
      contextChars?: number;
      contextOmitted?: number;
    }>("llm.askHomework", { assignmentId, weekStart }),
  solveHomeworkPhoto: (assignmentId: string, weekStart: string, source: "camera" | "gallery") =>
    call<{
      ok: boolean;
      answer?: string;
      steps?: string[];
      sources?: string[];
      refused?: boolean;
      cancelled?: boolean;
      message?: string;
      refusal?: string;
      actions?: string[];
      context?: AiContextSourceMeta[];
      contextChars?: number;
      contextOmitted?: number;
    }>("llm.solvePhoto", { assignmentId, weekStart, source }, BRIDGE_TIMEOUTS["llm.solvePhoto"]),
  generateRevision: (assignmentId: string, weekStart: string) =>
    call<{
      ok: boolean;
      refused?: boolean;
      message?: string;
      refusal?: string;
      actions?: string[];
      context?: AiContextSourceMeta[];
      contextChars?: number;
      contextOmitted?: number;
    }>("llm.generateRevision", { assignmentId, weekStart }),
  /** Professeur IA contextualisé : un tour borné, sources citées. */
  teacherTurn: (params: TeacherTurnParams) =>
    call<TeacherTurnResult>("llm.teacherTurn", params),
  teacherThread: () => call<TeacherThread>("teacher.load"),
  saveTeacherThread: (thread: TeacherThread) =>
    call<TeacherSaveResult>("teacher.save", thread),
  deleteTeacherThread: () => call<TeacherSaveResult>("teacher.delete"),
  /** Exercices du manuel : proposition locale, sans appel payant. */
  proposeExercises: (params: ExerciseProposeParams) =>
    call<ExerciseProposal>("exercises.propose", params),
  /** Aide progressive sur un exercice ; `photoSource` capture la réponse. */
  helpExercise: (params: ExerciseHelpParams) =>
    call<TeacherTurnResult>("exercises.help", params, BRIDGE_TIMEOUTS["exercises.help"]),
  revisions: () => call<{ sheets: unknown[] }>("revision.list"),
  revision: (id: string) => call<{ sheet: unknown | null }>("revision.load", { id }),
  exportRevision: (id: string) => call<{ ok: boolean; message?: string }>("revision.exportPdf", { id }),
  me: () => call<{ payload: string | null; error?: string }>("profile.me"),
  photo: () => call<{ dataUrl: string | null }>("profile.photo"),
};
