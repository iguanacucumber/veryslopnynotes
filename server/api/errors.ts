// API v0 — erreurs typées (issue #10). Toute réponse d'erreur suit ce
// format, jamais de stack/secret en message (règle d'or dépôt public).

export const API_ERROR_CODES = [
  "bad_request",
  "not_found",
  "method_not_allowed",
  "not_implemented",
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
  internal: 500,
};

export function apiError(code: ApiErrorCode, message: string): Response {
  const body: ApiErrorBody = { error: { code, message } };
  return Response.json(body, { status: STATUS[code] });
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
