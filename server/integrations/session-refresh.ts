// Refresh de session Pronote (#87, parité Papillon) : le jeton/sessionPronote
// est valable quelques minutes, on le renouvelle donc AVANT chaque lecture au
// lieu de laisser une lecture échouer en « session expirée ».
// Règles tenues ici (elles sont la raison d'être du module) :
//   - TTL 5 min : une session fraîche n'est PAS renouvelée (zéro requête inutile,
//     zéro charge Pronote) ;
//   - sérialisé PAR COMPTE : une seule renewal à la fois, les appels concurrents
//     partagent le même résultat (jamais deux logins en parallèle) ;
//   - timeout 10 s : une renewal qui dépasse le délai rend une erreur typée, elle
//     ne bloque pas le lecteur indéfiniment ;
//   - retry ≤ 1 : un seul nouvel essai après backoff court.
//
// Horloge ET sleeper sont INJECTÉS : aucun `setTimeout` réel, aucun `Date.now()`
// caché → le test est déterministe (tests/unit/sync-refresh.test.ts).
// Aucun secret stocké ici : la renewal est fournie par l'appelant qui détient
// les credentials (PronoteSessionStore ne les conserve pas non plus).
// ponytail: pas de file d'attente, pas de backoff exponentiel, pas de jitter.
// Upgrade:Renewer par adaptateur + espace de renewal partagé multi-Workers.

/** Durée de vie d'une session avant renewal (5 min, comme Papillon). */
export const SESSION_REFRESH_TTL_MS = 5 * 60 * 1000;
/** Délai maximal d'une renewal (borne de lecture, jamais d'attente infinie). */
export const SESSION_REFRESH_TIMEOUT_MS = 10_000;
/** Backoff avant l'unique nouvel essai. */
export const SESSION_REFRESH_RETRY_DELAY_MS = 200;
/** Nombre total de tentatives (1 essai + 1 retry, comme PronoteHttpClient). */
export const SESSION_REFRESH_ATTEMPTS = 2;

export type SessionRefreshErrorCode = "timeout" | "renew_failed";

export class SessionRefreshError extends Error {
  readonly code: SessionRefreshErrorCode;
  constructor(message: string, code: SessionRefreshErrorCode) {
    super(message);
    this.name = "SessionRefreshError";
    this.code = code;
  }
}

/** Renewal fournie par l'appelant (login ENT/Pronote), jamais un secret ici. */
export type SessionRenewer = (accountId: string) => Promise<void>;

export interface SessionRefresherOptions {
  readonly renew: SessionRenewer;
  readonly ttlMs?: number;
  readonly timeoutMs?: number;
  readonly retryDelayMs?: number;
  readonly now?: () => number;
  /** Utilisé pour le backoff ET le délai maximal (déterministe en test). */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly logger?: (message: string) => void;
}

