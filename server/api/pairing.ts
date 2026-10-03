// API v0 — appairage QR+PIN (issue #12, FEATURES.md). Le QR affiché par
// le serveur = payload {sessionId, code} (l'app rend le QR côté client,
// phase 4 : aucune lib d'image ici). Sessions en mémoire runtime UNIQUEMENT,
// nombre borné, expirées/verrouillées purgées, PIN JAMAIS stocké en clair
// (empreinte sha256 seule, comparaison en temps constant). Les nuances
// d'échec vivent dans `PairingFailure` (usage interne/tests) et JAMAIS sur le
// fil : le routeur répond 401 « unauthorized » unique, sinon la réponse est un
// oracle d'existence de session et de tentatives restantes.
// Token d'appareil = secret aléatoire du serveur, seule forme d'API
// `sha256(token)` ; le secret ne sort que par la réponse d'appairage (une
// fois, à la confirmation) et par `tokenOf` (push). Aucun secret persisté/
// committé/logué, aucun credential ni URL Pronote dans une réponse.

import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { Device } from "../../shared/contracts/models";
import type { PairingStartResponse } from "../../shared/contracts/api";

export type PairingFailure = "unknown_session" | "expired" | "locked" | "wrong_code";

export interface PairingOptions {
  readonly ttlMs?: number;
  readonly maxAttempts?: number;
  readonly deviceTtlMs?: number;
  readonly now?: () => number;
  readonly uuid?: () => string;
  readonly pin?: () => string;
  /** Secret du token d'appareil : `sha256(token)` est la seule forme d'API. */
  readonly token?: () => string;
}

interface Session {
  /** sha256 du PIN. Le PIN en clair n'est jamais conservé (dump mémoire). */
  readonly codeHash: string;
  readonly deviceName: string;
  readonly expiresAt: number;
  attempts: number;
}

interface PairedDevice {
  readonly id: string;
  readonly tokenHash: string;
  readonly expiresAt: number;
}

const TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
/** Sessions d'appairage affichables à l'écran : /v1/pairing/start n'est pas
 * authentifiée, 5000 POST ne doivent pas faire 5000 entrées en mémoire. */
