// Sessions Pronote via SSO ENT Ninegate + Client pronotets (MIT).
// Remplace le stub POST /auth (404 live) : vraie chaîne SSO validée live #73.
// Hiérarchie : Domain → PronoteProvider → PronoteSessionStore → pronotets Client → HTTP (I2).
// Secrets (password) en body POST SSO uniquement, jamais en log/URL.
// Sorties = données, jamais instructions (I6) : lectures marquées Untrusted côté provider.
// pronytail: Client pronotets unique par accountId, pas de client HTTP parallèle.
// Upgrade: multi-ENT via même interface.
import { randomUUID } from "node:crypto";
import type { PronoteAuthErrorCode, PronoteCredentials, PronoteProvider, PronoteQr, PronoteSession } from "../domain/ports";
import { PronoteAuthError } from "../domain/ports";
import { ninegateHubixEduconnect } from "./ent-ninegate";
import { SessionRefresher } from "./session-refresh";
import type { SessionRenewer } from "./session-refresh";
import type { CookieJar } from "tough-cookie";

export interface PronoteSessionStoreOptions {
  /**
   * URL Pronote PAR DÉFAUT (jamais en dur, jamais loggée). #118 : optionnelle —
   * un setup piloté par l'app fournit son URL par session, donc un serveur sans
   * `PRONOTE_URL` peut déjà ouvrir une session (avant : aucune session possible).
   */
  readonly pronoteUrl?: string;
  /** Résolveur ENT injectable (tests) : défaut ninegateHubixEduconnect (SSO complet). */
  readonly entLogin?: typeof ninegateHubixEduconnect;
  readonly logger?: (message: string) => void;
  /**
   * #87 : renewal de session (TTL 5 min, sérialisée, timeout 10 s, retry 1).
   * Fournie par l'appelant qui détient les credentials : ce store ne conserve
   * JAMAIS de mot de passe. Absente = pas de renewal (la session sert jusqu'à
   * son expiration naturelle, comportement d'avant #87).
   */
  readonly renew?: SessionRenewer;
  /** Horloge injectée (tests déterministes), sleeper idem via SessionRefresher. */
  readonly now?: () => number;
  /** #118 : uuid d'appareil pour `qrcodeLogin` (tests : générateur déterministe). */
  readonly uuid?: () => string;
}

