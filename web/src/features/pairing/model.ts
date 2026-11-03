// Appairage : validation du QR scanné, hôte affichable et traduction des codes
// d'échec en phrases actionnables. Le QR et le PIN sont des secrets de session :
// rien ici ne les écrit, ne les journalise ni ne les rend en entier.

import type { ScannedQr } from "../../bridge/types";

export const PIN_MAX_CHARS = 64;
const MAX_QR_FIELD_CHARS = 1024;
const MAX_SCHOOL_URL_CHARS = 300;
const MAX_HANDLE_CHARS = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bounded(value: string, max: number): boolean {
  return value !== "" && value.length <= max;
}

/** On ne rend jamais `login`, `jeton`, chemin, query ni identifiants : seul le
 *  domaine. `""` = adresse illisible. */
export function qrHost(url: string): string {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    return parsed.hostname;
  } catch {
    return "";
  }
}

export function validateScannedQr(value: unknown): ScannedQr | null {
  if (!isRecord(value)) return null;
  const handle = typeof value["handle"] === "string" ? value["handle"].trim() : "";
  const login = typeof value["login"] === "string" ? value["login"].trim() : "";
  const url = typeof value["url"] === "string" ? value["url"].trim() : "";
  if (!bounded(handle, MAX_HANDLE_CHARS) || !bounded(login, MAX_QR_FIELD_CHARS)) return null;
  if (!bounded(url, MAX_SCHOOL_URL_CHARS) || qrHost(url) === "") return null;
  return { handle, login, url };
}

export function normalizePin(raw: string): string {
  return raw.trim();
}

/** `null` = PIN acceptable. La borne est celle du contrat natif. */
export function pinError(raw: string): string | null {
  const pin = normalizePin(raw);
  if (pin === "") return "Le PIN du QR est obligatoire : il déchiffre le code scanné.";
  if (pin.length > PIN_MAX_CHARS) return `PIN trop long (${PIN_MAX_CHARS} caractères maximum).`;
  return null;
}

/** Le geste à faire, jamais un diagnostic brut ; la démo ne demande aucun QR,
 *  donc jamais « rescane ». */
export function demoErrorMessage(code: string | undefined): string {
  switch ((code ?? "").toLowerCase()) {
    case "network":
      return "Réseau indisponible : vérifie ta connexion, puis réessaie.";
    case "demo_failed":
      return "L'établissement de démonstration ne répond pas : réessaie dans un instant.";
    case "auth_required":
      return "Session expirée : reconnecte l'établissement de démonstration.";
    case "unavailable":
      return "Le téléphone n'a pas répondu : réessaie dans un instant.";
    default:
      return "Connexion à la démo impossible : réessaie dans un instant.";
  }
}

export function scanErrorMessage(cancelled: boolean): string {
  if (cancelled) return "Scan annulé : aucun QR lu. Tu peux rescanner quand tu veux.";
  return "Aucun QR lu (caméra refusée ou code illisible) : rescane le code affiché par ton application.";
}

/** Code d'échec natif -> phrase qui dit le bon geste, jamais un diagnostic brut. */
export function pairErrorMessage(code: string | undefined): string {
  switch ((code ?? "").toLowerCase()) {
    case "qr_rejected":
      return "QR ou PIN refusé par l'établissement : rescane le code affiché par son application.";
    case "mfa_required":
      return "Ce compte exige une vérification supplémentaire que l'app ne prend pas en charge.";
    case "ip_suspended":
      return "L'établissement bloque l'accès depuis ce réseau : change de réseau (Wi-Fi ou données), puis réessaie.";
    case "unexpected_page":
      return "L'adresse du QR ne mène pas à l'établissement : régénère le QR dans son application, puis rescane-le.";
    case "login_refused":
      return "Compte refusé par l'établissement : régénère le QR dans son application, puis rescane-le.";
    case "rate_limited":
      return "L'établissement limite les connexions : attends une ou deux minutes, puis réessaie.";
    case "school_unreachable":
      return "L'établissement ne répond pas : réessaie dans un instant.";
    case "network":
      return "Réseau indisponible : vérifie ta connexion, puis réessaie.";
    case "bad_request":
      return "QR et PIN requis : vérifie le PIN, puis rescane le QR si besoin.";
    case "auth_required":
      return "Session expirée : rescane le QR de l'établissement pour te reconnecter.";
    case "unavailable":
      return "Le téléphone n'a pas répondu : réessaie dans un instant.";
    default:
      return "Appairage impossible : rescane le QR puis réessaie.";
  }
}
