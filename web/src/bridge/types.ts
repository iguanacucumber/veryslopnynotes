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
  "pairing.cancel",
  "resources.cached",
  "resources.load",
  "resources.invalidate",
  "resources.sync",
  "capabilities.load",
  "capabilities.refresh",
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
  "settings.subjectPrefs",
  "settings.saveSubject",
  "llm.status",
  "llm.saveKey",
  "llm.forgetKey",
  "llm.askHomework",
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
  /** Attente de l'appel LLM : le plus long du pont. */
  llm: 45_000,
} as const;

/** Plafond d'attente natif : chargement (20 s) + appel LLM (45 s). */
export const MAX_NATIVE_WAIT_MS = NATIVE_WAIT_MS.default + NATIVE_WAIT_MS.llm;

/** Timeout JS par défaut : au-dessus du plafond natif, sinon réponse perdue. */
export const DEFAULT_TIMEOUT_MS = 90_000;

/**
 * Timeout JS par méthode (ms). 0 = pas de timeout.
 *
 * Jamais sous le plafond natif de la méthode : le scan attend que
 * l'utilisateur cadre le code, l'appairage enchaîne plusieurs allers-retours
 * Pronote bloquants (le port n'a pas de timeout global).
 */
export const BRIDGE_TIMEOUTS: Partial<Record<BridgeMethod, number>> = {
  "pairing.scanQr": 0,
  "pairing.pair": 120_000,
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
