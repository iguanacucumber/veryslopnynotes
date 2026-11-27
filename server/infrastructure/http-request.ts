// Lecture bornée du corps, échéance absolue de la requête et réponses d'erreur
// partagées par les routes de scrape. Aucun accès réseau ici.
import { MAX_SCRAPE_BODY_BYTES } from "../../shared/contracts/api";
import { ScrapeManualsError } from "./manuals-scrape";

export function error(
  code: string,
  status: number,
  message: string,
  extraHeaders?: Record<string, string>,
): Response {
  return Response.json({ error: { code, message } }, { status, headers: extraHeaders });
}

/** `Retry-After` en secondes entières (RFC 9110), jamais 0. */
export function rateLimited(retryAfterMs: number): Response {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return error("rate_limited", 429, "quota epuise, reessayer plus tard", {
    "retry-after": String(seconds),
    "cache-control": "no-store",
  });
}

function timeoutError(ms: number): Error {
  // Motif `timeout` : 504 (le code exact), pas 502 qui ferait croire à une
  // panne du portail.
  return new ScrapeManualsError(`scrape timeout ${ms}ms`, "timeout");
}

/** Coupe le flux dès le refus : le client n'a pas à finir d'envoyer un corps inutile. */
export function discardBody(req: Request): void {
  if (!req.body || req.body.locked) return;
  void req.body.cancel().catch(() => {});
}

/** Course d'une promesse contre l'échéance : un corps lent n'immobilise pas le slot. */
function readWithAbort<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

export type ReadJsonBody =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly response: Response };

/**
 * Corps JSON lu EN STREAMING et borné en OCTETS : un `req.text()` bufferisait
 * tout le corps avant de mesurer, donc une route ouverte pouvait être remplie
 * avec une taille arbitraire. Le `content-type` est exigé AVANT toute lecture ;
 * au-delà du plafond, la lecture s'arrête et le flux est annulé.
 */
export async function readJsonBody(req: Request, signal?: AbortSignal): Promise<ReadJsonBody> {
  const mediaType = (req.headers.get("content-type") ?? "").split(";", 1)[0]?.trim().toLowerCase();
  if (signal?.aborted) throw signal.reason;
  if (mediaType !== "application/json") {
    discardBody(req);
    return {
      ok: false,
      response: error("bad_request", 415, "content-type application/json requis"),
    };
  }
  const announced = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(announced) && announced > MAX_SCRAPE_BODY_BYTES) {
    discardBody(req);
    return { ok: false, response: error("too_large", 413, "corps trop volumineux") };
  }
  if (!req.body) return { ok: true, text: "" };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await readWithAbort(reader.read(), signal);
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      size += value.byteLength;
      if (size > MAX_SCRAPE_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return { ok: false, response: error("too_large", 413, "corps trop volumineux") };
      }
      chunks.push(value);
    }
  } catch (err) {
    await reader.cancel().catch(() => {});
    if (signal?.aborted) throw signal.reason;
    return { ok: false, response: error("bad_request", 400, "invalid JSON body") };
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(bytes) };
}

export interface RequestDeadline {
  readonly controller: AbortController;
  /** Temps restant avant l'échéance absolue (jamais 0). */
  readonly remainingMs: () => number;
  readonly dispose: () => void;
}

/**
 * UNE échéance pour tout le handler : lecture du corps, résolution DNS, scrape
 * et lecture du HTML. `idleTimeout` de Bun ne borne que l'inactivité du
 * transport : un corps qui goutte indéfiniment ne déclenche jamais ce délai.
 */
export function startRequestDeadline(req: Request, timeoutMs: number): RequestDeadline {
  const controller = new AbortController();
  const deadlineAt = Date.now() + timeoutMs;
  const timer = setTimeout(() => controller.abort(timeoutError(timeoutMs)), timeoutMs);
  const onClientAbort = () => controller.abort(new ScrapeManualsError("client aborte"));
  if (req.signal) {
    if (req.signal.aborted) onClientAbort();
    else req.signal.addEventListener("abort", onClientAbort, { once: true });
  }
  return {
    controller,
    remainingMs: () => Math.max(1, deadlineAt - Date.now()),
    dispose: () => {
      clearTimeout(timer);
      req.signal?.removeEventListener("abort", onClientAbort);
    },
  };
}

/** Annulation avant le scrape : client parti = 502, échéance = 504. */
export function abortedResponse(req: Request, controller: AbortController): Response {
  if (req.signal?.aborted) return error("school_unreachable", 502, "scrape impossible");
  const reason = controller.signal.reason;
  if (reason instanceof ScrapeManualsError && reason.reason !== "timeout") {
    return error("school_unreachable", 502, "scrape impossible");
  }
  return error("timeout", 504, "delai de scrape depasse");
}

/** Rejette avec le motif de l'abandon (délai typé, client, navigateur). */
export function abortRejection(controller: AbortController, timeoutMs: number): Promise<never> {
  return new Promise<never>((_, reject) => {
    const onAbort = () => {
      const reason = controller.signal.reason;
      reject(reason instanceof Error ? reason : timeoutError(timeoutMs));
    };
    if (controller.signal.aborted) {
      onAbort();
      return;
    }
    controller.signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Navigateur Playwright ABSENT = capability manquante (501 franc), pas un
 * faux 500 « unexpected failure ». Le message réel varie selon la version et
 * la cause : on matche une LISTE de motifs, jamais une chaîne fragile.
 * ponytail: regex sur le message, pas de dépendance ni de parsing de sortie.
 * Upgrade: une erreur stable de Playwright si elle existe un jour.
 */
const MISSING_BROWSER_PATTERNS: readonly RegExp[] = [
  /playwright non install/i, // module absent (message interne du scraper)
  /executable doesn't exist/i, // binaire du navigateur non téléchargé
  /download new browsers/i, // Playwright invite à télécharger le navigateur
  /playwright install/i, // commande d'installation citée dans le message
  /host system is missing dependencies/i, // libs système absentes
  /navigateur (?:absent|manquant|introuvable)/i,
];

export function isMissingBrowserError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return MISSING_BROWSER_PATTERNS.some((re) => re.test(message));
}

/**
 * Chromium refuse de démarrer plutôt que de tourner sans sandbox ; Playwright
 * remonte le diagnostic complet. Ces motifs sont ceux du binaire, pas une
 * promesse de stabilité : un motif absent laisse un 500, jamais un faux succès.
 */
const SANDBOX_UNAVAILABLE_PATTERNS: readonly RegExp[] = [
  /chromium sandboxing failed/i,
  /no usable sandbox/i,
];

export function isSandboxUnavailableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return SANDBOX_UNAVAILABLE_PATTERNS.some((re) => re.test(message));
}