const MAX_SESSIONS = 64;
/** Durée de vie d'un credential appairé : au-delà, révocation implicite. */
const DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Comparaison en temps constant de deux empreintes hex64 de même longueur. */
function sameDigest(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

export class PairingService {
  private readonly sessions = new Map<string, Session>();
  /** deviceId -> credential appairé (hash du token + fin de vie). */
  private readonly credentials = new Map<string, PairedDevice>();
  /** deviceId -> secret du token d'app. Jamais exposé par l'API. */
  private readonly tokens = new Map<string, string>();
  private readonly ttlMs: number;
  private readonly maxAttempts: number;
  private readonly deviceTtlMs: number;
  private readonly now: () => number;
  private readonly uuid: () => string;
  private readonly pin: () => string;
  private readonly token: () => string;

  constructor(opts: PairingOptions = {}) {
    this.ttlMs = opts.ttlMs ?? TTL_MS;
    this.maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
    this.deviceTtlMs = opts.deviceTtlMs ?? DEVICE_TTL_MS;
    this.now = opts.now ?? Date.now;
    this.uuid = opts.uuid ?? randomUUID;
    this.pin = opts.pin ?? (() => String(randomInt(0, 1_000_000)).padStart(6, "0"));
    this.token = opts.token ?? (() => randomBytes(32).toString("base64url"));
  }

  start(deviceName: string): PairingStartResponse {
    this.purgeSessions();
    const sessionId = this.uuid();
    const code = this.pin();
    this.sessions.set(sessionId, {
      codeHash: this.hash(code),
      deviceName,
      expiresAt: this.now() + this.ttlMs,
      attempts: 0,
    });
    // Plafond mémoire : la plus ancienne session cède sa place (elle est de
    // toute façon dépassée par N sessions plus récentes à l'écran).
    for (const oldest of this.sessions.keys()) {
      if (this.sessions.size <= MAX_SESSIONS) break;
      this.sessions.delete(oldest);
    }
    return { sessionId, code };
  }

  confirm(
    sessionId: string,
    code: string,
  ): { ok: true; device: Device; token: string } | { ok: false; failure: PairingFailure } {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, failure: "unknown_session" };
    // Expiration inclusive : à `expiresAt` exactement, la session est morte.
    if (this.now() >= session.expiresAt) {
      this.sessions.delete(sessionId);
      return { ok: false, failure: "expired" };
    }
    if (!sameDigest(this.hash(code), session.codeHash)) {
      session.attempts += 1;
      // Verrou = purge immédiate : la session ne peut plus jamais aboutir, la
      // garder en mémoire ne sert qu'à fuiter le compte de tentatives.
      if (session.attempts >= this.maxAttempts) {
        this.sessions.delete(sessionId);
        return { ok: false, failure: "locked" };
      }
      return { ok: false, failure: "wrong_code" };
    }
    this.sessions.delete(sessionId);
    // `tokenHash` = sha256 du VRAI token d'appareil (et non d'un couple
    // sessionId:uuid) : c'est cette empreinte que le pushProvider poste en
    // `to:`. Le secret lui-même reste côté serveur (tokenOf).
    const token = this.token();
    const device: Device = { id: this.uuid(), tokenHash: this.hash(token) };
    this.credentials.set(device.id, { ...device, expiresAt: this.now() + this.deviceTtlMs });
    this.tokens.set(device.id, token);
    // Le secret sort ICI, une seule fois, à l'appairage : c'est la seule
    // occasion pour l'app d'apprendre le bearer des routes protégé. Jamais
    // loggé, jamais persisté en clair (seul `sha256(token)` l'est), jamais
    // re-servi : au-delà, un secret perdu = ré-appairage.
    return { ok: true, device, token };
  }

  revoke(deviceId: string): boolean {
    this.purgeDevices();
    this.tokens.delete(deviceId);
    return this.credentials.delete(deviceId);
  }

  /**
   * Vérificateur pour le routeur (wave auth) : le token présenté par l'app
   * n'est stocké que par son sha256, la comparaison est en temps constant.
   * Renvoie l'id du device VIVANT, `null` si inconnu, expiré ou révoqué.
   * ponytail: le routeur n'a pas besoin du secret, seulement de l'identité.
   */
  verifyDeviceToken(token: string): string | null {
    const presented = this.hash(token);
    let found: string | null = null;
    for (const d of this.devices()) {
      if (sameDigest(presented, d.tokenHash)) found = d.id;
    }
    return found;
  }

  /**
   * Secret du token d'app (`to:` du provider push), appairé par deviceId.
   * Il ne quitte JAMAIS le serveur : sur l'API, seul `Device.tokenHash`
   * circule. ponytail: secret en mémoire, adossé au lifetime du credential ;
   * upgrade: provider push qui garde lui-même le secret (jamais ici).
   */
  tokenOf(deviceId: string): string | null {
    this.purgeDevices();
    return this.credentials.has(deviceId) ? (this.tokens.get(deviceId) ?? null) : null;
  }

  /** Devices appairés VIVANTS (un credential expiré est déjà purgé). */
  devices(): Device[] {
    this.purgeDevices();
    return [...this.credentials.values()].map((d) => ({ id: d.id, tokenHash: d.tokenHash }));
  }

  pending(): number {
    this.purgeSessions();
    return this.sessions.size;
  }

  /** Sessions mortes : expirées (>= expiresAt) ou verrouillées. */
  private purgeSessions(): void {
    const now = this.now();
    for (const [id, s] of this.sessions) {
      if (now >= s.expiresAt || s.attempts >= this.maxAttempts) this.sessions.delete(id);
    }
  }

  /** Credentials appairés expirés : aucun secret ni hash conservé après. */
  private purgeDevices(): void {
    const now = this.now();
    for (const [id, d] of this.credentials) {
      if (now >= d.expiresAt) {
        this.credentials.delete(id);
        this.tokens.delete(id);
      }
    }
  }

  private hash(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
  }
}
