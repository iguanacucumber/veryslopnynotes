// Fixtures 100 % synthétiques pour la cantine (#81). Plats, allergènes et
// soldes inventés : aucune donnée d'établissement, aucun secret, aucune URL.
// Menu ci-dessous = forme synthétique minimale pour tester le mapper défensif.
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
