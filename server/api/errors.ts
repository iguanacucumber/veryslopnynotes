// API v0 — erreurs typées (issue #10). Toute réponse d'erreur suit ce
// format, jamais de stack/secret en message (règle d'or dépôt public).

export const API_ERROR_CODES = [
  "bad_request",
  "not_found",
  "method_not_allowed",
  "not_implemented",
  // #75 : session Pronote expirée sur une action confirmée par l'app (re-appairage),
  // et devoir introuvable sur la fenêtre lue. Codes add-only (0.2.0).
  "unauthorized",
  "conflict",
  "internal",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiErrorBody {
  readonly error: { readonly code: ApiErrorCode; readonly message: string };
}

const STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400,
  not_found: 404,
  method_not_allowed: 405,
  not_implemented: 501,
  unauthorized: 401,
  conflict: 409,
  internal: 500,
};

/**
 * Défi d'authentification d'un 401 (RFC 9110 §11.6.1) : sans cet en-tête le
 * client ne sait pas quel jeton présenter. Le type de jeton est le sien
 * (device appairé), jamais un indice sur la cause du refus : 401 est
 * INDISTINGUABLE (inexistant / expiré / révoqué / mauvais format).
 */
const AUTH_CHALLENGE: Readonly<Record<string, string>> = {
  "www-authenticate": 'Bearer realm="api"',
};

/**
 * Réponse d'erreur typée. `extraHeaders` porte les en-têtes exigés par le
 * statut (`Allow` sur un 405, `WWW-Authenticate` sur un 401) ; un 401 les
 * reçoit toujours, qu'on les passe ou non.
 */
export function apiError(code: ApiErrorCode, message: string, extraHeaders?: Readonly<Record<string, string>>): Response {
  const body: ApiErrorBody = { error: { code, message } };
  const headers = new Headers(extraHeaders);
  if (code === "unauthorized" && !headers.has("www-authenticate")) {
    for (const [k, v] of Object.entries(AUTH_CHALLENGE)) headers.set(k, v);
  }
  return Response.json(body, { status: STATUS[code], headers });
}

export function isApiErrorBody(v: unknown): v is ApiErrorBody {
  if (typeof v !== "object" || v === null) return false;
  const e = (v as Record<string, unknown>)["error"];
  if (typeof e !== "object" || e === null) return false;
  const { code, message } = e as Record<string, unknown>;
  return (
    typeof code === "string" &&
    (API_ERROR_CODES as readonly string[]).includes(code) &&
    typeof message === "string" &&
    message.length > 0
  );
}
