// Menus de la cantine : payload -> jours + repas d'affichage.
// Aucun HTML : les plats et allergènes sont des chaînes bornées, rendues en
// texte. Les jetons du contrat sont traduits, jamais affichés bruts.
import { cleanText, frDateLong, isoDay, parseDate } from "../../lib/format";

export const CANTEEN_MAX_DAYS = 14;
export const CANTEEN_MAX_MEALS_PER_DAY = 3;
export const CANTEEN_MAX_DISHES = 20;
export const CANTEEN_MAX_DISH_CHARS = 120;
export const CANTEEN_MAX_ALLERGENS = 14;
export const CANTEEN_MAX_ALLERGEN_CHARS = 40;
/** Entrées brutes lues au plus : un payload géant ne fait pas tourner le parseur. */
export const CANTEEN_MAX_SCAN = 500;

const MEALS = new Set(["breakfast", "lunch", "dinner"]);
const MEAL_LABELS: Record<string, string> = {
  breakfast: "Petit-déjeuner",
  lunch: "Déjeuner",
  dinner: "Dîner",
};

export interface CanteenMenu {
  date: string;
  meal: string;
  dishes: string[];
  allergens: string[];
}

export interface CanteenDay {
  date: string;
  meals: CanteenMenu[];
}

export interface CanteenWeek {
  days: CanteenDay[];
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

/** Jour normalisé en ISO local, `null` si la date est illisible : une date
 *  brute n'est jamais utilisée comme clé de regroupement. */
function dayKey(value: unknown): string | null {
  const raw = text(value, 40);
  if (!raw) return null;
  const date = parseDate(raw);
  return date ? isoDay(date) : null;
}

/** Lit les menus du contrat (`menus`) ou l'enveloppe factice (`items`).
 *  Repas inconnu, date illisible ou sans plat = ligne ignorée : aucun menu
 *  inventé. Le solde et le statut ne sont pas publiés par le producteur natif,
 *  donc l'écran ne les affiche pas. */
export function parseCanteenPayload(payload: string | null): CanteenWeek {
  const root = parseRoot(payload);
  const byDate = new Map<string, CanteenMenu[]>();
  const seen = new Set<string>();
  const rawMenus = menuArray(root);
  const scan = Math.min(rawMenus.length, CANTEEN_MAX_SCAN);

  for (let index = 0; index < scan; index++) {
    const raw = rawMenus[index];
    if (!isRecord(raw)) continue;
    const date = dayKey(raw["date"]);
    const meal = text(raw["meal"], 20);
    if (!date || !MEALS.has(meal)) continue;
    const bucket = byDate.get(date);
    if (!bucket && byDate.size >= CANTEEN_MAX_DAYS) continue;
    // Un même jour+repas n'existe qu'une fois ; trois repas maximum par jour.
    const key = `${date}|${meal}`;
    if (seen.has(key)) continue;
    if (bucket && bucket.length >= CANTEEN_MAX_MEALS_PER_DAY) continue;
    const dishes = boundedStrings(raw["dishes"], CANTEEN_MAX_DISHES, CANTEEN_MAX_DISH_CHARS);
    if (dishes.length === 0) continue;
    seen.add(key);
    const menu: CanteenMenu = {
      date,
      meal,
      dishes,
      allergens: boundedStrings(raw["allergens"], CANTEEN_MAX_ALLERGENS, CANTEEN_MAX_ALLERGEN_CHARS),
    };
    if (bucket) bucket.push(menu);
    else byDate.set(date, [menu]);
  }

  const days = [...byDate.entries()]
    .sort(([a], [b]) => (a === b ? 0 : a < b ? -1 : 1))
    .map(([date, meals]) => ({ date, meals }));
  return { days };
}

/** Date longue française ; vide si la donnée n'est pas datable. Une date seule
 *  est lue à minuit local (analyseur partagé) pour ne pas glisser d'un jour. */
export function canteenDayLabel(date: string): string {
  return frDateLong(date);
}

export function canteenMealLabel(meal: string): string {
  return MEAL_LABELS[meal] ?? "Repas";
}