export interface SessionRefreshOutcome {
  /** true = une renewal a eu lieu, false = session encore fraîche. */
  readonly refreshed: boolean;
  /** Tentatives réellement consommées (0 si session fraîche). */
  readonly attempts: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class SessionRefresher {
  private readonly renew: SessionRenewer;
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private readonly retryDelayMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly logger: (message: string) => void;
  /** accountId → renewal en cours (sérialisation) ou dernière réussie. */
  private readonly inflight = new Map<string, Promise<SessionRefreshOutcome>>();
  private readonly renewedAt = new Map<string, number>();

  constructor(options: SessionRefresherOptions) {
    if (typeof options?.renew !== "function") throw new Error("renew requis (renouvellement injecté)");
    this.renew = options.renew;
    this.ttlMs = options.ttlMs ?? SESSION_REFRESH_TTL_MS;
    this.timeoutMs = options.timeoutMs ?? SESSION_REFRESH_TIMEOUT_MS;
    this.retryDelayMs = options.retryDelayMs ?? SESSION_REFRESH_RETRY_DELAY_MS;
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? defaultSleep;
    this.logger = options.logger ?? (() => {});
  }

  /** Session renouvelée il y a moins de 5 min = encore fraîche. */
  isFresh(accountId: string): boolean {
    const at = this.renewedAt.get(accountId);
    return at !== undefined && this.now() - at < this.ttlMs;
  }

  /**
   * Renouvelle la session si elle approche de l'expiration. Les appels
   * concurrents sur un même compte partagent la renewal en cours.
   * Ne lève PAS d'erreur « session fraîche » : un refresh inutile est un succès
   * sans requête (`refreshed: false`).
   */
  refresh(accountId: string): Promise<SessionRefreshOutcome> {
    const id = accountId.trim();
    if (id === "") return Promise.resolve({ refreshed: false, attempts: 0 });
    if (this.isFresh(id)) return Promise.resolve({ refreshed: false, attempts: 0 });
    const pending = this.inflight.get(id);
    if (pending) return pending;
    const run = this.runRenewal(id).finally(() => {
      this.inflight.delete(id);
    });
    this.inflight.set(id, run);
    return run;
  }

  /** Oublie le horodatage (invalidation de session, logout, changement d'IP). */
  forget(accountId: string): void {
    this.renewedAt.delete(accountId.trim());
  }

  /** Session ouverte à l'instant : déjà fraîche, aucune renewal à venir. */
  markFresh(accountId: string): void {
    const id = accountId.trim();
    if (id === "") return;
    this.renewedAt.set(id, this.now());
  }

  private async runRenewal(accountId: string): Promise<SessionRefreshOutcome> {
    let attempts = 0;
    let last: unknown;
    for (let attempt = 1; attempt <= SESSION_REFRESH_ATTEMPTS; attempt++) {
      attempts = attempt;
      if (attempt > 1) await this.sleep(this.retryDelayMs);
      try {
        await this.withDeadline(this.renew(accountId));
        this.renewedAt.set(accountId, this.now());
        this.logger(`session refresh -> ok (${attempts} essai(s))`);
        return { refreshed: true, attempts };
      } catch (err) {
        last = err;
        // Session morte / credentials refusés par l'ENT = inutile de
        // réessayer : l'app doit se ré-appairer. L'erreur remonte telle quelle,
        // jamais dégradée en échec retryable générique.
        if (isDefinitive(err)) {
          this.logger(`session refresh -> error ${authCode(err)}`);
          throw err;
        }
        // Timeout = renewal enlisée (réseau figé) : on ne retente pas, comme
        // PronoteHttpClient qui ne retry pas un abort. Attendre 10 s de plus ne
        // rendrait pas la session plus fraîche.
        if (err instanceof SessionRefreshError && err.code === "timeout") {
          this.logger("session refresh -> error timeout");
          throw err;
        }
        this.logger(`session refresh -> echec (${attempts} essai(s))`);
      }
    }
    // Le message d'origine est conservé pour que l'appelant classe l'échec
    // (timeout / réseau / session morte) ; il ne sort jamais vers l'app, qui ne
    // reçoit que le code typé.
    throw new SessionRefreshError(
      last instanceof Error && last.message !== "" ? last.message : "session refresh failed",
      last instanceof SessionRefreshError ? last.code : "renew_failed",
    );
  }

  /**
   * Borne le délai d'une renewal : le sleeper est le même en prod et en test,
   * donc le test reste déterministe (sleeper contrôlé, aucun setTimeout réel).
   * Pas d'AbortSignal : la renewal est un login externe dont on ne détient pas
   * le handle pour l'annuler.
   * ponytail: le minuteur de la deadline reste armé jusqu'à 10 s après une
   * renewal rapide (une promesse pendante, pas de fuite mémoire ni de boucle).
   * Upgrade: sleeper annulable (`cancelSleep`) pour réarmer l'échéance.
   */
  private withDeadline(work: Promise<void>): Promise<void> {
    if (this.timeoutMs <= 0) return work;
    return Promise.race([
      work,
      this.sleep(this.timeoutMs).then(() => {
        throw new SessionRefreshError("session refresh timeout", "timeout");
      }),
    ]);
  }
}

/**
 * Lecture structurelle du discriminant plutôt qu'un import de PronoteAuthError :
 * ce module reste sans dépendance runtime (donc déplaçable), et l'on ne
 * masque jamais une erreur venue d'un adaptateur.
 */
function isPronoteAuthError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: unknown }).name === "PronoteAuthError"
  );
}

function authCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "session_expired";
}

/**
 * Échecs DÉFINITIFS : un nouvel essai ne les changera pas. `session_expired`
 * (session morte) et `invalid_credentials` (ENT/CAS a refusé le couple
 * identifiant/mot de passe) imposent un ré-appairage côté app, donc pas de
 * retry et pas de déclassement en erreur retryable.
 */
function isDefinitive(err: unknown): boolean {
  return (
    isPronoteAuthError(err) &&
    (authCode(err) === "session_expired" || authCode(err) === "invalid_credentials")
  );
}