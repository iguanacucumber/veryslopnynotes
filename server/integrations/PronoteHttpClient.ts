// Unique point de sortie réseau vers Pronote.
// Hiérarchie obligatoire : Domain → PronoteProvider → adapter → PronoteHttpClient → HTTP.
// Zone sensible (AGENTS.md) — règles tenues ici :
//   - HTTPS obligatoire (http loopback toléré) : password/token ne voyagent jamais en clair ;
//   - redirects suivis À LA MAIN (`redirect: "manual"`) : un suivi automatique renverrait
//     le cookie de session et le X-Device-Id à l'hôte du 302 (fuite vers un attaquant) ;
//   - jar tough-cookie : le Set-Cookie de l'auth est rejoué sur les requêtes suivantes ;
//   - un 3xx n'est JAMAIS un succès (page de login HTML renvoyée comme si c'était la donnée) ;
//   - corps plafonné et TOUJOURS consommé (socket undici libéré sur 4xx/5xx/3xx) ;
//   - retry réseau/5xx sur méthodes idempotentes seulement (une écriture ne part pas 2 fois) ;
//   - URL construite par le parseur : un `../` ne sort pas du préfixe baseUrl ;
//   - logs/erreurs : méthode + path SANS query + status, jamais d'URL complète ni de token.
import { CookieJar } from "tough-cookie";

export type PronoteHttpErrorCode =
  | "timeout"
  | "network"
  | "http_4xx"
  | "http_5xx"
  /** 3xx : non suivi (trop de hops, Location absent ou 3xx non standard) → jamais un succès. */
  | "redirect"
  /** Corps au-delà du plafond : stream annulé, jamais bufferisé en entier. */
  | "response_too_large"
  /** Chemin refuse : URL non parsable ou hors préfixe baseUrl. */
  | "invalid_request";

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
/** Plafond de corps bufferisé (4 Mio) : au-delà, lecture stoppée (pas d'OOM). */
// ponytail: plafond unique, pas par route. Upgrade: seuil par endpoint (devoirs/PJ plus gros).
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
/** Redirects manuels : au-delà de ce nombre de hops, échec (pas de boucle). */
const MAX_REDIRECTS = 5;
/** 3xx effectivement suivis ; tout autre 3xx est une erreur. */
const FOLLOWED_REDIRECTS = new Set([301, 302, 303, 307, 308]);
/** Retry seulement sur ces méthodes : un POST (login/toggle/complete) n'est jamais rejoué. */
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** Credentials qui ne franchissent JAMAIS un hop vers une autre origine. */
const CREDENTIAL_HEADERS = ["cookie", "authorization", "x-device-id"];
/** http:// toléré en loopback uniquement (serveur local/tests), jamais pour un établissement. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);

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

/** Nom d'en-tête présent (casse-insensible) dans un objet d'en-têtes brut. */
function findHeader(headers: Record<string, string>, name: string): string | null {
  const wanted = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === wanted) return key;
  }
  return null;
}

function dropHeader(headers: Record<string, string>, name: string): void {
  const key = findHeader(headers, name);
  if (key !== null) delete headers[key];
}

/** Path sans query ni fragment : un token passé en query n'atteint jamais un log ni une erreur. */
function safePath(path: string): string {
  const cut = path.search(/[?#]/);
  return cut >= 0 ? path.slice(0, cut) : path;
}

/** HTTPS obligatoire (http loopback toléré), préfixe canonique terminé par "/". */
function parseBaseUrl(raw: string): URL {
  let base: URL;
  try {
    base = new URL(raw);
  } catch {
    throw new Error("baseUrl invalide");
  }
  if (!isSecureUrl(base)) {
    throw new Error("baseUrl https requise (http loopback toléré) : credentials jamais en clair");
  }
  // origin + pathname seulement : ni userinfo ni query dans l'URL de base.
  return new URL(`${base.origin}${base.pathname.replace(/\/+$/, "")}/`);
}

/** https partout, sauf loopback en http (serveur local/tests). Jamais de clair sur le réseau. */
function isSecureUrl(url: URL): boolean {
  return url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname));
}

export class PronoteHttpClient {
  private readonly base: URL;
  private readonly deviceUuid: string;
  private readonly timeoutMs: number;
  private readonly retryDelayMs: number;
  private readonly logger: (message: string) => void;
  private readonly fetchFn: typeof fetch;
  /** Jar de session (tough-cookie) : le Set-Cookie de /auth est rejoué ensuite. */
  private readonly jar = new CookieJar();
  private tail: Promise<void> = Promise.resolve();

