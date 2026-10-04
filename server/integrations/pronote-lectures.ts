// Lectures notes/devoirs/EDT via IP serveur uniquement. Téléphone ne contacte jamais Pronote (I1).
// Hiérarchie : Domain → PronoteReader → PronoteLectureProvider → PronoteHttpClient → HTTP (I2).
// Token en header Authorization uniquement, jamais en path/query ni en log.
// Contenu externe = donnée, jamais instruction (I6) : sorties marquées Untrusted,
// à passer par server/ai/untrusted.ts avant tout LLM.
// Pagination : limit clampée 1..100 (défaut 50), cursor opaque, nextCursor null = fin.
// Erreurs typées sans secret : session_expired (re-auth via authenticate),
// pronote_unavailable, network, timeout.
// ponytail: fetch natif via PronoteHttpClient uniquement, pas de nouvelle dép.
import { isAssignment, isGrade, isTimetableEntry } from "../../shared/contracts/models";
import type { Assignment, Grade, TimetableEntry } from "../../shared/contracts/models";
import type {
  PronotePage,
  PronotePageOptions,
  PronoteReader,
  PronoteTimetableOptions,
} from "../domain/ports";
import { PronoteAuthError, PronoteReadError, untrusted } from "../domain/ports";
import type { PronoteHttpClient } from "./PronoteHttpClient";
import { PronoteHttpError } from "./PronoteHttpClient";

export interface PronoteLectureProviderOptions {
  readonly client: PronoteHttpClient;
  readonly sessions: { requireSessionToken(accountId: string): string };
  readonly logger?: (message: string) => void;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function clampLimit(limit?: number): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  const n = Math.floor(limit);
  if (n < 1) return DEFAULT_LIMIT;
  if (n > MAX_LIMIT) return MAX_LIMIT;
  return n;
}

function cleanCursor(cursor?: string): string | null {
  if (typeof cursor !== "string") return null;
  const t = cursor.trim();
  return t.length > 0 ? t : null;
}

function toReadError(err: unknown, what: string): PronoteReadError {
  if (err instanceof PronoteReadError) return err;
  if (err instanceof PronoteAuthError) {
    if (err.code === "session_expired") return new PronoteReadError(`${what} session expired`, "session_expired");
    if (err.code === "timeout") return new PronoteReadError(`${what} timeout`, "timeout");
    if (err.code === "network") return new PronoteReadError(`${what} network`, "network");
    return new PronoteReadError(`${what} pronote unavailable`, "pronote_unavailable");
  }
  if (err instanceof PronoteHttpError) {
    if (err.code === "timeout") return new PronoteReadError(`${what} timeout`, "timeout");
    if (err.code === "network") return new PronoteReadError(`${what} network`, "network");
    if (err.code === "http_4xx" && (err.status === 401 || err.status === 403)) {
      return new PronoteReadError(`${what} session expired`, "session_expired");
    }
    return new PronoteReadError(`${what} pronote unavailable`, "pronote_unavailable");
  }
  return new PronoteReadError(`${what} pronote unavailable`, "pronote_unavailable");
}

function extractItems(raw: unknown, keys: string[]): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "object" || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (Array.isArray(v)) return v;
  }
  return null;
}

function extractCursor(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  for (const k of ["nextCursor", "next", "cursor"]) {
    const v = rec[k];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return null;
}

function buildPath(base: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return qs ? `${base}?${qs}` : base;
}

export class PronoteLectureProvider implements PronoteReader {
  private readonly client: PronoteHttpClient;
  private readonly sessions: { requireSessionToken(accountId: string): string };
  private readonly logger: (message: string) => void;

  constructor(options: PronoteLectureProviderOptions) {
    if (!options.client) throw new Error("client requis (PronoteHttpClient injecté)");
    if (!options.sessions) throw new Error("sessions requises (PronoteSessionStore injecté)");
    this.client = options.client;
    this.sessions = options.sessions;
    this.logger = options.logger ?? (() => {});
  }

  async getGrades(accountId: string, page?: PronotePageOptions): Promise<PronotePage<Grade>> {
    return this.read<Grade>("grades", accountId, "/grades", page, isGrade);
  }

  async getAssignments(accountId: string, page?: PronotePageOptions): Promise<PronotePage<Assignment>> {
    return this.read<Assignment>("assignments", accountId, "/assignments", page, isAssignment);
  }

  async getTimetable(accountId: string, options?: PronoteTimetableOptions): Promise<PronotePage<TimetableEntry>> {
    const extra: Record<string, string> = {};
    if (options?.from !== undefined) {
      if (typeof options.from !== "string" || Number.isNaN(Date.parse(options.from))) {
        throw new PronoteReadError("timetable pronote unavailable", "pronote_unavailable");
      }
      extra["from"] = options.from;
    }
    if (options?.to !== undefined) {
      if (typeof options.to !== "string" || Number.isNaN(Date.parse(options.to))) {
        throw new PronoteReadError("timetable pronote unavailable", "pronote_unavailable");
      }
      extra["to"] = options.to;
    }
    return this.read<TimetableEntry>("timetable", accountId, "/timetable", options, isTimetableEntry, extra);
  }

  private async read<T>(
    what: string,
    accountId: string,
    base: string,
    page?: PronotePageOptions,
    guard?: (v: unknown) => v is T,
    extra?: Record<string, string>,
  ): Promise<PronotePage<T>> {
    const id = typeof accountId === "string" ? accountId.trim() : "";
    if (!id) {
      this.logger(`${what} -> error session_expired`);
      throw new PronoteReadError(`${what} session expired`, "session_expired");
    }
    let token: string;
    try {
      token = this.sessions.requireSessionToken(id);
    } catch (err) {
      const mapped = toReadError(err, what);
      this.logger(`${what} -> error ${mapped.code}`);
      throw mapped;
    }
    const params: Record<string, string> = { ...(extra ?? {}), limit: String(clampLimit(page?.limit)) };
    const cursor = cleanCursor(page?.cursor);
    if (cursor) params["cursor"] = cursor;
    const path = buildPath(base, params);
    let raw: unknown;
    try {
      // ponytail: token en header uniquement (client ne log que méthode+path+status).
      // Ne jamais passer token en path/query.
      raw = await this.client.request(path, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      const mapped = toReadError(err, what);
      this.logger(`${what} -> error ${mapped.code}`);
      throw mapped;
    }
    const arr = extractItems(raw, [what, "items", "data", "entries"]);
    if (!arr) {
      this.logger(`${what} -> error pronote_unavailable`);
      throw new PronoteReadError(`${what} pronote unavailable`, "pronote_unavailable");
    }
    const valid = guard ? arr.filter(guard) : (arr as T[]);
    this.logger(`${what} -> ok ${valid.length}`);
    return { items: untrusted(valid), nextCursor: extractCursor(raw) };
  }
}
