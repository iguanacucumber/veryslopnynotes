// Le module cantine est souvent absent de l'établissement : l'absence est un
// fait normal, pas une erreur.
import {
  isBoundedStringArray,
  isFiniteNumber,
  isIsoDate,
  isNonEmptyString,
  isRecord,
} from "./guards";

export const CANTEEN_MEALS = ["breakfast", "lunch", "dinner"] as const;

export type CanteenMeal = (typeof CANTEEN_MEALS)[number];

/** Statut publié par l'établissement, absent sinon. */
export const CANTEEN_MENU_STATUSES = ["served", "planned"] as const;

export type CanteenMenuStatus = (typeof CANTEEN_MENU_STATUSES)[number];

// Bornes dures : contenu cantine est du texte libre externe (I6), il ne sort
// jamais de l'API sans plafond de longueur ni de volume.
export const CANTEEN_MAX_DISHES = 20;
export const CANTEEN_MAX_DISH_CHARS = 120;
export const CANTEEN_MAX_ALLERGENS = 14;
export const CANTEEN_MAX_ALLERGEN_CHARS = 40;
export const CANTEEN_MAX_CURRENCY_CHARS = 8;

export interface CanteenMenu {
  readonly id: string;
  readonly accountId: string;
  /** Jour de service (ISO-8601), borné par la fenêtre from/to demandée. */
  readonly date: string;
  readonly meal: CanteenMeal;
  /** Libellés de plats : données Pronote non fiables, jamais instruction (I6). */
  readonly dishes: string[];
  /** Étiquettes alimentaires du repas (gluten, lactose, ...) si publiées. */
  readonly allergens?: string[];
  readonly status?: CanteenMenuStatus;
}

/** Solde du compte cantine (Turboself/ARD) : absent tant que l'établissement ne le publie pas. */
export interface CanteenBalance {
  readonly balance: number;
  readonly currency?: string;
  readonly updatedAt: string; // ISO-8601
}

export function isCanteenMeal(v: unknown): v is CanteenMeal {
  return typeof v === "string" && (CANTEEN_MEALS as readonly string[]).includes(v);
}

export function isCanteenMenu(v: unknown): v is CanteenMenu {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["id"]) || !isNonEmptyString(v["accountId"])) return false;
  if (!isIsoDate(v["date"])) return false;
  if (!isCanteenMeal(v["meal"])) return false;
  if (!isBoundedStringArray(v["dishes"], CANTEEN_MAX_DISHES, CANTEEN_MAX_DISH_CHARS)) return false;
  if (
    v["allergens"] !== undefined &&
    !isBoundedStringArray(v["allergens"], CANTEEN_MAX_ALLERGENS, CANTEEN_MAX_ALLERGEN_CHARS)
  ) {
    return false;
  }
  if (
    v["status"] !== undefined &&
    !(CANTEEN_MENU_STATUSES as readonly string[]).includes(v["status"] as string)
  ) {
    return false;
  }
  return true;
}

export function isCanteenBalance(v: unknown): v is CanteenBalance {
  if (!isRecord(v)) return false;
  if (!isFiniteNumber(v["balance"])) return false;
  if (v["currency"] !== undefined) {
    const c = v["currency"];
    if (typeof c !== "string") return false;
    if (c.trim().length > CANTEEN_MAX_CURRENCY_CHARS) return false;
  }
  return isIsoDate(v["updatedAt"]);
}
