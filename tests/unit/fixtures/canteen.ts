// Fixtures 100 % synthétiques pour la cantine (#81). Plats, allergènes et
// soldes inventés : aucune donnée d'établissement, aucun secret, aucune URL.
// Menu " Pronote " ci-dessous = forme brute lue par PronoteClientReader
// (page PageMenus), volontairement minimale pour tester le mapper défensif.
import type { CanteenBalance, CanteenMenu } from "../../../shared/contracts/models";

export const syntheticCanteenAccountId = "acc-fake-1";

export const syntheticCanteenMenus: CanteenMenu[] = [
  {
    id: "menu-fake-1",
    accountId: syntheticCanteenAccountId,
    date: "2026-10-05T00:00:00.000Z",
    meal: "lunch",
    dishes: ["Poulet rôti", "Haricots verts", "Yaourt", "Compote"],
    allergens: ["gluten", "lactose"],
  },
  {
    id: "menu-fake-2",
    accountId: syntheticCanteenAccountId,
    date: "2026-10-06T00:00:00.000Z",
    meal: "dinner",
    dishes: ["Soupe de légumes", "Quiche"],
    status: "planned",
  },
];

export const syntheticCanteenBalance: CanteenBalance = {
  balance: 12.5,
  currency: "EUR",
  updatedAt: "2026-10-05T07:00:00.000Z",
};

/** Payload /v1/menus conforme au contrat (menus + solde). */
export const syntheticCanteenPayload = {
  menus: syntheticCanteenMenus,
  balance: syntheticCanteenBalance,
};

/**
 * Forme brute côté client pronotets : isLunch/isDinner + tableaux de plats
 * (firstMeal/mainMeal/sideMeal/otherMeal/cheese/dessert), chaque plat portant
 * ses labels alimentaires.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function syntheticRawMenus(): any[] {
  return [
    {
      id: "m1",
      name: "Déjeuner",
      date: new Date("2026-10-05T00:00:00.000Z"),
      isLunch: true,
      isDinner: false,
      firstMeal: [{ name: "Entrée", labels: [{ name: "gluten" }] }],
      mainMeal: [{ name: "Poulet rôti", labels: [] }],
      sideMeal: [{ name: "Haricots verts", labels: [] }],
      dessert: [{ name: "Compote", labels: [] }],
    },
    {
      id: "m2",
      name: "Dîner",
      date: new Date("2026-10-06T00:00:00.000Z"),
      isLunch: false,
      isDinner: true,
      mainMeal: [{ name: "Quiche", labels: [{ name: "oeuf" }] }],
    },
    {
      // Petit-déjeuner reconnu par le nom (pronotets n'expose que lunch/dinner).
      id: "m3",
      name: "Petit-déjeuner",
      date: new Date("2026-10-07T00:00:00.000Z"),
      isLunch: false,
      isDinner: false,
      firstMeal: [{ name: "Céréales", labels: [] }],
    },
    // Repas sans plat lisible + date absente : ignorés par le mapper.
    { id: "m4", name: "Goûter", date: new Date("2026-10-08T00:00:00.000Z"), isLunch: true },
    { id: "m5", name: "Sans date", isLunch: true, mainMeal: [{ name: "Plat" }] },
  ];
}
