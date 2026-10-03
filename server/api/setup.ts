// API #118 — POST /v1/setup : le flux « tout marche » en UN appel.
// L'app a déjà saisi l'adresse du serveur (hors contrat, `GET /v1/health` y
// répond) ; elle envoie ici tout ce qui identifie l'établissement, et reçoit le
// jeton de device UNE SEULE FOIS, exactement comme l'appairage QR+PIN.
//
// Deux méthodes, jamais jouées ensemble :
//   • `qr`         — le QR affiché par l'app Pronote/ENT (login + jeton + Pin).
//                     Porte sa propre preuve de détention du compte : elle prime.
//   • `credentials` — identifiants EduConnect/ENT.
//
// Pourquoi pas les deux à la suite : ce sont deux connexions PRONOTE complètes
// et exclusives. Enchaîner une SSO puis un `qrcodeLogin` sur le même compte ne
// ferait que tuer la première session. Le serveur retient donc le QR s'il est
// fourni, sinon les identifiants — et ne consomme qu'une tentative.
//
// Codes de rejets distincts et ACTIONNABLES (jamais un 401 : un 401 déconnecte
// l'app alors qu'il s'agit de ce que l'utilisateur vient de saisir). Les
// messages ne reprennent jamais le message brut de la lib (I6, règle d'or) :
// un code typé, que l'app traduit.

import { createHash } from "node:crypto";
import type { Device } from "../../shared/contracts/models";
import type { SetupRequest } from "../../shared/contracts/api";
import type { PronoteAuthError, PronoteCredentials, PronoteProvider, PronoteQr } from "../domain/ports";

export type SetupFailure =
  | "unavailable"
  | "bad_url"
  | "throttled"
  | "qr_rejected"
  | "login_refused"
  | "ent_unreachable";

export type SetupResult =
  | { readonly ok: true; readonly device: Device; readonly token: string; readonly accountId: string }
  | { readonly ok: false; readonly failure: SetupFailure };

export interface SetupDeps {
  /** Provider de session. `null` = aucun branchement : 501 honnête, jamais un faux succès. */
  readonly sessions: PronoteProvider | null;
  /** Émet le credential d'appareil (même secret que l'appairage). */
  readonly issue: () => { device: Device; token: string };
  /**
   * Session déjà ouverte par l'env au démarrage : le setup n'a alors rien à
   * faire d'autre que rendre le jeton. Forcer une seconde connexion casserait le
   * mono-compte (`currentAccountId()` = null dès deux sessions).
   */
  readonly existingAccountId?: () => string | null;
  /**
   * Session ouverte → l'appelant memorise les identifiants (renewal, #118) puis
   * warms le snapshot, HORS du chemin critique : le jeton ne doit pas dépendre
   * d'une relecture complète (I6 : ne pas annoncer un refresh qui n'a pas eu lieu).
   * Reçoit les credentials pour qu'aucun mot de passe ne soit reconstruit ailleurs.
   */
  readonly onOpened?: (accountId: string, credentials: PronoteCredentials) => void;
  /**
   * URL d'établissement ÉPINGLÉE par l'exploitant (`PRONOTE_URL`). Fournie, le
   * client ne peut pas rediriger ce serveur vers une autre école. Absente (null
   * ou undefined) = le serveur accueille l'URL saisie au setup.
   */
  readonly allowedSchoolUrl?: string | null;
  /** Plafond d'échecs (anti-bruit hors ligne). Défaut : jeton neuf à chaque route. */
  readonly throttle?: SetupThrottle;
  readonly logger?: (message: string) => void;
}

/**
 * accountId = empreinte de l'identité fournie, jamais l'identité : il apparaît
 * dans les logs, les snapshots et les événements SSE (règle d'or dépôt).
 * Même forme que le compte issu de l'env, donc le mono-compte partage la clé.
 */
