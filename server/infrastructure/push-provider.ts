// Adapter push v1 — implémente PushProvider (server/domain/ports.ts).
// Contrat : send(deviceTokenHash, {title, body}). Le token brut n'entre
// jamais ici : seul son hash sha256 (Device.tokenHash) circule, jamais logué
// en clair — logs = préfixe 8 chars + statut uniquement, sans clé VAPID.
// Transport : fetch natif vers PUSH_PROVIDER (URL http(s)) ou dégradé noop
// si provider symbolique. Clé privée chargée (preuve config) mais jamais
// envoyée ni loguée.
// ponytail: squelette sans JWT VAPID ES256 complet ni chiffrement WebPush
// aes128gcm. Upgrade #23 : lib épinglée+audit+MIT ou JOSE stdlib + subscription
// (endpoint/p256dh/auth) via StorageProvider.

import { createHash } from "node:crypto";
import type { PushProvider } from "../domain/ports";
import type { PushConfig } from "./push-config";
import { loadPushConfig } from "./push-config";

export class PushError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "PushError";
    this.status = status;
  }
}

export interface PushProviderOptions {
  readonly fetchFn?: typeof fetch;
  readonly logger?: (message: string) => void;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const HASH_RE = /^[0-9a-f]{64}$/i;

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function shortHash(deviceTokenHash: string): string {
  return `${deviceTokenHash.slice(0, 8)}…`;
}

function assertPayload(deviceTokenHash: string, title: string, body: string): void {
  if (!HASH_RE.test(deviceTokenHash)) throw new PushError("invalid deviceTokenHash (hex64 attendu)");
  if (!title.trim() || !body.trim()) throw new PushError("title/body requis");
  if (title.length > 120 || body.length > 1000) throw new PushError("title/body trop long");
}

function isHttpUrl(v: string): boolean {
  return /^https?:\/\//i.test(v);
}

export class NoopPushProvider implements PushProvider {
  private readonly logger: (message: string) => void;
  constructor(opts: PushProviderOptions = {}) {
    this.logger = opts.logger ?? (() => {});
  }
  async send(deviceTokenHash: string, payload: { title: string; body: string }): Promise<void> {
    assertPayload(deviceTokenHash, payload.title, payload.body);
    this.logger(`push skip ${shortHash(deviceTokenHash)}`);
  }
}

export class HttpPushProvider implements PushProvider {
  private readonly config: PushConfig;
  private readonly fetchFn: typeof fetch;
  private readonly logger: (message: string) => void;
  private readonly timeoutMs: number;

  constructor(config: PushConfig, opts: PushProviderOptions = {}) {
    if (!config.provider || !config.vapidPublicKey || !config.vapidPrivateKey) {
      throw new PushError("push config incomplète");
    }
    this.config = config;
    this.fetchFn = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.logger = opts.logger ?? (() => {});
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async send(deviceTokenHash: string, payload: { title: string; body: string }): Promise<void> {
    assertPayload(deviceTokenHash, payload.title, payload.body);
    const short = shortHash(deviceTokenHash);
    if (!isHttpUrl(this.config.provider)) {
      this.logger(`push skip ${short} (provider non-URL)`);
      return;
    }
    const signal = AbortSignal.timeout(this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchFn(this.config.provider, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // Clé publique seule sur le fil ; privée jamais envoyée ni loguée.
          authorization: `Vapid k=${this.config.vapidPublicKey}`,
          "push-subject": this.config.subject,
        },
        body: JSON.stringify({
          to: deviceTokenHash,
          notification: { title: payload.title, body: payload.body },
        }),
        signal,
      });
    } catch (err) {
      this.logger(`push send ${short} -> error network`);
      throw new PushError(`push network: ${(err as Error)?.message ?? "fetch failed"}`);
    }
    if (!res.ok) {
      this.logger(`push send ${short} -> error ${res.status}`);
      throw new PushError(`push http ${res.status}`, res.status);
    }
    this.logger(`push send ${short} -> ${res.status}`);
  }
}

export function createPushProvider(
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>,
  opts: PushProviderOptions = {},
): PushProvider {
  const config = loadPushConfig(env);
  if (!config) return new NoopPushProvider(opts);
  return new HttpPushProvider(config, opts);
}
