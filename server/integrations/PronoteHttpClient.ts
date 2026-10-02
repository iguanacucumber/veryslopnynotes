// Unique point de sortie réseau vers Pronote.
// Hiérarchie obligatoire : Domain → PronoteProvider → adapter → PronoteHttpClient → HTTP.
// Choix zone sensible : fetch natif + timeout AbortSignal + 1 retry réseau/5xx + logs méthode+status sans secret (pas d'auth/persistance ici, phase #7).
export type PronoteHttpErrorCode = "timeout" | "network" | "http_4xx" | "http_5xx";

export class PronoteHttpError extends Error {
  readonly code: PronoteHttpErrorCode;
  readonly status?: number;
  constructor(message: string, code: PronoteHttpErrorCode, status?: number) {
    super(message);
    this.name = "PronoteHttpError";
    this.code = code;
    this.status = status;
  }
}

export interface PronoteHttpClientOptions {
  readonly baseUrl: string;
  readonly deviceUuid: string;
  readonly timeoutMs?: number;
  readonly retryDelayMs?: number;
  readonly logger?: (message: string) => void;
  readonly fetchFn?: typeof fetch;
}

export interface PronoteRequestInit {
  readonly method?: string;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

const USER_AGENT = "VerySlopNyNotes/1.0";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_DELAY_MS = 200;

function isAbort(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    ((err as { name?: unknown }).name === "AbortError" ||
      (err as { name?: unknown }).name === "TimeoutError")
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PronoteHttpClient {
  private readonly baseUrl: string;
  private readonly deviceUuid: string;
  private readonly timeoutMs: number;
  private readonly retryDelayMs: number;
  private readonly logger: (message: string) => void;
  private readonly fetchFn: typeof fetch;
  private tail: Promise<void> = Promise.resolve();

  constructor(options: PronoteHttpClientOptions) {
    if (!options.baseUrl) throw new Error("baseUrl requise (injectée, aucun défaut)");
    if (!options.deviceUuid) throw new Error("deviceUuid requis (injecté par caller, pas généré)");
    // ponytail: pas de normalisation réseau ici. Upgrade phase #7 : auth, persistance UUID caller-side.
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.deviceUuid = options.deviceUuid;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.logger = options.logger ?? (() => {});
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  request(path: string, init?: PronoteRequestInit): Promise<unknown> {
    const next = this.tail.then(() => this.doRequest(path, init));
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async doRequest(path: string, init?: PronoteRequestInit): Promise<unknown> {
    const method = init?.method ?? "GET";
    const timeoutMs = init?.timeoutMs ?? this.timeoutMs;
    const url = `${this.baseUrl}/${path.replace(/^\/+/, "")}`;
    const headers: Record<string, string> = {
      ...init?.headers,
      "User-Agent": USER_AGENT,
      "X-Device-Id": this.deviceUuid,
    };
    let body: BodyInit | undefined;
    if (init?.body !== undefined) {
      if (typeof init.body === "string") {
        body = init.body;
      } else {
        body = JSON.stringify(init.body);
        headers["Content-Type"] ??= "application/json";
      }
    }

    for (let attempt = 0; attempt <= 1; attempt++) {
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const signal = init?.signal ? AbortSignal.any([timeoutSignal, init.signal]) : timeoutSignal;
      let res: Response;
      try {
        res = await this.fetchFn(url, { method, headers, body, signal });
      } catch (err) {
        // ponytail: pas de retry sur abort/timeout (déterministe). Upgrade : retry timeout configurable.
        if (isAbort(err) || signal.aborted) {
          this.logger(`${method} ${path} -> error timeout`);
          throw new PronoteHttpError(`timeout ${method} ${path}`, "timeout");
        }
        if (attempt === 0) {
          await delay(this.retryDelayMs);
          continue;
        }
        this.logger(`${method} ${path} -> error network`);
        throw new PronoteHttpError(
          `network ${method} ${path}: ${(err as Error)?.message ?? "fetch failed"}`,
          "network",
        );
      }
      if (res.status >= 500) {
        if (attempt === 0) {
          this.logger(`${method} ${path} -> ${res.status} (retry)`);
          await res.arrayBuffer().catch(() => undefined);
          await delay(this.retryDelayMs);
          continue;
        }
        this.logger(`${method} ${path} -> error http_5xx ${res.status}`);
        throw new PronoteHttpError(`http ${res.status} ${method} ${path}`, "http_5xx", res.status);
      }
      if (res.status >= 400) {
        this.logger(`${method} ${path} -> error http_4xx ${res.status}`);
        throw new PronoteHttpError(`http ${res.status} ${method} ${path}`, "http_4xx", res.status);
      }
      // Log méthode+status uniquement : jamais URL complète, headers, body, token, cookie.
      this.logger(`${method} ${path} -> ${res.status}`);
      const text = await res.text();
      if (!text) return null;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return text;
      }
    }
    throw new PronoteHttpError(`network ${method} ${path}`, "network");
  }
}
