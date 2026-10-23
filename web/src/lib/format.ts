const FR_DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const FR_DAYS_SHORT = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const FR_MONTHS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];
/** Abréviations françaises (usage typographique) : les mois courts ne
 *  s'abrègent pas (« mars », « mai », « juin », « août »). */
const FR_MONTHS_SHORT = [
  "janv.", "févr.", "mars", "avr.", "mai", "juin",
  "juil.", "août", "sept.", "oct.", "nov.", "déc.",
];

/** Une date seule (`YYYY-MM-DD`) est un jour civil : minuit LOCAL. */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Instant (ms) d'un ISO du contrat, ou null s'il est illisible. Les deux
 *  formes sont admises : instant complet et date seule. Une date SEULE est
 *  minuit LOCAL (comme le parseur natif), sinon elle glisserait d'un jour
 *  dans les fuseaux à l'ouest de Greenwich. */
export function parseInstant(value: string | null | undefined): number | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;
  const dateOnly = DATE_ONLY.exec(raw);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]) - 1;
    const day = Number(dateOnly[3]);
    const local = new Date(year, month, day);
    if (local.getFullYear() !== year || local.getMonth() !== month || local.getDate() !== day) return null;
    return local.getTime();
  }
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

export function parseDate(value: string | null | undefined): Date | null {
  const ms = parseInstant(value);
  return ms === null ? null : new Date(ms);
}

export function frDate(value: string | null | undefined): string {
  const d = parseDate(value);
  if (!d) return "";
  return `${FR_DAYS[d.getDay()]} ${d.getDate()} ${FR_MONTHS[d.getMonth()]}`;
}

/** « 16 octobre 2026 » ; vide si la date est illisible. */
export function frDateLong(value: string | null | undefined): string {
  const d = parseDate(value);
  if (!d) return "";
  return `${d.getDate()} ${FR_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function frDateShort(value: string | null | undefined): string {
  const d = parseDate(value);
  if (!d) return "";
  return `${d.getDate()} ${FR_MONTHS_SHORT[d.getMonth()] ?? ""}`;
}

export function frTime(value: string | null | undefined): string {
  const d = parseDate(value);
  if (!d) return "";
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

export function frRange(start: string, end: string): string {
  const a = frTime(start);
  const b = frTime(end);
  if (!a) return b;
  if (!b) return a;
  return `${a} – ${b}`;
}

export function frDay(value: string | Date): string {
  const d = value instanceof Date ? value : parseDate(value);
  if (!d) return "";
  return FR_DAYS[d.getDay()] ?? "";
}

export function frDayShort(value: string | Date): string {
  const d = value instanceof Date ? value : parseDate(value);
  if (!d) return "";
  return FR_DAYS_SHORT[d.getDay()] ?? "";
}

export function frMonthYear(value: string | Date): string {
  const d = value instanceof Date ? value : parseDate(value);
  if (!d) return "";
  return `${FR_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function startOfWeek(value: Date): Date {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  const delta = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - delta);
  return d;
}

export function addDays(value: Date, days: number): Date {
  const d = new Date(value);
  d.setDate(d.getDate() + days);
  return d;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function relativeFr(value: string, now: number = Date.now()): string {
  const d = parseDate(value);
  if (!d) return "";
  const diff = now - d.getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const days = Math.round(h / 24);
  if (days === 1) return "hier";
  if (days < 7) return `il y a ${days} j`;
  return frDateShort(value);
}

/** Les payloads peuvent contenir des caractères de contrôle : jamais rendus
 *  bruts. React échappe déjàle HTML ; ceci nettoie seulement le texte. */
export function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
}

export function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number.parseFloat(value.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

export function formatNote(value: number, scale = 20): string {
  const n = asNumber(value);
  const s = scale > 0 ? scale : 20;
  const out = (n / s) * 20;
  return out.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

const PALETTE = [
  "#c50017", "#da2400", "#dd6b00", "#e8901c", "#e8b048",
  "#6bae00", "#37bb12", "#12bb67", "#26b290", "#26abb2",
  "#2db9d8", "#009ec5", "#007fda", "#3a56d0", "#7600ca",
  "#962dd8", "#b300ca", "#c50066", "#dd004a", "#dd0030",
];

export function subjectColor(subject: string): string {
  let hash = 0;
  for (let i = 0; i < subject.length; i++) hash = (hash * 31 + subject.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length] ?? PALETTE[0]!;
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) return null;
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function tint(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const a = Math.min(1, Math.abs(amount));
  const channel = (v: number) => (amount >= 0 ? v + (255 - v) * a : v - v * a);
  const [r, g, b] = rgb.map((v) => Math.round(channel(v))) as [number, number, number];
  return `rgb(${r} ${g} ${b})`;
}

/** Encre lisible sur une couleur arbitraire (aperçu de palette, pastille). */
export function readableInk(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#ffffff";
  const [r, g, b] = rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.55 ? "#1f292e" : "#ffffff";
}
