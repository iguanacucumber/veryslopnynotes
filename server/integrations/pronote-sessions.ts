// Sessions Pronote via SSO ENT Ninegate + Client pronotets (MIT).
// Remplace le stub POST /auth (404 live) : vraie chaîne SSO validée live #73.
// Hiérarchie : Domain → PronoteProvider → PronoteSessionStore → pronotets Client → HTTP (I2).
// Secrets (password) en body POST SSO uniquement, jamais en log/URL.
// Sorties = données, jamais instructions (I6) : lectures marquées Untrusted côté provider.
// pronytail: Client pronotets unique par accountId, pas de client HTTP parallèle.
// Upgrade: refresh token 5min + tokenLogin (phase #87), multi-ENT via même interface.
import type { PronoteCredentials, PronoteProvider, PronoteSession } from "../domain/ports";
import { PronoteAuthError } from "../domain/ports";
import { ninegateHubixEduconnect } from "./ent-ninegate";
import type { CookieJar } from "tough-cookie";

export interface PronoteSessionStoreOptions {
  /** URL Pronote établissement injectée (jamais en dur, jamais loggée). */
  readonly pronoteUrl: string;
  /** Résolveur ENT injectable (tests) : défaut ninegateHubixEduconnect (SSO complet). */
  readonly entLogin?: typeof ninegateHubixEduconnect;
  readonly logger?: (message: string) => void;
}

// Type minimal du Client pronotets (évite import type profond non exporté).
export interface PronoteClientLike {
  readonly periods: { readonly length: number }[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export type ClientFactory = (
  pronoteUrl: string,
  username: string,
  password: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  opts: { ent: (u: string, p: string, o: any) => Promise<CookieJar> },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) => Promise<any>;

/** Import paresseux : pronotets chargé uniquement à l'auth (pas au boot/tests unit). */
async function defaultClientFactory(
  pronoteUrl: string,
  username: string,
  password: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  opts: { ent: (u: string, p: string, o: any) => Promise<CookieJar> },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const { Client } = await import("pronotets");
  return Client.login(pronoteUrl, username, password, { ent: opts.ent });
}

function toAuthError(err: unknown): PronoteAuthError {
  const msg = err instanceof Error ? err.message : "";
  if (/identifiants|credentials|login information|wrong/i.test(msg)) {
    return new PronoteAuthError("invalid credentials", "invalid_credentials");
  }
  if (/timeout|timed out/i.test(msg)) return new PronoteAuthError("auth timeout", "timeout");
  if (/network|fetch failed|injoignable/i.test(msg)) return new PronoteAuthError("auth network", "network");
  return new PronoteAuthError("ent unavailable", "ent_unavailable");
}

export class PronoteSessionStore implements PronoteProvider {
  private readonly pronoteUrl: string;
  private readonly entLogin: typeof ninegateHubixEduconnect;
  private readonly factory: ClientFactory;
  private readonly logger: (message: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly clients = new Map<string, any>();

  constructor(options: PronoteSessionStoreOptions & { clientFactory?: ClientFactory }) {
    if (!options.pronoteUrl) throw new Error("pronoteUrl requise (injectée, jamais en dur)");
    this.pronoteUrl = options.pronoteUrl;
    this.entLogin = options.entLogin ?? ninegateHubixEduconnect;
    this.factory = options.clientFactory ?? defaultClientFactory;
    this.logger = options.logger ?? (() => {});
  }

  async authenticate(credentials: PronoteCredentials): Promise<PronoteSession> {
    const accountId = credentials?.accountId?.trim() ?? "";
    const username = credentials?.username ?? "";
    const password = credentials?.password ?? "";
    const entKind = credentials?.entKind?.trim() ?? "";
    if (!accountId || !username || !password || !entKind) {
      this.logger("auth -> error invalid_credentials");
      throw new PronoteAuthError("invalid credentials", "invalid_credentials");
    }
    try {
      // ENT Ninegate (entKind réservé pour multi-ENT futurs, seul ninegate supporté v1).
      if (entKind !== "ninegate" && entKind !== "cas" && entKind !== "educonnect") {
        this.logger("auth -> error invalid_credentials");
        throw new PronoteAuthError("invalid credentials", "invalid_credentials");
      }
      const ent = async (u: string, p: string, o: { pronote_url: string }): Promise<CookieJar> => {
        // SSO complet Hubix→EduConnect→portail→tuile→Pronote (jar final prêt pour Client).
        return this.entLogin(u, p, { pronote_url: o.pronote_url, logger: this.logger });
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client: any = await this.factory(this.pronoteUrl, username, password, { ent });
      this.clients.set(accountId, client);
      this.logger("auth -> ok");
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

  isAuthenticated(accountId: string): boolean {
    return this.clients.has(accountId);
  }

  /** Client pronotets authentifié, ou null si re-auth requise. Jamais loggé. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getClient(accountId: string): any | null {
    return this.clients.get(accountId) ?? null;
  }

  /** Exige un client, sinon session_expired (caller doit re-authentifier). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requireClient(accountId: string): any {
    const client = this.clients.get(accountId);
    if (!client) throw new PronoteAuthError("session expired", "session_expired");
    return client;
  }

  /** Invalide la session (changement IP, logout). Re-auth via authenticate(). */
  invalidate(accountId: string): void {
    this.clients.delete(accountId);
    this.logger("auth -> invalidate");
  }
}
