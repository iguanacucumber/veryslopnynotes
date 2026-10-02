// #81 cantine : contrats, mapper défensif (PronoteClientReader), bornes de
// fenêtre et route. Fixtures 100 % synthétiques, mocks injectés : aucun réseau,
// aucun secret, aucune URL Pronote.
import { describe, expect, test } from "bun:test";
import { createHandler } from "../../server/api/router";
import { createMemoryStore } from "../../server/api/store";
import { PronoteSessionStore } from "../../server/integrations/pronote-sessions";
import { PronoteClientReader } from "../../server/integrations/pronote-client-reader";
import { PronoteReadError } from "../../server/domain/ports";
import { isApiErrorBody } from "../../server/api/errors";
import { isCanteenMenusResponse } from "../../shared/contracts/api";
import { CACHE_TTL_MS, cacheStatus, isCacheableResource } from "../../shared/contracts/cache";
import {
  CANTEEN_MAX_ALLERGENS,
  CANTEEN_MAX_DISHES,
  isCanteenBalance,
  isCanteenMenu,
} from "../../shared/contracts/models";
import { syntheticAccountId, syntheticEntKind, syntheticPassword, syntheticUsername } from "./fixtures/pronote";
import {
  syntheticCanteenBalance,
  syntheticCanteenMenus,
  syntheticCanteenPayload,
  syntheticRawMenus,
} from "./fixtures/canteen";

const creds = {
  accountId: syntheticAccountId,
  username: syntheticUsername,
  password: syntheticPassword,
  entKind: syntheticEntKind,
};

function fakeStore(client: unknown) {
  return new PronoteSessionStore({
    pronoteUrl: "https://example.test/pronote/eleve.html",
    clientFactory: (async () => client) as never,
  });
}

async function readerFor(client: unknown, logs: string[] = []) {
  const store = fakeStore(client);
  await store.authenticate({ ...creds, entKind: "ninegate" });
  return new PronoteClientReader({ sessions: store, logger: (m) => logs.push(m) });
}

const canteenClient = () => ({ menus: async () => syntheticRawMenus() });

describe("contrats cantine (#81)", () => {
  test("CanteenMenu : valide OK, bornes et fautes rejetées", () => {
    const [menu] = syntheticCanteenMenus;
    expect(isCanteenMenu(menu)).toBe(true);
    expect(isCanteenMenu({ ...menu, status: "served" })).toBe(true);
    expect(isCanteenMenu({ ...menu, id: "  " })).toBe(false);
    expect(isCanteenMenu({ ...menu, date: "pas-une-date" })).toBe(false);
    expect(isCanteenMenu({ ...menu, meal: "goûter" })).toBe(false);
    expect(isCanteenMenu({ ...menu, dishes: [] })).toBe(false);
    expect(isCanteenMenu({ ...menu, dishes: ["Plat", "  "] })).toBe(false);
    expect(isCanteenMenu({ ...menu, dishes: ["x".repeat(121)] })).toBe(false);
    expect(isCanteenMenu({ ...menu, dishes: new Array(CANTEEN_MAX_DISHES + 1).fill("Plat") })).toBe(false);
    expect(isCanteenMenu({ ...menu, allergens: ["gluten", "gluten"] })).toBe(false);
    expect(isCanteenMenu({ ...menu, allergens: new Array(CANTEEN_MAX_ALLERGENS + 1).fill("lactose") })).toBe(false);
    expect(isCanteenMenu({ ...menu, status: "annulé" })).toBe(false);
    expect(isCanteenMenu(null)).toBe(false);
  });

  test("CanteenBalance + réponse : types stricts", () => {
    expect(isCanteenBalance(syntheticCanteenBalance)).toBe(true);
    expect(isCanteenBalance({ ...syntheticCanteenBalance, currency: undefined })).toBe(true);
    expect(isCanteenBalance({ ...syntheticCanteenBalance, balance: NaN })).toBe(false);
    expect(isCanteenBalance({ ...syntheticCanteenBalance, balance: "12,50" })).toBe(false);
    expect(isCanteenBalance({ ...syntheticCanteenBalance, updatedAt: "hier" })).toBe(false);
    expect(isCanteenBalance({ ...syntheticCanteenBalance, currency: "EUR-EURO-PIECE" })).toBe(false);
    expect(isCanteenMenusResponse(syntheticCanteenPayload)).toBe(true);
    // Aucun menu publié = tableau vide valide (onglet masqué, pas d'erreur).
    expect(isCanteenMenusResponse({ menus: [] })).toBe(true);
    expect(isCanteenMenusResponse({ menus: "non" })).toBe(false);
    expect(isCanteenMenusResponse({ menus: [{ id: "m" }] })).toBe(false);
    expect(isCanteenMenusResponse({ menus: [], balance: { balance: 1 } })).toBe(false);
  });

  test("cache : menus ressource cachable avec TTL propre", () => {
    expect(isCacheableResource("menus")).toBe(true);
    expect(CACHE_TTL_MS.menus).toBeGreaterThan(0);
    expect(cacheStatus("menus", 1_000, 1_000 + CACHE_TTL_MS.menus)).toBe("fresh");
    expect(cacheStatus("menus", 1_000, 1_000 + CACHE_TTL_MS.menus + 1)).toBe("stale");
  });
});

