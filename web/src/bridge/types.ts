// Contrat du pont natif. Aucun de ces appels n'est un accès réseau direct :
// la WebView est verrouillée par CSP (`connect-src 'none'`) et seul le Kotlin
// exécute les lectures/écritures Pronote.

/**
 * Méthodes allowlistées du pont — la source de vérité du contrat (#371).
 *
 * Le type `BridgeMethod` en découle : impossible d'appeler une méthode hors
 * liste. La liste est lisible à l'exécution, donc le test d'architecture peut
 * la comparer à l'allowlist Kotlin (`VsnBridge.METHODS`) : les deux doivent
 * être identiques, sinon une méthode est callable d'un seul côté.
 */
export const BRIDGE_METHODS = [
  "app.ready",
  "app.theme",
  "app.setTheme",
  "app.back",
  "session.status",
  "session.restore",
  "session.logout",
  "session.accounts",
  "pairing.scanQr",
  "pairing.pair",
  "pairing.pairDemo",
  "pairing.cancel",
  "resources.cached",
  "resources.load",
  "resources.invalidate",
  "resources.sync",
  "capabilities.load",
  "capabilities.refresh",
  "news.item",
  "assignments.toggle",
  "assignments.attachment",
  "messages.list",
  "messages.thread",
  "messages.reply",
  "messages.create",
  "messages.setRead",
  "messages.delete",
  "messages.recipients",
  "settings.get",
  "settings.saveServer",
  "settings.saveManualUrl",
  "settings.dismissManualPrompt",
  "settings.subjectPrefs",
  "settings.saveSubject",
  "lessons.list",
  "lessons.load",
  "lessons.save",
  "lessons.delete",
  "lessons.setManual",
  "lessons.addPhoto",
  "llm.status",
  "llm.saveKey",
  "llm.forgetKey",
  "llm.askHomework",
  "llm.solvePhoto",
  "llm.generateRevision",
  "revision.list",
  "revision.load",
  "revision.exportPdf",
  "profile.me",
  "profile.photo",
  // Abandon d'un appel que le JS a lâché : passe par `call` comme toute
  // autre méthode, le pont n'exposant qu'UNE interface (I10).
  "bridge.cancel",
] as const;

export type BridgeMethod = (typeof BRIDGE_METHODS)[number];

/**
 * Contrat de délai du pont (#371).
 *
 * Le natif attend au plus `MAX_NATIVE_WAIT_MS` (chargement des devoirs puis
 * appel LLM). Le JS doit TOUJOURS attendre plus longtemps que ce plafond :
 * sinon il abandonne la promesse, la réponse native arrive après l'abandon
 * et se perd définitivement (plus d'entrée dans `pending`). Miroir exact des
 * constantes de `VsnBridge` (Kotlin) — vérifié par les tests.
 */
export const NATIVE_WAIT_MS = {
  /** Attente par défaut d'un dépôt natif (`await`). */
  default: 20_000,
  /** Récupération d'un extrait de manuel via le scraper, avant le LLM. */
  manual: 35_000,
  /** Attente de l'appel LLM : le plus long du pont. */
  llm: 45_000,
} as const;

/** Plafond d'attente natif : chargement (20 s) + manuel (35 s) + LLM (45 s). */
export const MAX_NATIVE_WAIT_MS = NATIVE_WAIT_MS.default + NATIVE_WAIT_MS.manual + NATIVE_WAIT_MS.llm;

/** Timeout JS par défaut : au-dessus du plafond natif, sinon réponse perdue. */
export const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Lectures simultanées autorisées côté JS (#393).
 *
 * Le natif SÉRIALISE les lectures (une file locale, partagée avec le job de
 * fond) et son délai d'appel (`NATIVE_WAIT_MS.default`) ne couvre QUE le
 * travail : en parallèle, la N-ième lecture attend son tour et son délai
 * expire AVANT lui — « Lecture indisponible. ». Le JS sérialise donc aussi :
 * chaque lecture part sans attendre les autres et son délai natif couvre son
 * propre travail.
 *
 * 1 = le budget d'une lecture (le délai HTTP de l'établissement, 15 s) tient
 * dans le délai natif d'un appel (20 s). La relation est vérifiée sur les
 * sources réelles (Kotlin) par `tests/web/bridge.test.ts`.
 */
export const MAX_PARALLEL_READS = 1;

/**
 * Timeout JS par méthode (ms). 0 = pas de timeout.
 *
 * Jamais sous le plafond natif de la méthode : le scan attend que
 * l'utilisateur cadre le code, l'appairage enchaîne plusieurs allers-retours
 * Pronote bloquants (le port n'a pas de timeout global).
 */