export function accountIdFrom(identity: string): string {
  return createHash("sha256").update(`pronote:${identity.trim()}`).digest("hex").slice(0, 16);
}

/** Erreur d'auth PRONOTE → rejet de setup actionnable. Jamais de message brut. */
function toFailure(err: PronoteAuthError): SetupFailure {
  switch (err.code) {
    case "qr_rejected":
      return "qr_rejected";
    case "invalid_credentials":
      return "login_refused";
    case "network":
    case "timeout":
    case "ent_unavailable":
      return "ent_unreachable";
    // `session_expired` pendant une ouverture = l'ENT a refermé la session
    // aussitôt : pour l'utilisateur c'est un échec d'authentification.
    default:
      return "login_refused";
  }
}

/**
 * #118 : l'URL de l'établissement est CHOISIE PAR LE CLIENT, or c'est le serveur
 * qui va la appeler. Sans garde-fou, `/v1/setup` devient un relais SSRF vers le
 * réseau interne (http://10.0.0.1/, http://169.254.169.254/…). On refuse donc
 * tout hôte qui n'est pas un nom public ou une IP publique.
 * ponytail: filtre LITTÉRAL (pas de résolution DNS) — c'est le garde-fou qui
 * tient sans dépendance ni aller-retour réseau. Résiduel assumé : un nom DNS
 * pointant sur une IP privée passe (rebinding). Upgrade: résolution + épinglage
 * de l'IP résolue dans le client Pronote.
 */
export function isPublicSchoolUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "" || host === "localhost" || host.endsWith(".localhost")) return false;
  // IPv4 littérale : refuses les plages privées/loopback/link-local.
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    return true;
  }
  if (host === "::1" || host === "::" || host.startsWith("fe80") || host.startsWith("fc") || host.startsWith("fd")) {
    return false;
  }
  return true;
}

/**
 * Même établissement que l'URL épinglée par l'exploitant (`PRONOTE_URL`) :
 * même schéma + hôte + chemin (barre finale ignorée). Une URL illisible des
 * deux côtés ne correspond jamais — un refus doit être le cas par défaut.
 */
export function sameSchool(candidate: string, pinned: string): boolean {
  try {
    const a = new URL(candidate);
    const b = new URL(pinned);
    const path = (u: URL): string => u.pathname.replace(/\/+$/, "");
    return a.protocol === b.protocol && a.host === b.host && path(a) === path(b);
  } catch {
    return false;
  }
}

/**
 * Plafond d'échecs par fenêtre, GLOBAL (le serveur est mono-compte et Nu
 * backend n'expose pas l'IP distante au handler, donc pas de clé par IP). Il
 * n'existe que pour rendre le refus bruyant hors ligne impossible à monter en
 * bot : l'utilisateur qui se trompe ressaisie librement, lui.
 * ponytail: compteur en mémoire, fenêtre glissante, purgee à l'écriture.
 */
export const SETUP_MAX_FAILURES = 20;
export const SETUP_FAILURE_WINDOW_MS = 10 * 60 * 1000;

export class SetupThrottle {
  private readonly failures: number[] = [];