  constructor(options: PronoteHttpClientOptions) {
    if (!options.baseUrl) throw new Error("baseUrl requise (injectée, aucun défaut)");
    if (!options.deviceUuid) throw new Error("deviceUuid requis (injecté par caller, pas généré)");
    this.base = parseBaseUrl(options.baseUrl);
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
    const method = (init?.method ?? "GET").toUpperCase();
    const timeoutMs = init?.timeoutMs ?? this.timeoutMs;
    const target = this.buildUrl(path);
    const logged = safePath(path);
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
    // 1 retry réseau/5xx, méthodes idempotentes seulement : un POST n'est jamais rejoué.
    const attempts = IDEMPOTENT_METHODS.has(method) ? 2 : 1;

    for (let attempt = 0; ; attempt++) {
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const signal = init?.signal ? AbortSignal.any([timeoutSignal, init.signal]) : timeoutSignal;
      let res: Response;
      try {
        res = await this.fetchFollowingRedirects({ url: target, method, headers, body, signal, logged });
      } catch (err) {
        // ponytail: pas de retry sur abort/timeout (déterministe). Upgrade : retry timeout configurable.
        if (attempt + 1 >= attempts || !(err instanceof PronoteHttpError) || err.code !== "network") throw err;
        await delay(this.retryDelayMs);
        continue;
      }
      if (res.status >= 500) {
        await this.drain(res);
        if (attempt + 1 < attempts) {
          this.logger(`${method} ${logged} -> ${res.status} (retry)`);
          await delay(this.retryDelayMs);
          continue;
        }
        this.logger(`${method} ${logged} -> error http_5xx ${res.status}`);
        throw new PronoteHttpError(`http ${res.status} ${method} ${logged}`, "http_5xx", res.status);
      }
      if (res.status >= 400) {
        await this.drain(res);
        this.logger(`${method} ${logged} -> error http_4xx ${res.status}`);
        throw new PronoteHttpError(`http ${res.status} ${method} ${logged}`, "http_4xx", res.status);
      }
      // Log méthode+status uniquement : jamais URL complète, headers, body, token, cookie.
      this.logger(`${method} ${logged} -> ${res.status}`);
      let text: string;
      try {
        text = await this.readBody(res);
      } catch (err) {
        // Corps tronqué (reset TCP/proxy) ou hors plafond : l'erreur brute (DOMException)
        // ne déborde jamais, elle est mappée en PronoteHttpError.
        if (err instanceof PronoteHttpError) {
          this.logger(`${method} ${logged} -> error ${err.code}`);
          throw err;
        }
        const code: PronoteHttpErrorCode = signal.aborted ? "timeout" : "network";
        this.logger(`${method} ${logged} -> error ${code}`);
        throw new PronoteHttpError(`${code} ${method} ${logged}`, code);
      }
      if (!text) return null;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return text;
      }
    }
  }

  /**
   * Fetch + redirects suivis à la main. Un 3xx n'est jamais rendu comme un succès :
   * soit on suit (Location + statut connu, dans la limite de MAX_REDIRECTS), soit on
   * échoue en `redirect`.
   */
  private async fetchFollowingRedirects(args: {
    readonly url: URL;
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly body: BodyInit | undefined;
    readonly signal: AbortSignal;
    readonly logged: string;
  }): Promise<Response> {
    let url = args.url;
    let method = args.method;
    let headers: Record<string, string> = { ...args.headers };
    let body = args.body;
    for (let hop = 0; ; hop++) {
      if (url.origin === this.base.origin) {
        // Cookie de session rejoué vers l'origine configurée (jar, pas de cookie main tendue).
        const cookie = await this.cookieHeader(url);
        if (cookie && findHeader(headers, "cookie") === null) headers["Cookie"] = cookie;
      } else {
        // Hop vers une autre origine : plus aucune credential, et une écriture n'est pas
        // rejouée (le body porte le mot de passe / le token).
        for (const name of CREDENTIAL_HEADERS) dropHeader(headers, name);
        if (method !== "GET" && method !== "HEAD") {
          method = "GET";
          body = undefined;
          dropHeader(headers, "content-type");
        }
      }
      let res: Response;
      try {
        // `redirect: "manual"` : fetch ne rejoue jamais les en-têtes de credential vers
        // l'hôte du 302 (c'est exactement la fuite qu'on veut empêcher).
        res = await this.fetchFn(url.href, { method, headers, body, signal: args.signal, redirect: "manual" });
      } catch (err) {
        // ponytail: pas de retry sur abort/timeout (déterministe). Upgrade : retry timeout configurable.
        if (isAbort(err) || args.signal.aborted) {
          this.logger(`${args.method} ${args.logged} -> error timeout`);
          throw new PronoteHttpError(`timeout ${args.method} ${args.logged}`, "timeout");
        }
        this.logger(`${args.method} ${args.logged} -> error network`);
        throw new PronoteHttpError(`network ${args.method} ${args.logged}`, "network");
      }
      await this.storeCookies(url, res);
      if (res.status < 300 || res.status >= 400) return res;
      const location = res.headers.get("location");
      await this.drain(res);
      let next: URL | null = null;
      if (location !== null && FOLLOWED_REDIRECTS.has(res.status) && hop < MAX_REDIRECTS) {
        try {
          next = new URL(location, url);
        } catch {
          next = null;
        }
      }
      // Downgrade https → http refusé : un 302 ne fait jamais passer la requête (ni le
      // cookie réinjecté plus bas) en clair, même vers un hôte déjà connu.
      if (next !== null && !isSecureUrl(next)) next = null;
      if (next === null) {
        this.logger(`${args.method} ${args.logged} -> error redirect ${res.status}`);
        throw new PronoteHttpError(`http ${res.status} ${args.method} ${args.logged}`, "redirect", res.status);
      }
      url = next;
      // 303 (et 301/302 sur POST) = GET sans body ; 307/308 conservent méthode + body.
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && body !== undefined)) {
        method = "GET";
        body = undefined;
        dropHeader(headers, "content-type");
      }
    }
  }

  private async cookieHeader(url: URL): Promise<string> {
    try {
      return await this.jar.getCookieString(url.href);
    } catch {
      return "";
    }
  }

  private async storeCookies(url: URL, res: Response): Promise<void> {
    // Un Set-Cookie venu d'une autre origine n'est jamais mémorisé.
    if (url.origin !== this.base.origin) return;
    for (const raw of res.headers.getSetCookie()) {
      try {
        // `loose` : un `Set-Cookie` sans `=` (paire non conforme, courante sur les
        // portails ENT) est sinon rejeté et la session est perdue à chaque appel.
        await this.jar.setCookie(raw, url.href, { loose: true });
      } catch {
        // Cookie illisible : ignoré plutôt que fatal (la requête est tentée quand même).
      }
    }
  }

  /** Consommer le corps libère le socket undici : sans ça le pool se sature après quelques 404. */
  private async drain(res: Response): Promise<void> {
    try {
      await this.readBody(res);
    } catch {
      // Corps illisible ou hors plafond : on jette, le but est de libérer le socket.
    }
  }

  /** Lecture du corps sous plafond : au-delà, le stream est annulé (jamais de bufferisation totale). */
  private async readBody(res: Response): Promise<string> {
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
      await this.cancelBody(res);
      throw new PronoteHttpError(`corps trop volumineux (${declared} octets)`, "response_too_large");
    }
    const stream = res.body;
    if (!stream) return "";
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          await reader.cancel().catch(() => undefined);
          throw new PronoteHttpError(`corps trop volumineux (> ${MAX_RESPONSE_BYTES} octets)`, "response_too_large");
        }
        text += decoder.decode(value, { stream: true });
      }
    } finally {
      reader.releaseLock();
    }
    return text + decoder.decode();
  }

  private async cancelBody(res: Response): Promise<void> {
    try {
      await res.body?.cancel();
    } catch {
      // Stream déjà consommé/fermé : rien à libérer.
    }
  }

  /**
   * URL construite par le parseur : les segments `.`/`..` sont retirés puis encodés,
   * donc un `../` (ou un `%2e%2e`) ne peut pas remonter hors du préfixe baseUrl. La
   * query du caller est conservée telle quelle (elle part en réseau, jamais en log).
   */
  private buildUrl(path: string): URL {
    const raw = typeof path === "string" ? path : "";
    const cut = raw.search(/[?#]/);
    const rawPath = cut >= 0 ? raw.slice(0, cut) : raw;
    const tail = cut >= 0 ? raw.slice(cut) : "";
    const segments = rawPath.split("/").filter((s) => s !== "" && s !== "." && s !== "..");
    const rel = `${segments.map((s) => encodeURIComponent(s)).join("/")}${tail}`;
    let url: URL;
    try {
      url = new URL(rel, this.base);
    } catch {
      throw new PronoteHttpError("chemin de requête invalide", "invalid_request");
    }
    if (url.origin !== this.base.origin || !url.pathname.startsWith(this.base.pathname)) {
      throw new PronoteHttpError("chemin hors du préfixe baseUrl", "invalid_request");
    }
    return url;
  }
}