export const BRIDGE_TIMEOUTS: Partial<Record<BridgeMethod, number>> = {
  "pairing.scanQr": 0,
  // La photo inclut le cadrage par l'élève : aucun timeout JS. Le natif a
  // son propre plafond (AWAIT_PHOTO_MS) pour ne pas pendre un fil.
  "lessons.addPhoto": 0,
  "llm.solvePhoto": 0,
  "pairing.pair": 120_000,
  // La connexion de démonstration ouvre une session sur l'établissement de
  // démonstration : c'est un aller-retour de login, comme l'appairage.
  "pairing.pairDemo": 120_000,
  "session.restore": 120_000,
};

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
  /**
   * Le stockage CHIFFRÉ (Keystore) a-t-il répondu ? `unavailable` = dégradé :
   * la session et la clé de l'assistant ne sont PAS conservées sur l'appareil
   * (repli mémoire), et l'interface doit le dire (#401).
   */
  storage?: "available" | "unavailable";
}

export interface SettingsSnapshot {
  theme: "SYSTEM" | "LIGHT" | "DARK";
  serverHost: string;
  llmConfigured: boolean;
  accountCount: number;
  /** Adresse du manuel saisie une fois ("" = aucun manuel). */
  manualUrl: string;
  /** Une adresse de manuel est enregistrée (catalogue ou ouvrage précis). */
  manualConfigured: boolean;
  /** Adresse de catalogue : l'ouvrage sera choisi par classe + matière. */
  manualAuto: boolean;
  /** Au moins un extrait est en cache. */
  manualReady: boolean;
  /** Classe devinée (« Terminale », « 1re »…) ou "". */
  manualLevel: string;
  /** Spécialités probables, déduites des matières suivies. */
  manualSpecialties: string[];
  /** L'invitation à saisir le manuel a déjà été montrée (jamais deux fois). */
  manualPromptSeen: boolean;
  /**
   * Matières pour lesquelles le manuel est réellement utilisable (résolu par
   * le catalogue et non désactivé). Une liste vide = aucune source manuel.
   */
  manualSubjects: string[];
  /** Matières qui ont au moins un cours mémorisé dans le cahier. */
  lessonSubjects: string[];
}

export interface LessonSummary {
  id: string;
  title: string;
  createdAt: string;
  chars: number;
}

export interface LessonSubject {
  subject: string;
  manualEnabled: boolean;
  manualAvailable: boolean;
  notes: LessonSummary[];
}

export interface LessonsSnapshot {
  subjects: LessonSubject[];
  maxNotesPerSubject: number;
  maxTextChars: number;
  maxTitleChars: number;
}

export interface LessonNote {
  id: string;
  subject: string;
  title: string;
  text: string;
  createdAt: string;
}

export interface LessonLoadResult {
  ok: boolean;
  note?: LessonNote;
  message?: string;
}

export interface LessonSaveResult {
  ok: boolean;
  message?: string;
}

export interface LessonPhotoResult {
  ok: boolean;
  cancelled?: boolean;
  title?: string;
  text?: string;
  message?: string;
}

/** Réponse de l'enregistrement du manuel : l'URL est gardée même si l'extrait
 *  n'a pas pu être récupéré (`ready:false` + `message` actionnable). */
export interface ManualSaveResult {
  ok: boolean;
  ready?: boolean;
  /** Adresse de catalogue : rien n'est scrapé avant le premier devoir. */
  auto?: boolean;
  level?: string;
  specialties?: string[];
  message?: string;
}

export interface SubjectPref {
  subject: string;
  color: string | null;
  emoji: string | null;
  label: string | null;
}

/**
 * Réponse du pont à l'enregistrement d'une matière (#395).
 *
 * `ok:false` = matière REFUSÉE : rien n'a été écrit, et `message` dit
 * pourquoi (couleur, emoji ou libellé hors contrat). Le pont ne répond
 * JAMAIS `ok:true` sans avoir écrit — l'interface ne doit pas annoncer une
 * sauvegarde qui n'a pas eu lieu.
 */
export interface SubjectSaveResult {
  ok: boolean;
  prefs?: SubjectPref[];
  message?: string;
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

/**
 * Métadonnée d'une source IA (#628) : « Ce qui est envoyé » côté natif.
 *
 * `type` vient de `AiContextType.wire` (assignment, course, attachment, note,
 * manual, web, history). `chars` = taille réellement envoyée, `truncated` =
 * source coupée par le budget. Aucun identifiant Pronote, secret ou URL.
 */
export interface AiContextSourceMeta {
  type: string;
  label: string;
  chars: number;
  truncated: boolean;
}