  constructor(
    private readonly max: number = SETUP_MAX_FAILURES,
    private readonly windowMs: number = SETUP_FAILURE_WINDOW_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Trop d'échecs récents = refus AVANT de toucher l'ENT (aucune tentative). */
  blocked(): boolean {
    const cutoff = this.now() - this.windowMs;
    while (this.failures.length > 0 && (this.failures[0] as number) <= cutoff) this.failures.shift();
    return this.failures.length >= this.max;
  }

  /** Un échec compte ; un succès ne coûte rien (l'utilisateur n'est pas puni). */
  recordFailure(): void {
    this.failures.push(this.now());
  }
}

/** Le QR prime sur les identifiants : jamais les deux dans la même session. */
export function credentialsOf(request: SetupRequest): {
  readonly pronoteUrl: string;
  readonly username: string;
  readonly password: string;
  readonly entKind: string;
  readonly qr?: PronoteQr;
  readonly pin?: string;
} {
  const useQr = request.qr !== undefined && request.pin !== undefined;
  return {
    pronoteUrl: request.pronoteUrl,
    username: useQr ? "" : (request.username ?? ""),
    password: useQr ? "" : (request.password ?? ""),
    entKind: useQr ? "" : request.ent,
    ...(useQr ? { qr: request.qr, pin: request.pin } : {}),
  };
}

export class SetupService {
  private readonly sessions: PronoteProvider | null;
  private readonly issueToken: () => { device: Device; token: string };
  private readonly existingAccountId: () => string | null;
  private readonly onOpened: (accountId: string, credentials: PronoteCredentials) => void;
  private readonly throttle: SetupThrottle;
  private readonly allowedSchoolUrl: string | null;
  private readonly logger: (message: string) => void;

  constructor(deps: SetupDeps) {
    this.sessions = deps.sessions;
    this.issueToken = deps.issue;
    this.existingAccountId = deps.existingAccountId ?? (() => null);
    this.onOpened = deps.onOpened ?? (() => {});
    this.throttle = deps.throttle ?? new SetupThrottle();
    this.allowedSchoolUrl = (deps.allowedSchoolUrl ?? "").trim() || null;
    this.logger = deps.logger ?? (() => {});
  }

  async run(request: SetupRequest): Promise<SetupResult> {
    if (!this.sessions) {
      this.logger("setup -> indisponible (aucun provider)");
      return { ok: false, failure: "unavailable" };
    }
// Garde-fou AVANT toute sortie réseau : une URL d'établissement non
    // publique ne part jamais vers Pronote (le serveur n'est pas un proxy).
    if (!isPublicSchoolUrl(request.pronoteUrl) || (request.qr?.url !== undefined && !isPublicSchoolUrl(request.qr.url))) {
      this.logger("setup -> refus bad_url");
      return { ok: false, failure: "bad_url" };
    }
    // L'exploitant a épinglé un établissement dans `PRONOTE_URL` : c'est son
    // autorité sur « quelle école ce serveur parle à ». Le client ne peut alors
    // pas rediriger les identifiants vers une autre. Sans cette ligne, une
    // route ouverte devient un relais d'authentification vers un ENT arbitraire
    // depuis l'IP du serveur — le pire scénario pour un compte scolaire.
    if (this.allowedSchoolUrl !== null && !sameSchool(request.pronoteUrl, this.allowedSchoolUrl)) {
      this.logger("setup -> refus bad_url (hors etablissement configure)");
      return { ok: false, failure: "bad_url" };
    }
    if (this.throttle.blocked()) {
      this.logger("setup -> refus throttled");
      return { ok: false, failure: "throttled" };
    }
    // Session déjà ouverte au démarrage (identifiants de l'env) : le compte
    // école est déjà là, on rend le jeton sans rejouer une connexion.
    const already = this.existingAccountId();
    if (already !== null) {
      this.logger("setup -> jeton emis (session deja ouverte)");
      return { ok: true, ...this.issueToken(), accountId: already };
    }
    // Clé de session : empreinte du `login` du QR, sinon du login ENT. Jamais
    // l'identité en clair (elle n'apparaît qu'en hash dans logs/snapshots/SSE).
    const accountId = accountIdFrom(request.qr?.login ?? request.username ?? "");
    const credentials: PronoteCredentials = { accountId, ...credentialsOf(request) };
    try {
      await this.sessions.authenticate(credentials);
    } catch (err) {
      const failure = toFailure(err as PronoteAuthError);
      this.throttle.recordFailure();
      this.logger(`setup -> refus ${failure}`);
      return { ok: false, failure };
    }
    this.onOpened(accountId, credentials);
    this.logger("setup -> ok");
    return { ok: true, ...this.issueToken(), accountId };
  }
}