// Menus de la cantine : payload -> jours + repas d'affichage.
// Aucun HTML : les plats et allergènes sont des chaînes bornées, rendues en
// texte. Les jetons du contrat sont traduits, jamais affichés bruts.
import { cleanText } from "../../lib/format";

export const CANTEEN_MAX_DAYS = 14;
export const CANTEEN_MAX_DISHES = 20;
export const CANTEEN_MAX_DISH_CHARS = 120;
export const CANTEEN_MAX_ALLERGENS = 14;
export const CANTEEN_MAX_ALLERGEN_CHARS = 40;

const MEALS = new Set(["breakfast", "lunch", "dinner"]);
const MEAL_LABELS: Record<string, string> = {
  breakfast: "Petit-déjeuner",
  lunch: "Déjeuner",
  dinner: "Dîner",
};
const STATUS_LABELS: Record<string, string> = {
  served: "Servi",
  planned: "Prévu",
};

export interface CanteenMenu {
  date: string;
  meal: string;
  dishes: string[];
  allergens: string[];
  status: string | null;
}

export interface CanteenDay {
  date: string;
  meals: CanteenMenu[];
}

export interface CanteenWeek {
  days: CanteenDay[];
  balance: { amount: string; updatedAt: string } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? cleanText(value).slice(0, max) : "";
}

function boundedStrings(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    if (out.length >= maxItems) break;
    const item = text(raw, maxChars);
    if (item && !out.includes(item)) out.push(item);
  }
  return out;
}

function parseRoot(payload: string | null): Record<string, unknown> | null {
  if (!payload) return null;
  try {
    const root: unknown = JSON.parse(payload);
    return isRecord(root) ? root : null;
  } catch {
    return null;
  }
}

function menuArray(root: Record<string, unknown> | null): unknown[] {
  if (!root) return [];
  if (Array.isArray(root["menus"])) return root["menus"];
  if (Array.isArray(root["items"])) return root["items"];
  return [];
}

const moneyFormat = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function parseBalance(value: unknown): CanteenWeek["balance"] {
  if (!isRecord(value) || value["balance"] == null) return null;
  const raw = value["balance"];
  const amount =
    typeof raw === "number" && Number.isFinite(raw)
      ? raw
      : typeof raw === "string"
        ? Number.parseFloat(raw.replace(",", "."))
        : Number.NaN;
  if (!Number.isFinite(amount)) return null;
  const currency = text(value["currency"], 8) || "€";
  return {
    amount: `${moneyFormat.format(amount)} ${currency} (solde)`,
    updatedAt: text(value["updatedAt"], 64),
  };
}

/** Lit les menus du contrat (`menus`) ou l'enveloppe factice (`items`).
 *  Repas inconnu ou sans plat = ligne ignorée : aucun menu inventé. */
export function parseCanteenPayload(payload: string | null): CanteenWeek {
  const root = parseRoot(payload);
  const byDate = new Map<string, CanteenMenu[]>();
  for (const raw of menuArray(root)) {
    if (!isRecord(raw)) continue;
    const date = text(raw["date"], 40);
    const meal = text(raw["meal"], 20);
    if (!date || !MEALS.has(meal)) continue;
    if (!byDate.has(date) && byDate.size >= CANTEEN_MAX_DAYS) continue;
    const dishes = boundedStrings(raw["dishes"], CANTEEN_MAX_DISHES, CANTEEN_MAX_DISH_CHARS);
    if (dishes.length === 0) continue;
    const status = text(raw["status"], 32) || null;
    const menu: CanteenMenu = {
      date,
      meal,
      dishes,
      allergens: boundedStrings(raw["allergens"], CANTEEN_MAX_ALLERGENS, CANTEEN_MAX_ALLERGEN_CHARS),
      status,
    };
    const bucket = byDate.get(date);
    if (bucket) bucket.push(menu);
    else byDate.set(date, [menu]);
  }
  const days = [...byDate.entries()]
    .sort(([a], [b]) => (a === b ? 0 : a < b ? -1 : 1))
    .map(([date, meals]) => ({ date, meals }));
  return { days, balance: parseBalance(root?.["balance"]) };
}

const dayFormat = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** Date longue française ; vide si la donnée n'est pas datable. */
export function canteenDayLabel(date: string): string {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? "" : dayFormat.format(parsed);
}

export function canteenMealLabel(meal: string): string {
  return MEAL_LABELS[meal] ?? "Repas";
}

/** « Servi », « Prévu », « Statut inconnu » (jamais le jeton brut) ; `null` si
 *  l'établissement ne publie pas de statut. */
export function canteenStatusLabel(status: string | null): string | null {
  if (!status) return null;
  return STATUS_LABELS[status] ?? "Statut inconnu";
}

/** Une pastille n'est peinte que pour un statut connu du contrat. */
export function canteenStatusKnown(status: string | null): boolean {
  return status === "served" || status === "planned";
}
