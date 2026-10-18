// Modèle de l'appairage (#120/#299) : validation du QR scanné, hôte affichable
// et traduction des codes d'échec en phrases actionnables. Le QR et le PIN sont
// des secrets de session : rien ici ne les écrit, ne les journalise ni ne les
// rend en entier.

export const PIN_MAX_CHARS = 64;
const MAX_QR_FIELD_CHARS = 1024;
const MAX_SCHOOL_URL_CHARS = 300;

export interface SchoolQr {
  login: string;
  jeton: string;
  url: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bounded(value: string, max: number): boolean {
  return value !== "" && value.length <= max;
}

/**
 * Hôte Seul de l'adresse portée par le QR. On ne rend jamais `login`, `jeton`,
 * chemin, query ni identifiants : l'écran n'a besoin que du domaine pour que
 * l'utilisateur reconnaisse son établissement. `""` = adresse illisible.
 */
export function qrHost(url: string): string {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    return parsed.hostname;
  } catch {
    return "";
  }
}

/** QR renvoyé par le natif : trois chaînes bornées et une adresse lisible. */
export function validateScannedQr(value: unknown): SchoolQr | null {
  if (!isRecord(value)) return null;
  const login = typeof value["login"] === "string" ? value["login"].trim() : "";
  const jeton = typeof value["jeton"] === "string" ? value["jeton"].trim() : "";
  const url = typeof value["url"] === "string" ? value["url"].trim() : "";
  if (!bounded(login, MAX_QR_FIELD_CHARS) || !bounded(jeton, MAX_QR_FIELD_CHARS)) return null;
  if (!bounded(url, MAX_SCHOOL_URL_CHARS) || qrHost(url) === "") return null;
  return { login, jeton, url };
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

/** Message d'un scan qui n'a rien rendu (annulation, caméra, code illisible). */
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
    case "login_refused":
      return "Compte refusé par l'établissement : régénère le QR dans son application, puis rescane-le.";
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
