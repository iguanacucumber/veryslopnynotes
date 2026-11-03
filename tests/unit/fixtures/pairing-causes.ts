// Une fixture par cause d'échec d'appairage (#877). Le champ `cause` est le
// CODE du pont ; le TEXTE de l'exception ne doit jamais classer.
export interface PairingCauseCase {
  kind: string;
  message?: string;
  code?: number;
  status?: number;
  cause: string;
  why: string;
}

export const PAIRING_CAUSES: PairingCauseCase[] = [
  { kind: "io", message: "Failed to connect", cause: "network", why: "transport" },
  { kind: "rate", cause: "rate_limited", why: "G=25 / 429" },
  { kind: "qr", message: "invalid confirmation code", cause: "qr_rejected", why: "PIN faux" },
  { kind: "mfa", message: "PIN is required for this account", cause: "mfa_required", why: "2FA absente" },
  {
    kind: "ip",
    message: "Your IP address is suspended.",
    cause: "ip_suspended",
    why: "réseau bloqué",
  },
  {
    kind: "unexpected",
    message: "Page html is different than expected.",
    cause: "unexpected_page",
    why: "URL hors établissement",
  },
  {
    kind: "expired",
    message: "The object was from a previous session.",
    cause: "login_refused",
    why: "G=22 : jeton périmé",
  },
  { kind: "pronote", code: 5, cause: "login_refused", why: "refus applicatif" },
  { kind: "pronote", status: 401, cause: "login_refused", why: "jeton refusé" },
  { kind: "pronote", status: 500, cause: "school_unreachable", why: "panne de l'établissement" },
  {
    kind: "other",
    message: "login credential username refusé",
    cause: "school_unreachable",
    why: "aucun mot du message ne classe",
  },
];