describe("PronoteClientReader.getMenus (#81)", () => {
  test("mapper : plats/allergènes bornés, repas déduits, Untrusted", async () => {
    const logs: string[] = [];
    const reader = await readerFor(canteenClient(), logs);
    const page = await reader.getMenus(syntheticAccountId, {
      from: "2026-10-05T00:00:00.000Z",
      to: "2026-10-07T00:00:00.000Z",
    });
    expect(page.items.__untrusted).toBe(true);
    expect(page.items.value.every(isCanteenMenu)).toBe(true);
    const [lunch, dinner, breakfast] = page.items.value;
    expect(lunch?.meal).toBe("lunch");
    expect(lunch?.dishes).toEqual(["Entrée", "Poulet rôti", "Haricots verts", "Compote"]);
    expect(lunch?.allergens).toEqual(["gluten"]);
    expect(dinner?.meal).toBe("dinner");
    expect(breakfast?.meal).toBe("breakfast");
    // Repas sans plat lisible et date absente : ignorés (aucun contenu inventé).
    expect(page.items.value).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
    expect(logs.join("\n")).not.toContain(syntheticPassword);
    expect(logs.join("\n")).not.toContain(syntheticUsername);
  });

  test("mapper : doublons, chaînes vides et libellés hors bornes retirés", async () => {
    const reader = await readerFor({
      menus: async () => [
        {
          id: "dup",
          date: new Date("2026-10-05T00:00:00.000Z"),
          isLunch: true,
          mainMeal: [
            { name: "Riz", labels: [] },
            { name: "Riz", labels: [{ name: "gluten" }, { name: "gluten" }] },
            { name: "   ", labels: [] },
            { name: null, labels: [] },
            { name: "y".repeat(500), labels: [] },
          ],
        },
      ],
    });
    const page = await reader.getMenus(syntheticAccountId, {
      from: "2026-10-05T00:00:00.000Z",
      to: "2026-10-05T23:59:59.000Z",
    });
    const [menu] = page.items.value;
    expect(menu?.dishes).toEqual(["Riz", "y".repeat(120)]);
    expect(menu?.allergens).toEqual(["gluten"]);
    expect(isCanteenMenu(menu)).toBe(true);
  });

  test("fenêtre : from/to respectées, pagination clampée 1..100", async () => {
    const reader = await readerFor(canteenClient());
    const jour = await reader.getMenus(syntheticAccountId, {
      from: "2026-10-05T00:00:00.000Z",
      to: "2026-10-05T23:59:59.000Z",
    });
    expect(jour.items.value.map((m) => m.meal)).toEqual(["lunch"]);
    const page1 = await reader.getMenus(syntheticAccountId, {
      from: "2026-10-05T00:00:00.000Z",
      to: "2026-10-07T00:00:00.000Z",
      limit: 1,
    });
    expect(page1.items.value).toHaveLength(1);
    expect(page1.nextCursor).toBe("1");
    const page2 = await reader.getMenus(syntheticAccountId, {
      from: "2026-10-05T00:00:00.000Z",
      to: "2026-10-07T00:00:00.000Z",
      limit: 1000,
      cursor: page1.nextCursor ?? undefined,
    });
    expect(page2.items.value).toHaveLength(2);
    expect(page2.nextCursor).toBeNull();
    // Bornes illisibles = erreur typée (comme getTimetable), pas de date devinée.
    for (const bad of [{ from: "pas-une-date" }, { to: "xxx" }]) {
      const err = await reader.getMenus(syntheticAccountId, bad).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PronoteReadError);
      expect((err as PronoteReadError).code).toBe("ent_unavailable");
    }
  });

  test("défensif : cantine absente/KO = page VIDE, pas d'erreur", async () => {
    const logs: string[] = [];
    // Module cantine non activé : la lib n'expose même pas menus().
    const noMenus = await readerFor({ periods: [] }, logs);
    const empty = await noMenus.getMenus(syntheticAccountId, { from: "2026-10-05T00:00:00.000Z", to: "2026-10-07T00:00:00.000Z" });
    expect(empty.items.__untrusted).toBe(true);
    expect(empty.items.value).toEqual([]);
    expect(empty.nextCursor).toBeNull();
    // Page présente mais en erreur réseau : vide + log, jamais de 500 côté API.
    const throwing = await readerFor(
      { menus: async () => { throw new Error("PageMenus indisponible"); } },
      logs,
    );
    const ko = await throwing.getMenus(syntheticAccountId, { from: "2026-10-05T00:00:00.000Z", to: "2026-10-07T00:00:00.000Z" });
    expect(ko.items.value).toEqual([]);
    expect(logs.join("\n")).toContain("menus -> indisponible");
    expect(logs.join("\n")).not.toContain(syntheticPassword);
    // Sans session : erreur de session classique, pas une page vide silencieuse.
    const cold = new PronoteClientReader({ sessions: fakeStore({}) });
    const err = await cold.getMenus("acc-inconnu").catch((e: unknown) => e);
    expect((err as PronoteReadError).code).toBe("session_expired");
    expect((await cold.getMenus("  ").catch((e: unknown) => e) as PronoteReadError).code).toBe("session_expired");
  });
});

