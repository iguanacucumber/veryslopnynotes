// Tests #79 actualités établissement : contrats, mapper défensif, route, SSE.
// Fixtures 100 % synthétiques (tests/unit/fixtures/news.ts), aucun réseau, aucun secret.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isNewsItem,
  NEWS_BODY_MAX_CHARS,
  NEWS_META_MAX_CHARS,
  NEWS_TITLE_MAX_CHARS,
} from "../../shared/contracts/models";
import { API_ROUTES, isNewsResponse } from "../../shared/contracts/api";
import { EVENT_TYPES, isContractEvent } from "../../shared/contracts/events";
import { CACHE_TTL_MS, cacheStatus, isCacheableResource } from "../../shared/contracts/cache";
import { CONTRACTS_VERSION } from "../../shared/contracts/models";
import { PronoteClientReader } from "../../server/integrations/pronote-client-reader";
import { PronoteReadError } from "../../server/domain/ports";
import { createMemoryStore } from "../../server/api/store";
import { createHandler } from "../../server/api/router";
import { pairedDevice } from "./fixtures/pairing";
import {
  syntheticInformation,
  syntheticNewsAccountId,
  syntheticNewsInjectionItem,
  syntheticNewsItem,
  syntheticNewsOk,
  syntheticNewsClient,
} from "./fixtures/news";

// Session injectée sans réseau (PronoteSessionStore non nécessaire ici).
function readerFor(client: unknown, logs: string[] = []) {
  return new PronoteClientReader({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sessions: { requireClient: () => client } as any,
    logger: (m) => logs.push(m),
  });
}

