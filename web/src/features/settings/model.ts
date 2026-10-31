// Réglages : validation de l'adresse serveur, bornes des préférences, couleurs
// et emoji. Aucune règle réseau ici, seulement ce qui peut être dit avant
// l'écriture.

import type { ManualSaveResult, SubjectPref, SubjectSaveResult } from "../../bridge/types";

export type Theme = "SYSTEM" | "LIGHT" | "DARK";

export const THEME_OPTIONS: ReadonlyArray<{ value: Theme; label: string }> = [
  { value: "SYSTEM", label: "Système" },
  { value: "LIGHT", label: "Clair" },
  { value: "DARK", label: "Sombre" },
];

export const MAX_BASE_URL_CHARS = 300;
export const MAX_AUTHORITY_CHARS = 253;
export const MAX_SUBJECT_CHARS = 64;
export const MAX_LABEL_CHARS = 64;
export const MAX_EMOJI_CHARS = 8;
export const MAX_SUBJECT_PREFS = 64;
export const MAX_API_KEY_CHARS = 512;
/** Miroir de `ManualUrl.MAX_CHARS` (core Kotlin) et du contrat scraper. */
export const MAX_MANUAL_URL_CHARS = 2000;

/** Catalogue de l'éditeur ; l'élève peut le remplacer par un manuel précis. */
export const DEFAULT_MANUAL_URL = "https://www.lelivrescolaire.fr/manuels";

/** Le message NATIF fait foi quand il existe ; le repli est générique. */
export function llmSaveError(response: { ok: boolean; message?: string }): string {
  if (response.ok) return "";
  const message = (response.message ?? "").trim();
  return message !== "" ? message : "Clé refusée : vérifie qu'elle est complète.";
}

export interface ManualSaveNotice {
  notice: string;
  kind: "info" | "error";
}

/** Le message natif fait foi ; la gravité suit le succès réel du scraper. */
export function manualSaveNotice(response: ManualSaveResult): ManualSaveNotice {
  if (response.auto === true) {
    const guess = [response.level ?? "", (response.specialties ?? []).join(", ")]
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .join(" · ");
    return {
      notice:
        guess === ""
          ? "Manuel automatique activé : l’ouvrage suivra la matière du devoir."
          : `Manuel automatique activé (${guess}).`,
      kind: "info",
    };
  }
  return {
    notice: response.ready
      ? "Manuel récupéré : l'assistant peut le citer."
      : response.message || "Adresse enregistrée, mais le manuel n'a pas pu être récupéré.",
    kind: response.ready ? "info" : "error",
  };
}

const MAX_LABEL_PART = 63;
const MAX_PORT = 65535;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export type ServerHostResult = { ok: true; value: string } | { ok: false; message: string };

export function themeLabel(theme: Theme): string {
  return THEME_OPTIONS.find((option) => option.value === theme)?.label ?? "Système";
}