describe("route GET /v1/menus (#81)", () => {
  test("store sans menu → tableau vide valide (état masqué, pas d'erreur)", async () => {
    const handler = createHandler(createMemoryStore());
    const res = await handler(new Request("http://127.0.0.1/v1/menus"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(isCanteenMenusResponse(body)).toBe(true);
    expect(body.menus).toEqual([]);
    expect(body.balance).toBeUndefined();
  });

  test("store seedé : menus + solde, fenêtre filtrée, bornes", async () => {
    const handler = createHandler(
      createMemoryStore({ canteenMenus: syntheticCanteenMenus, canteenBalance: syntheticCanteenBalance }),
    );
    const all = await handler(new Request("http://127.0.0.1/v1/menus"));
    const body = await all.json();
    expect(isCanteenMenusResponse(body)).toBe(true);
    expect(body.menus).toHaveLength(2);
    expect(body.balance).toEqual(syntheticCanteenBalance);

    const week = await handler(new Request("http://127.0.0.1/v1/menus?from=2026-10-05&to=2026-10-05T23:59:59.000Z"));
    expect(((await week.json()) as { menus: unknown[] }).menus).toHaveLength(1);

    // Fenêtre vide = aucun menu sur la période, pas une erreur.
    const outside = await handler(new Request("http://127.0.0.1/v1/menus?from=2027-01-01&to=2027-01-07"));
    expect(((await outside.json()) as { menus: unknown[] }).menus).toEqual([]);

    // Date illisible ou absurdement longue = 400, sans refléter l'input.
    for (const q of ["?from=pas-une-date", "?to=xxx", `?from=${"9".repeat(500)}`]) {
      const bad = await handler(new Request(`http://127.0.0.1/v1/menus${q}`));
      expect(bad.status).toBe(400);
      const err = await bad.json();
      expect(isApiErrorBody(err)).toBe(true);
      expect(JSON.stringify(err)).not.toContain("9".repeat(10));
    }
  });
});
