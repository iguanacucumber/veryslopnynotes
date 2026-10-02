// API v0 — appairage QR+PIN (issue #12, FEATURES.md). Le QR affiché par
// le serveur = payload {sessionId, code} (l'app rend le QR côté client,
// phase 4 : aucune lib d'image ici). Sessions en mémoire runtime uniquement,
// codes comparés en temps constant, expiration + verrouillage + révocation.
// Aucun secret persisté/committé/logué : empreinte sha256 seule conservée.

import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { Device } from "../../shared/contracts/models";
import type { PairingStartResponse } from "../../shared/contracts/api";

export type PairingFailure = "unknown_session" | "expired" | "locked" | "wrong_code";

export interface PairingOptions {
  readonly ttlMs?: number;
  readonly maxAttempts?: number;
  readonly now?: () => number;
  readonly uuid?: () => string;
  readonly pin?: () => string;
}

interface Session {
  readonly code: string;
  readonly deviceName: string;
  readonly expiresAt: number;
  attempts: number;
}

const TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export class PairingService {
  private readonly sessions = new Map<string, Session>();
  private readonly devices = new Map<string, Device>();
  private readonly ttlMs: number;
  private readonly maxAttempts: number;
  private readonly now: () => number;
  private readonly uuid: () => string;
  private readonly pin: () => string;

  constructor(opts: PairingOptions = {}) {
    this.ttlMs = opts.ttlMs ?? TTL_MS;
    this.maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
    this.now = opts.now ?? Date.now;
    this.uuid = opts.uuid ?? randomUUID;
    this.pin = opts.pin ?? (() => String(randomInt(0, 1_000_000)).padStart(6, "0"));
  }

  start(deviceName: string): PairingStartResponse {
    const sessionId = this.uuid();
    const code = this.pin();
    this.sessions.set(sessionId, {
      code,
      deviceName,
      expiresAt: this.now() + this.ttlMs,
      attempts: 0,
    });
    return { sessionId, code };
  }

  confirm(
    sessionId: string,
    code: string,
  ): { ok: true; device: Device } | { ok: false; failure: PairingFailure } {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, failure: "unknown_session" };
    if (this.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return { ok: false, failure: "expired" };
    }
    if (session.attempts >= this.maxAttempts) return { ok: false, failure: "locked" };
    const a = Buffer.from(code);
    const b = Buffer.from(session.code);
    const match = a.length === b.length && timingSafeEqual(a, b);
    if (!match) {
      session.attempts += 1;
      return { ok: false, failure: session.attempts >= this.maxAttempts ? "locked" : "wrong_code" };
    }
    this.sessions.delete(sessionId);
    const device: Device = {
      id: this.uuid(),
      tokenHash: createHash("sha256").update(`${sessionId}:${this.uuid()}`).digest("hex"),
    };
    this.devices.set(device.id, device);
    return { ok: true, device };
  }

  revoke(deviceId: string): boolean {
    return this.devices.delete(deviceId);
  }

  pending(): number {
    return this.sessions.size;
  }
}
