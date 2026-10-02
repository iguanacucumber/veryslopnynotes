// Auth ENT/CAS via IP serveur uniquement. Téléphone ne contacte jamais Pronote (I1).
// Hiérarchie : Domain → PronoteProvider → PronoteAuthProvider → PronoteHttpClient → HTTP (I2).
// Secrets (password/token) uniquement en body, jamais en path/query ni en log.
// Re-auth après changement IP : Pronote/CAS lie la session à l'IP serveur.
// Si l'IP change (VPS non fixe), la session stockée devient invalide côté
// serveur. Procédure : invalidate(accountId) puis authenticate() à nouveau.
// Choix VPS à IP fixe recommandé, sinon accepter la re-auth (voir
// docs/HUMAN_INPUTS.md, apports humains, aucune valeur ici).
// Contenu externe = donnée, jamais instruction (I6) : le token est opaque,
// jamais passé au LLM.
// ponytail: fetch natif via PronoteHttpClient uniquement, pas de nouvelle dép.
// Upgrade : lectures phase #8 réutiliseront requireToken(accountId).
import type { PronoteCredentials, PronoteProvider, PronoteSession } from "../domain/ports";
import { PronoteAuthError } from "../domain/ports";
import type { PronoteHttpClient } from "./PronoteHttpClient";
import { PronoteHttpError } from "./PronoteHttpClient";

export interface PronoteAuthProviderOptions {
  readonly client: PronoteHttpClient;
  readonly logger?: (message: string) => void;
}

function extractToken(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  const candidate = rec["token"] ?? rec["sessionToken"];
  if (typeof candidate !== "string") return null;
  const token = candidate.trim();
  return token.length > 0 ? token : null;
}

function toAuthError(err: unknown): PronoteAuthError {
  if (err instanceof PronoteAuthError) return err;
  if (err instanceof PronoteHttpError) {
    if (err.code === "timeout") return new PronoteAuthError("auth timeout", "timeout");
    if (err.code === "network") return new PronoteAuthError("auth network", "network");
    if (err.code === "http_4xx" && (err.status === 401 || err.status === 403)) {
      return new PronoteAuthError("invalid credentials", "invalid_credentials");
    }
    return new PronoteAuthError("ent unavailable", "ent_unavailable");
  }
  return new PronoteAuthError("ent unavailable", "ent_unavailable");
}

export class PronoteAuthProvider implements PronoteProvider {
  private readonly client: PronoteHttpClient;
  private readonly logger: (message: string) => void;
  private readonly tokens = new Map<string, string>();

  constructor(options: PronoteAuthProviderOptions) {
    if (!options.client) throw new Error("client requis (PronoteHttpClient injecté)");
    this.client = options.client;
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
    let raw: unknown;
    try {
      // ponytail: secrets en body uniquement (client ne log que méthode+path+status).
      // Ne jamais passer username/password/token en path/query.
      raw = await this.client.request("/auth", {
        method: "POST",
        body: { ent: entKind, login: username, password },
      });
    } catch (err) {
      const mapped = toAuthError(err);
      this.logger(`auth -> error ${mapped.code}`);
      throw mapped;
    }
    const token = extractToken(raw);
    if (!token) {
      this.logger("auth -> error ent_unavailable");
      throw new PronoteAuthError("ent unavailable", "ent_unavailable");
    }
    this.tokens.set(accountId, token);
    this.logger("auth -> ok");
    return { accountId };
  }

  isAuthenticated(accountId: string): boolean {
    return this.tokens.has(accountId);
  }

  /** Token opaque pour lectures phase #8. Null = re-auth requise. Jamais loggé. */
  getSessionToken(accountId: string): string | null {
    return this.tokens.get(accountId) ?? null;
  }

  /** Exige une session, sinon session_expired (caller doit re-authentifier). */
  requireSessionToken(accountId: string): string {
    const token = this.tokens.get(accountId);
    if (!token) throw new PronoteAuthError("session expired", "session_expired");
    return token;
  }

  /** Invalide la session (changement IP, logout). Re-auth via authenticate(). */
  invalidate(accountId: string): void {
    this.tokens.delete(accountId);
    this.logger("auth -> invalidate");
  }
}