/** Valeur inconnue = Système : un thème invalide ne casse pas le démarrage. */
export function parseTheme(raw: unknown): Theme {
  return raw === "LIGHT" || raw === "DARK" ? raw : "SYSTEM";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejected(message: string): ServerHostResult {
  return { ok: false, message };
}

function isAuthorityChar(char: string): boolean {
  return (
    char === "." ||
    char === "-" ||
    char === ":" ||
    char === "[" ||
    char === "]" ||
    (char >= "0" && char <= "9") ||
    (char >= "a" && char <= "z")
  );
}

function isIpv4(host: string): boolean {
  const groups = host.split(".");
  return (
    groups.length === 4 &&
    groups.every((group) => {
      if (!/^\d{1,3}$/.test(group)) return false;
      if (group.length > 1 && group.startsWith("0")) return false;
      return Number(group) <= 255;
    })
  );
}

function isIpv6(host: string): boolean {
  if ((host.match(/:/g) ?? []).length < 2) return false;
  return /^[0-9a-f:.]+$/.test(host);
}

function isDnsName(host: string): boolean {
  if (host.endsWith(".")) return false;
  const labels = host.split(".");
  const last = labels[labels.length - 1] ?? "";
  if (labels.length > 1 && /^\d+$/.test(last)) return false;
  return labels.every(
    (label) =>
      label.length >= 1 &&
      label.length <= MAX_LABEL_PART &&
      /^[a-z0-9-]+$/.test(label) &&
      !label.startsWith("-") &&
      !label.endsWith("-"),
  );
}

function isValidHost(host: string): boolean {
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (bare === "" || bare.length > MAX_AUTHORITY_CHARS) return false;
  if (bare.includes(":")) return isIpv6(bare);
  return isIpv4(bare) || isDnsName(bare);
}

function splitAuthority(authority: string): { host: string; port: string | null } | null {
  if (authority.startsWith("[")) {
    const end = authority.indexOf("]");
    if (end < 0) return null;
    const rest = authority.slice(end + 1);
    if (rest === "") return { host: authority.slice(0, end + 1), port: null };
    if (!rest.startsWith(":")) return null;
    return { host: authority.slice(0, end + 1), port: rest.slice(1) };
  }
  const colon = authority.lastIndexOf(":");
  if (colon < 0) return { host: authority, port: null };
  if (authority.slice(0, colon).includes(":")) return null;
  return { host: authority.slice(0, colon), port: authority.slice(colon + 1) };
}

function isValidPort(port: string): boolean {
  return /^\d{1,5}$/.test(port) && Number(port) >= 1 && Number(port) <= MAX_PORT;
}

function isLoopbackHost(host: string): boolean {
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  return bare === "10.0.2.2" || bare === "localhost" || bare === "::1" || (isIpv4(bare) && bare.startsWith("127."));
}

/** `http` n'est toléré que pour l'émulateur et la boucle locale, comme le natif.
 *  La valeur rendue est celle attendue par le bridge (hôte sans schéma). */
export function validateServerHost(raw: string): ServerHostResult {
  const input = raw.trim();
  if (input === "") return rejected("Adresse vide : saisis l'adresse de ton serveur.");
  if (input.length > MAX_BASE_URL_CHARS) return rejected(`Adresse trop longue (${MAX_BASE_URL_CHARS} caractères maximum).`);
  if (/\s|[\u0000-\u001F\u007F]/.test(input)) return rejected("Espace ou caractère interdit dans l'adresse.");

  const sep = input.indexOf("://");
  let scheme: string | null = null;
  let rest = input;
  if (sep >= 0) {
    scheme = input.slice(0, sep).toLowerCase();
    if (scheme !== "https" && scheme !== "http") {
      return rejected("Schéma refusé : utilise https (http est réservé à l'émulateur et à la boucle locale).");
    }
    rest = input.slice(sep + 3);
  }

  const authority = rest.toLowerCase().replace(/\/+$/, "");
  if (authority === "") return rejected("Domaine manquant après le schéma.");
  if (authority.length > MAX_AUTHORITY_CHARS) return rejected(`Domaine trop long (${MAX_AUTHORITY_CHARS} caractères maximum).`);
  if (authority.includes("@")) return rejected("Identifiants (utilisateur:mot de passe@) refusés : saisis seulement le domaine.");
  if (authority.includes("/")) return rejected("Chemin refusé : saisis seulement le domaine et le port.");
  if (authority.includes("?") || authority.includes("#")) {
    return rejected("Paramètres ou ancre refusés : saisis seulement le domaine et le port.");
  }
  if ([...authority].some((char) => !isAuthorityChar(char))) return rejected("Caractère interdit dans le domaine.");

  const parts = splitAuthority(authority);
  if (!parts) return rejected("Adresse illisible : vérifie le domaine et le port.");
  if (!isValidHost(parts.host)) {
    return rejected("Domaine invalide : utilise un nom de domaine, une IPv4 ou une IPv6 entre crochets.");
  }
  if (parts.port !== null && !isValidPort(parts.port)) {
    return rejected("Port invalide : utilise un nombre entre 1 et 65535.");
  }
  if (scheme === "http" && !isLoopbackHost(parts.host)) {
    return rejected("HTTP est réservé à l'émulateur et à la boucle locale : utilise l'adresse https de ton serveur.");
  }

  return { ok: true, value: scheme === null ? authority : `${scheme}://${authority}` };
}

export function normalizeColorHex(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return COLOR_RE.test(trimmed) ? trimmed.toUpperCase() : null;
}

export function codePointLength(value: string): number {
  return [...value].length;
}

export function normalizeEmoji(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (trimmed === "" || codePointLength(trimmed) > MAX_EMOJI_CHARS) return null;
  return trimmed;
}

export function subjectNameError(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return null;
  return trimmed.length > MAX_SUBJECT_CHARS ? `${MAX_SUBJECT_CHARS} caractères maximum` : null;
}

export function subjectLabelError(label: string): string | null {
  return label.trim().length > MAX_LABEL_CHARS ? `${MAX_LABEL_CHARS} caractères maximum` : null;
}

export interface SubjectDraft {
  color: string;
  emoji: string;
  label: string;
}

export function buildSubjectPref(subject: string, draft: SubjectDraft): SubjectPref | null {
  const name = subject.trim();
  if (name === "" || name.length > MAX_SUBJECT_CHARS) return null;
  const label = draft.label.trim();
  if (label.length > MAX_LABEL_CHARS) return null;
  return {
    subject: name,
    color: normalizeColorHex(draft.color),
    emoji: normalizeEmoji(draft.emoji),
    label: label === "" ? null : label,
  };
}

/** Formes inconnues ignorées, jamais rendues telles quelles. */
export function sanitizeSubjectPrefs(value: unknown): SubjectPref[] {
  const list = Array.isArray(value) ? value : [];
  const out: SubjectPref[] = [];
  for (const raw of list) {
    if (out.length >= MAX_SUBJECT_PREFS) break;
    if (!isRecord(raw)) continue;
    const subject = typeof raw["subject"] === "string" ? raw["subject"].trim() : "";
    if (subject === "" || subject.length > MAX_SUBJECT_CHARS) continue;
    const label = typeof raw["label"] === "string" ? raw["label"].trim() : "";
    out.push({
      subject,
      color: normalizeColorHex(typeof raw["color"] === "string" ? raw["color"] : null),
      emoji: normalizeEmoji(typeof raw["emoji"] === "string" ? raw["emoji"] : null),
      label: label === "" || label.length > MAX_LABEL_CHARS ? null : label,
    });
  }
  return out;
}

export const SUBJECT_REFUSED_MESSAGE = "Matière refusée : corrige la couleur, l'emoji ou le libellé.";

/** Le pont ne répond `ok:true` que s'il a vraiment écrit : un `ok:false` doit
 *  être montré, jamais avalé en « Matière enregistrée. ». */
export function subjectSaveRefusal(response: SubjectSaveResult): string | null {
  if (response.ok) return null;
  const message = response.message?.trim();
  return message && message.length > 0 ? message : SUBJECT_REFUSED_MESSAGE;
}

export const SUBJECT_PALETTE: ReadonlyArray<string> = [
  "#C50017", "#DA2400", "#DD6B00", "#E8901C", "#E8B048",
  "#6BAE00", "#37BB12", "#12BB67", "#26B290", "#26ABB2",
  "#2DB9D8", "#009EC5", "#007FDA", "#3A56D0", "#7600CA",
  "#962DD8", "#B300CA", "#C50066", "#DD004A", "#DD0030",
];

export const SUBJECT_EMOJI: ReadonlyArray<string> = [
  "📘", "📐", "🔬", "🌍", "🗺️", "📜", "🧮", "🎨", "🎵", "💻", "⚽", "🌱",
];

/** La couleur enregistrée reste proposée même hors palette (sinon invisible). */
export function subjectSwatchColors(current: string | null | undefined): string[] {
  const hex = normalizeColorHex(current);
  if (hex === null) return [...SUBJECT_PALETTE];
  const known = SUBJECT_PALETTE.some((knownHex) => knownHex === hex);
  return known ? [...SUBJECT_PALETTE] : [...SUBJECT_PALETTE, hex];
}

export function subjectEmojiChoices(current: string | null | undefined): string[] {
  const emoji = normalizeEmoji(current);
  if (emoji === null || SUBJECT_EMOJI.includes(emoji)) return [...SUBJECT_EMOJI];
  return [...SUBJECT_EMOJI, emoji];
}