// Type minimal du Client pronotets (évite import type profond non exporté).
export interface PronoteClientLike {
  readonly periods: { readonly length: number }[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/** Options communes aux deux modes de connexion Pronote (entKind ou qr). */
export interface ClientFactoryOptions {
  readonly ent: (u: string, p: string, o: any) => Promise<CookieJar>;
  /**
   * #118 : mode QR de l'établissement. `uuid` est l'identifiant d'appareil
   * transmis à pronotets (généré et mémorisé par session, jamais réutilisé
   * d'un compte à l'autre).
   */
  readonly qr?: { readonly qr: PronoteQr; readonly pin: string; readonly uuid: string };
}

export type ClientFactory = (
  pronoteUrl: string,
  username: string,
  password: string,
  opts: ClientFactoryOptions,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) => Promise<any>;

/** Import paresseux : pronotets chargé uniquement à l'auth (pas au boot/tests unit). */
async function defaultClientFactory(
  pronoteUrl: string,
  username: string,
  password: string,
  opts: ClientFactoryOptions,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const { Client } = await import("pronotets");
  // QR : la connexion n'est PAS un login identifiant/mot de passe mais le
  // `qrcodeLogin` (login + jeton de l'établissement, déchiffrés par le Pin).
  // L'URL vient du QR quand il en porte une, sinon de l'URL saisie au setup.
  if (opts.qr) {
    return Client.qrcodeLogin(
      { ...opts.qr.qr, url: opts.qr.qr.url ?? pronoteUrl } as never,
      opts.qr.pin,
      opts.qr.uuid,
    );
  }
  return Client.login(pronoteUrl, username, password, { ent: opts.ent });
}

function toAuthError(err: unknown): PronoteAuthError {
  const msg = err instanceof Error ? err.message : "";
  if (/identifiants|credentials|login information|wrong/i.test(msg)) {
    return new PronoteAuthError("invalid credentials", "invalid_credentials");
  }
  if (/timeout|timed out/i.test(msg)) return new PronoteAuthError("auth timeout", "timeout");
  if (/network|fetch failed|injoignable/i.test(msg)) return new PronoteAuthError("auth network", "network");
  // #118 : déchiffrement login/jeton impossible, jeton expiré, Pin faux. Le
  // message brut de la lib n'est jamais renvoyé à l'app (peut contenir de
  // l'interne) : seulement ce code typé, que l'app traduit en « rescanez ».
  if (/confirmation code|qrcode|jeton|invalid.*pin/i.test(msg)) {
    return new PronoteAuthError("qr rejected", "qr_rejected");
  }
  return new PronoteAuthError("ent unavailable", "ent_unavailable");
}

/** Renewal impossible : session morte, timeout ou échec réseau/ENT. */
function mapRefreshCode(err: unknown): PronoteAuthErrorCode {
  const msg = err instanceof Error ? err.message : "";
  if (/timeout|timed out/i.test(msg)) return "timeout";
  if (/network|fetch failed|injoignable/i.test(msg)) return "network";
  if (/identifiants|credentials|login information|wrong/i.test(msg)) return "invalid_credentials";
  if (/session|expired|expir/i.test(msg)) return "session_expired";
  return "ent_unavailable";
}

/** Codes qui tuent la session : l'app doit se ré-appairer (jamais un retry). */
const FATAL_REFRESH_CODES = new Set<PronoteAuthErrorCode>(["session_expired", "invalid_credentials"]);

/** Clé de session normalisée : l'accountId vient de l'appelant, pas de nous. */
function key(accountId: string): string {
  return (accountId ?? "").trim();
}

export class PronoteSessionStore implements PronoteProvider {
  private readonly pronoteUrl: string;
  private readonly entLogin: typeof ninegateHubixEduconnect;
  private readonly factory: ClientFactory;
  private readonly logger: (message: string) => void;
  // #87 : renewal injectée, sérialisée par compte. Null = pas de renewal.
  private readonly refresher: SessionRefresher | null;
  private readonly now: () => number;
  private readonly newUuid: () => string;
  /**
   * accountId → uuid d'appareil (#118, mode QR). Un uuid par compte, stable
   * d'une renewal à l'autre, jamais partagé entre comptes.
   */
  private readonly uuids = new Map<string, string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly clients = new Map<string, any>();
  /**
   * accountId → compteur d'invalidation. Un `invalidate()` l'incrémente : une
   * renewal partie avant le logout se voit à son retour et ne peut pas
   * ressusciter la session (cf. refreshSession).
   */
  private readonly epochs = new Map<string, number>();

  constructor(options: PronoteSessionStoreOptions & { clientFactory?: ClientFactory }) {
    // #118 : plus d'obligation — un setup piloté par l'app fournit l'URL de
    // l'établissement par session (via `PronoteCredentials.pronoteUrl`). Ni
    // l'env ni le code ne la contiennent donc jamais en dur.
    this.pronoteUrl = options.pronoteUrl ?? "";
    this.entLogin = options.entLogin ?? ninegateHubixEduconnect;
    this.factory = options.clientFactory ?? defaultClientFactory;
    this.logger = options.logger ?? (() => {});
    this.now = options.now ?? (() => Date.now());
    this.newUuid = options.uuid ?? randomUUID;
    this.refresher =
      typeof options.renew === "function"
        ? new SessionRefresher({ renew: options.renew, now: this.now, logger: this.logger })
        : null;
  }

  async authenticate(credentials: PronoteCredentials): Promise<PronoteSession> {
    const accountId = credentials?.accountId?.trim() ?? "";
    const username = credentials?.username ?? "";
    const password = credentials?.password ?? "";
    const entKind = credentials?.entKind?.trim() ?? "";
    const qr = credentials?.qr;
    const pin = (credentials?.pin ?? "").trim();
    // #118 : URL de CETTE session (setup) sinon celle du store (env).
    const url = (credentials?.pronoteUrl ?? "").trim() || this.pronoteUrl;
    if (!accountId || !url) {
      this.logger("auth -> error invalid_credentials");
      throw new PronoteAuthError("invalid credentials", "invalid_credentials");
    }
    // Mode QR : login + jeton valent preuve de détention du compte, le Pin sert
    // de clé de déchiffrement. Sans les trois, rien à tenter.
    const qrMode = qr !== undefined;
    if (!qrMode && (!username || !password || !entKind)) {
      this.logger("auth -> error invalid_credentials");
      throw new PronoteAuthError("invalid credentials", "invalid_credentials");
    }
    if (qrMode && (!qr.login || !qr.jeton || !pin)) {
      this.logger("auth -> error qr_rejected");
      throw new PronoteAuthError("qr rejected", "qr_rejected");
    }
    try {
      // Seul le SSO Ninegate est implémenté (ent-ninegate.ts). `cas` /
      // `educonnect` ne doivent surtout pas être joués en silence par la
      // chaîne Ninegate : les identifiants partiraient vers un ENT que le
      // compte n'a pas configuré. Refus franc, pas de faux SSO.
      // (Le mode QR n'emprunte pas cette chaîne : il porte sa propre preuve.)
      if (!qrMode && entKind !== "ninegate") {
        this.logger("auth -> error invalid_credentials");
        throw new PronoteAuthError("invalid credentials", "invalid_credentials");
      }
      const ent = async (u: string, p: string, o: { pronote_url: string }): Promise<CookieJar> => {
        // SSO complet Hubix→EduConnect→portail→tuile→Pronote (jar final prêt pour Client).
        return this.entLogin(u, p, { pronote_url: o.pronote_url, logger: this.logger });
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client: any = qrMode
        ? await this.factory(url, username, password, {
            ent,
            qr: { qr, pin, uuid: this.uuidFor(accountId) },
          })
        : await this.factory(url, username, password, { ent });
      this.clients.set(accountId, client);
      // #87 : session neuve = fraîche, donc pas de renewal avant la première
      // lecture (une requête de moins côté Pronote).
      this.refresher?.markFresh(accountId);
      this.logger(`auth -> ok (${qrMode ? "qr" : "ent"})`);
      return { accountId };
    } catch (err) {
      if (err instanceof PronoteAuthError) {
        this.logger(`auth -> error ${err.code}`);
        throw err;
      }
      const mapped = toAuthError(err);
      this.logger(`auth -> error ${mapped.code}`);
      throw mapped;
    }
  }

  /** uuid d'appareil du compte (mode QR #118) : généré une fois, jamais loggé. */
  private uuidFor(accountId: string): string {
    const id = key(accountId);
    const known = this.uuids.get(id);
    if (known !== undefined) return known;
    const fresh = this.newUuid();
    this.uuids.set(id, fresh);
    return fresh;
  }

  isAuthenticated(accountId: string): boolean {
    return this.clients.has(key(accountId));
  }

  /** Client pronotets authentifié, ou null si re-auth requise. Jamais loggé. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getClient(accountId: string): any | null {
    return this.clients.get(key(accountId)) ?? null;
  }

  /** Exige un client, sinon session_expired (caller doit re-authentifier). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requireClient(accountId: string): any {
    const client = this.clients.get(key(accountId));
    if (!client) throw new PronoteAuthError("session expired", "session_expired");
    return client;
  }

  /** Invalide la session (changement IP, logout). Re-auth via authenticate(). */
  invalidate(accountId: string): void {
    const id = key(accountId);
    this.clients.delete(id);
    this.epochs.set(id, (this.epochs.get(id) ?? 0) + 1);
    this.refresher?.forget(id);
    this.logger("auth -> invalidate");
  }

  /**
   * #87 : validation avant lecture. Renouvelle la session si elle approche de
   * l'expiration (5 min) : sérialisé par compte, timeout 10 s, retry ≤ 1
   * (cf. SessionRefresher). Sans renewal injectée = no-op, donc les appels
   * existants ne sont pas cassés. Une session expirée ou des credentials
   * refusées par l'ENT invalident le client : le lecteur remonte alors
   * `session_expired`/`invalid_credentials` et l'app se ré-appaire.
   */
  async refreshSession(accountId: string): Promise<void> {
    if (!this.refresher) return;
    const id = key(accountId);
    // Jamais de login SSO pour un accountId jamais appairé : la clé vient de
    // l'appelant (route HTTP), une renewal y planterait une session Pronote
    // sous une clé arbitraire. `requireClient` fera échouer la lecture.
    if (!this.clients.has(id)) {
      this.logger("session refresh -> ignore (compte non appairé)");
      return;
    }
    const epoch = this.epochs.get(id) ?? 0;
    try {
      await this.refresher.refresh(id);
    } catch (err) {
      const code = err instanceof PronoteAuthError ? err.code : mapRefreshCode(err);
      // Session DÉFINITIVEMENT morte : client invalidé, l'app se ré-appaire.
      // Erreur réseau/timeout : la session ouverte reste valable, on remonte
      // seulement l'erreur (la lecture échoue, l'app réessaiera plus tard) —
      // invalider sur un timeout ferait ré-appairer pour rien.
      if (FATAL_REFRESH_CODES.has(code)) {
        this.clients.delete(id);
        this.refresher.forget(id);
      }
      // Erreur typée, jamais un secret ni un détail de renewal dans le message.
      this.logger(`session refresh -> error ${code}`);
      throw err instanceof PronoteAuthError ? err : new PronoteAuthError("session refresh failed", code);
    } finally {
      // Logout pendant la renewal : le compte a été invalidé entre-temps, donc
      // le client que la renewal vient de (re)créer est effacé — pas de
      // résurrection après `invalidate()`.
      if ((this.epochs.get(id) ?? 0) !== epoch) {
        this.clients.delete(id);
        this.refresher.forget(id);
      }
    }
  }

  /**
   * Compte appairé quand le serveur est mono-compte (#75 : l'app n'envoie pas
   * d'accountId tant que #82 n'expose pas /v1/me). null = 0 ou ≥ 2 sessions,
   * donc l'appelant retombe sur une session expirée plutôt que de deviner.
   */
  currentAccountId(): string | null {
    const keys = [...this.clients.keys()];
    return keys.length === 1 ? (keys[0] as string) : null;
  }
}