describe("unit news (#79)", () => {
  test("isNewsItem : champs requis, bornes de longueur, types des optionnels", () => {
    expect(isNewsItem(syntheticNewsItem)).toBe(true);
    expect(isNewsItem(syntheticNewsInjectionItem)).toBe(true);
    // Optionnels absents = acceptés (add-only, rien d'invéré).
    const minimal = {
      id: "n1",
      accountId: "acc1",
      title: "Conseil de classe",
      publishedAt: "2026-10-02T07:00:00.000Z",
    };
    expect(isNewsItem(minimal)).toBe(true);
    expect(isNewsItem({ ...minimal, body: undefined, category: undefined, author: undefined, read: undefined })).toBe(
      true,
    );
    // Rejets : champs absents/illisibles.
    expect(isNewsItem({ ...minimal, id: "  " })).toBe(false);
    expect(isNewsItem({ ...minimal, accountId: "" })).toBe(false);
    expect(isNewsItem({ ...minimal, title: "   " })).toBe(false);
    expect(isNewsItem({ ...minimal, title: undefined })).toBe(false);
    expect(isNewsItem({ ...minimal, publishedAt: "pas-une-date" })).toBe(false);
    expect(isNewsItem({ ...minimal, publishedAt: 17 })).toBe(false);
    // Bornes dures (contenu établissement Borné = donnée, pas de déferlant).
    expect(isNewsItem({ ...minimal, title: "t".repeat(NEWS_TITLE_MAX_CHARS) })).toBe(true);
    expect(isNewsItem({ ...minimal, title: "t".repeat(NEWS_TITLE_MAX_CHARS + 1) })).toBe(false);
    expect(isNewsItem({ ...minimal, body: "b".repeat(NEWS_BODY_MAX_CHARS) })).toBe(true);
    expect(isNewsItem({ ...minimal, body: "b".repeat(NEWS_BODY_MAX_CHARS + 1) })).toBe(false);
    expect(isNewsItem({ ...minimal, category: "c".repeat(NEWS_META_MAX_CHARS) })).toBe(true);
    expect(isNewsItem({ ...minimal, category: "c".repeat(NEWS_META_MAX_CHARS + 1) })).toBe(false);
    expect(isNewsItem({ ...minimal, author: 42 })).toBe(false);
    expect(isNewsItem({ ...minimal, read: "oui" })).toBe(false);
    expect(isNewsItem(null)).toBe(false);
    expect(isNewsItem([])).toBe(false);
  });

  test("isNewsResponse + route /v1/news enregistrée", () => {
    expect(isNewsResponse(syntheticNewsOk)).toBe(true);
    expect(isNewsResponse({ news: [] })).toBe(true);
    expect(isNewsResponse({ news: "non" })).toBe(false);
    expect(isNewsResponse({ news: [{ ...syntheticNewsItem, title: "  " }] })).toBe(false);
    expect(isNewsResponse({})).toBe(false);
    expect(API_ROUTES.find((r) => r.path === "/v1/news")).toEqual({ method: "GET", path: "/v1/news" });
    // Miroir OpenAPI (test contracts l'impose aussi).
    const raw = readFileSync(join(import.meta.dir, "..", "..", "shared/contracts/api.openapi.yaml"), "utf8");
    expect(raw).toContain("/v1/news");
    expect(raw).toContain("listNews");
    expect(raw).toContain("NewsItem:");
    expect(raw).toContain("NewsResponse:");
    expect(raw).toContain("NewsUpdated");
  });

  test("événement NewsUpdated : enveloppe valide, données invalides rejetées", () => {
    const at = "2026-10-02T07:00:00.000Z";
    expect(EVENT_TYPES).toContain("NewsUpdated");
    expect(isContractEvent({ v: CONTRACTS_VERSION, type: "NewsUpdated", at, data: { items: [syntheticNewsItem] } })).toBe(
      true,
    );
    expect(isContractEvent({ v: CONTRACTS_VERSION, type: "NewsUpdated", at, data: { items: [] } })).toBe(true);
    expect(isContractEvent({ v: CONTRACTS_VERSION, type: "NewsUpdated", at, data: { items: "non" } })).toBe(false);
    expect(
      isContractEvent({
        v: CONTRACTS_VERSION,
        type: "NewsUpdated",
        at,
        data: { items: [{ ...syntheticNewsItem, publishedAt: "hier" }] },
      }),
    ).toBe(false);
    expect(isContractEvent({ v: CONTRACTS_VERSION, type: "NewsUpdated", at, data: syntheticNewsItem })).toBe(false);
  });

  test("cache : news cachable hors-ligne, TTL = EDT (60 min)", () => {
    expect(isCacheableResource("news")).toBe(true);
    expect(isCacheableResource("actus")).toBe(false);
    const ttl = CACHE_TTL_MS.news;
    expect(ttl).toBe(CACHE_TTL_MS.timetable);
    expect(cacheStatus("news", 0, ttl)).toBe("fresh");
    expect(cacheStatus("news", 0, ttl + 1)).toBe("stale");
  });

  test("getNews : mappage défensif, corps bornés, Untrusted, pagination", async () => {
    const logs: string[] = [];
    const reader = readerFor(syntheticNewsClient(), logs);
    const page = await reader.getNews(syntheticNewsAccountId, { limit: 2 });
    expect(page.items.__untrusted).toBe(true);
    expect(page.nextCursor).toBe("2");
    expect(page.items.value).toHaveLength(2);
    expect(page.items.value.every(isNewsItem)).toBe(true);
    const [first, second] = page.items.value;
    expect(first?.id).toBe("n-fake-1");
    expect(first?.publishedAt).toBe("2026-10-02T07:00:00.000Z");
    expect(first?.category).toBe("Vie scolaire");
    expect(first?.author).toBe("Vie scolaire");
    expect(first?.read).toBe(false);
    // Titre absent + content() en échec : pas de corps, titre de repli, pas de crash.
    expect(second?.id).toBe("n-fake-2");
    expect(second?.title).toBe("Actualité");
    expect(second?.body).toBeUndefined();
    expect(second?.read).toBe(true);
    // Suite de page : l'entrée poubelle (null) retombe sur des valeurs sûres, sans crash.
    const next = await reader.getNews(syntheticNewsAccountId, { limit: 2, cursor: "2" });
    expect(next.nextCursor).toBeNull();
    expect(next.items.value).toHaveLength(1);
    expect(next.items.value.every(isNewsItem)).toBe(true);
    expect(next.items.value[0]?.id).toBe("news-2");
    expect(logs.join("\n")).not.toMatch(/fake-pw|sk-or-v1/);
  });

  test("getNews : textes hors bornes tronqués, dates illisibles bornées", async () => {
    const long = syntheticInformation({
      title: "t".repeat(500),
      body: "b".repeat(5000),
      category: "c".repeat(300),
      author: "a".repeat(300),
      creationDate: "pas-une-date",
    });
    const reader = readerFor({ periods: [], informationAndSurveys: async () => [long] });
    const page = await reader.getNews(syntheticNewsAccountId);
    const item = page.items.value[0];
    expect(item).toBeDefined();
    expect(isNewsItem(item)).toBe(true);
    expect(item?.title.length).toBe(NEWS_TITLE_MAX_CHARS);
    expect(item?.body?.length).toBe(NEWS_BODY_MAX_CHARS);
    expect(item?.category?.length).toBe(NEWS_META_MAX_CHARS);
    expect(item?.author?.length).toBe(NEWS_META_MAX_CHARS);
    // Date illisible = maintenant (ISO valide), jamais "NaN" ni chaîne brute.
    expect(item?.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Number.isNaN(Date.parse(item?.publishedAt ?? ""))).toBe(false);
  });

  test("getNews : onglet absent ou en erreur = page VIDE (pas d'exception)", async () => {
    for (const client of [syntheticNewsClient({ tab: false }), syntheticNewsClient({ fail: true })]) {
      const page = await readerFor(client).getNews(syntheticNewsAccountId);
      expect(page.items.value).toEqual([]);
      expect(page.nextCursor).toBeNull();
    }
    // Réponse non tableau = page vide aussi.
    const weird = await readerFor({ periods: [], informationAndSurveys: async () => ({ nope: 1 }) }).getNews(
      syntheticNewsAccountId,
    );
    expect(weird.items.value).toEqual([]);
  });

  test("getNews : session absente = erreur typée (re-auth nécessaire)", async () => {
    const reader = new PronoteClientReader({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sessions: {
        requireClient: () => {
          throw new Error("session expirée");
        },
      } as any,
    });
    const err = await reader.getNews("acc-inconnu").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PronoteReadError);
    expect((err as PronoteReadError).code).toBe("session_expired");
    const blank = await reader.getNews("  ").catch((e: unknown) => e);
    expect((blank as PronoteReadError).code).toBe("session_expired");
  });

  test("GET /v1/news : payload validé par le garde-fou, store sans actus = liste vide", async () => {
    const { pairing, auth } = pairedDevice();
    const handler = createHandler(createMemoryStore({ news: [syntheticNewsItem] }), pairing);
    const res = await handler(new Request("http://127.0.0.1/v1/news", { headers: auth }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(isNewsResponse(body)).toBe(true);
    expect(body.news).toEqual([syntheticNewsItem]);
    // Store sans news() (adaptateur non encore migré) : 200 + liste vide, pas 500.
    const bare = createMemoryStore();
    const bareHandler = createHandler({ ...bare, news: undefined }, pairing);
    const bareRes = await bareHandler(new Request("http://127.0.0.1/v1/news", { headers: auth }));
    expect(bareRes.status).toBe(200);
    expect(await bareRes.json()).toEqual({ news: [] });
    // Corps illisible = 500 typée (jamais de payload douteux).
    const broken = createHandler(
      {
        ...createMemoryStore(),
        news: () => [{ ...syntheticNewsItem, publishedAt: "hier" }] as never,
      },
      pairing,
    );
    const brokenRes = await broken(new Request("http://127.0.0.1/v1/news", { headers: auth }));
    expect(brokenRes.status).toBe(500);
    expect((await brokenRes.json() as { error: { code: string } }).error.code).toBe("internal");
    // Méthode refusée.
    const post = await handler(new Request("http://127.0.0.1/v1/news", { method: "POST", headers: auth }));
    expect(post.status).toBe(405);
  });

  // #76 : le snapshot SSE réémet aussi TimetableUpdated (type déjà contractuel,
  // pas de doublon) — d'où 3 enveloppes.
  test("SSE : snapshot SyncCompleted, NewsUpdated puis TimetableUpdated dans /v1/events", async () => {
    const { pairing, auth } = pairedDevice();
    const handler = createHandler(createMemoryStore({ news: [syntheticNewsInjectionItem] }), pairing);
    const res = await handler(new Request("http://127.0.0.1/v1/events", { headers: auth }));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    // Flux tenu ouvert : lecture jusqu'à 3 enveloppes puis annulation.
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let events: { type: string; data?: unknown }[] = [];
    for (let i = 0; i < 20 && events.length < 3; i++) {
      const { done, value } = await reader.read();
      if (value) buf += decoder.decode(value, { stream: true });
      events = [...buf.matchAll(/data: (\{.*\})\n\n/g)].map((m) => JSON.parse(m[1] as string));
      if (done) break;
    }
    await reader.cancel();
    expect(events.length).toBe(3);
    expect(events.every((e) => isContractEvent(e))).toBe(true);
    expect(events[0]?.type).toBe("SyncCompleted");
    const news = events.find((e) => e.type === "NewsUpdated");
    expect(news).toBeDefined();
    expect(news?.data).toEqual({ items: [syntheticNewsInjectionItem] });
    // I6 : le corps d'actu reste une donnée, aucun secret dans le flux.
    expect(buf).not.toMatch(/sk-or-v1-|OPENROUTER_API_KEY|MASTER_KEY|PRONOTE_PASSWORD/);
  });
});
