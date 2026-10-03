import { describe, expect, test } from "bun:test";
import { createHandler } from "../../server/api/router";
import { createMemoryStore } from "../../server/api/store";
import { isApiErrorBody } from "../../server/api/errors";
import { isCanteenMenusResponse } from "../../shared/contracts/api";
import { isCanteenMenu } from "../../shared/contracts/models";
import { CACHE_TTL_MS, cacheStatus } from "../../shared/contracts/cache";
import { PronoteClientReader } from "../../server/integrations/pronote-client-reader";
import { PronoteSessionStore } from "../../server/integrations/pronote-sessions";
import type { Untrusted } from "../../server/domain/ports";
import type { CanteenMenu } from "../../shared/contracts/models";
import {
  syntheticCanteenBalance,
  syntheticCanteenMenus,
  syntheticRawMenus,
} from "../unit/fixtures/canteen";
import { syntheticAccountId, syntheticEntKind, syntheticPassword, syntheticUsername } from "../unit/fixtures/pronote";

// e2e cantine (#81) : store seedé -> GET /v1/menus -> rendu semaine.
// Zéro réseau (store mémoire + client Pronote injecté), zéro secret,
// aucun LLM sur le chemin (données structurées seules, I7).

const creds = {
  accountId: syntheticAccountId,
  username: syntheticUsername,
  password: syntheticPassword,
  entKind: syntheticEntKind,
};

async function getMenusJson(query = "") {
  const handler = createHandler(
    createMemoryStore({ canteenMenus: syntheticCanteenMenus, canteenBalance: syntheticCanteenBalance }),
  );
  const res = await handler(new Request(`http://127.0.0.1/v1/menus${query}`));
  return { res, body: await res.json() };
}

describe("e2e cantine (#81)", () => {
  test("semaine publiée : menus groupés par jour + solde, contrats valides", async () => {
    const { res, body } = await getMenusJson();
    expect(res.status).toBe(200);
    expect(isCanteenMenusResponse(body)).toBe(true);
    expect(body.menus).toHaveLength(2);
    expect(body.menus.every(isCanteenMenu)).toBe(true);
    const jours = [...new Set(body.menus.map((m: CanteenMenu) => m.date))];
    expect(jours).toEqual(["2026-10-05T00:00:00.000Z", "2026-10-06T00:00:00.000Z"]);
    expect(body.balance).toEqual(syntheticCanteenBalance);
    // Le solde vient du compte cantine : aucun secret dans la réponse.
    expect(JSON.stringify(body)).not.toMatch(/sk-or-v1-|OPENROUTER_API_KEY|PRONOTE_PASSWORD/);
  });

  test("fenêtre from/to : un seul jour, puis fenêtre vide (jamais d'erreur)", async () => {
    const jour = await getMenusJson("?from=2026-10-06T00:00:00.000Z&to=2026-10-06T23:59:59.999Z");
    expect(jour.res.status).toBe(200);
    expect(isCanteenMenusResponse(jour.body)).toBe(true);
    expect(jour.body.menus.map((m: CanteenMenu) => m.meal)).toEqual(["dinner"]);
    const vide = await getMenusJson("?from=2026-11-02&to=2026-11-08");
    expect(vide.res.status).toBe(200);
    expect(isCanteenMenusResponse(vide.body)).toBe(true);
    expect(vide.body.menus).toEqual([]);
    const casse = await getMenusJson("?from=lundi");
    expect(casse.res.status).toBe(400);
    expect(isApiErrorBody(casse.body)).toBe(true);
  });

  test("établissement sans module cantine : réponse vide propre, onglet masqué", async () => {
    const handler = createHandler(createMemoryStore());
    const res = await handler(new Request("http://127.0.0.1/v1/menus"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(isCanteenMenusResponse(body)).toBe(true);
    expect(body.menus).toEqual([]);
    expect(body.balance).toBeUndefined();
    // Cache de la ressource : vide = rien à afficher, pas de badge d'erreur.
    expect(cacheStatus("menus", 0, CACHE_TTL_MS.menus)).toBe("fresh");
  });

  test("reader : page non fiable bornée, Untrusted, aucune fuite de session", async () => {
    const logs: string[] = [];
    const sessions = new PronoteSessionStore({
      pronoteUrl: "https://example.test/pronote/eleve.html",
      clientFactory: (async () => ({ menus: async () => syntheticRawMenus() })) as never,
    });
    await sessions.authenticate({ ...creds, entKind: "ninegate" });
    const reader = new PronoteClientReader({ sessions, logger: (m) => logs.push(m) });
    const page = await reader.getMenus(syntheticAccountId, {
      from: "2026-10-05T00:00:00.000Z",
      to: "2026-10-07T00:00:00.000Z",
    });
    const items: Untrusted<CanteenMenu[]> = page.items;
    expect(items.__untrusted).toBe(true);
    expect(items.value.every(isCanteenMenu)).toBe(true);
    expect(items.value.map((m) => m.meal)).toEqual(["lunch", "dinner", "breakfast"]);
    const joined = logs.join("\n");
    expect(joined).not.toContain(syntheticPassword);
    expect(joined).not.toContain(syntheticUsername);
  });
});
