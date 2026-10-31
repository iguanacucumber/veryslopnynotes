// 100 % synthétique : aucune donnée d'établissement, aucun secret, aucune URL.
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

export const syntheticCanteenPayload = {
  menus: syntheticCanteenMenus,
  balance: syntheticCanteenBalance,
};
