// e2e actualités établissement #79 (parité Papillon, onglet Actualités).
// Zéro réseau réel, zéro .env.local : store seed + createHandler en mémoire.
// Couvre le parcours complet : store -> GET /v1/news -> garde-fou -> miroir app
// (parse + vide propre) -> SSE NewsUpdated -> repli cache hors-ligne.
import { describe, expect, test } from "bun:test";
import { isNewsResponse } from "../../shared/contracts/api";
import { isContractEvent } from "../../shared/contracts/events";
import { CACHE_TTL_MS, cacheStatus } from "../../shared/contracts/cache";
import { isNewsItem } from "../../shared/contracts/models";
import { createMemoryStore } from "../../server/api/store";
import { createHandler } from "../../server/api/router";
import { syntheticNewsInjectionItem, syntheticNewsItem } from "../unit/fixtures/news";

// Miroir du parse app (android/data/NewsRepository.kt) : org.json → items valides.
function parseApp(payload: string | null): { id: string; title: string; body: string; read: boolean }[] {
  try {
    if (payload === null) return [];
    const root = JSON.parse(payload) as { news?: unknown };
    if (!Array.isArray(root.news)) return [];
    return root.news.flatMap((o) => {
      if (typeof o !== "object" || o === null) return [];
      const r = o as Record<string, unknown>;
      const id = typeof r["id"] === "string" ? r["id"] : "";
      const title = typeof r["title"] === "string" ? r["title"] : "";
      if (id.trim() === "" || title.trim() === "") return [];
      return [{ id, title, body: typeof r["body"] === "string" ? r["body"] : "", read: r["read"] === true }];
    });
  } catch {
    return [];
  }
}

const NEWS = [syntheticNewsItem, syntheticNewsInjectionItem];

describe("e2e news", () => {
  test("GET /v1/news : seed -> payload contractuel -> listé par l'app", async () => {
    const handler = createHandler(createMemoryStore({ news: NEWS }));
    const res = await handler(new Request("http://127.0.0.1/v1/news"));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(isNewsResponse(JSON.parse(body))).toBe(true);
    const app = parseApp(body);
    expect(app.length).toBe(2);
    expect(app[0]?.id).toBe(syntheticNewsItem.id);
    expect(app[0]?.title).toBe(syntheticNewsItem.title);
    expect(app[0]?.read).toBe(false);
    expect(app[1]?.read).toBe(true);
    // I6 : corps d'actu = donnée affichée, jamais de secret dans la réponse.
    expect(body).not.toMatch(/sk-or-v1-|OPENROUTER_API_KEY|MASTER_KEY|PRONOTE_PASSWORD/);
    // I6 : le corps d'injection est conservé tel quel, l'app ne l'exécute pas.
    expect(app[1]?.body).toBe(syntheticNewsInjectionItem.body);
  });

  test("établissement sans onglet actualités : 200 + vide propre, jamais 500", async () => {
    const handler = createHandler(createMemoryStore({ news: [] }));
    const res = await handler(new Request("http://127.0.0.1/v1/news"));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(isNewsResponse(JSON.parse(body))).toBe(true);
    expect(parseApp(body)).toEqual([]);
    // Cache vide = état UI "Aucune actualité", pas de boucle d'acquittement.
    expect(parseApp(JSON.stringify({ news: [] }))).toEqual([]);
    expect(parseApp("pas-du-json")).toEqual([]);
    expect(parseApp(null)).toEqual([]);
  });

  test("SSE NewsUpdated : snapshot valide, l'app peut recharger /v1/news", async () => {
    const handler = createHandler(createMemoryStore({ news: NEWS }));
    const res = await handler(new Request("http://127.0.0.1/v1/events"));
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let types: string[] = [];
    for (let i = 0; i < 20 && types.length < 3; i++) {
      const { done, value } = await reader.read();
      if (value) buf += decoder.decode(value, { stream: true });
      types = [...buf.matchAll(/data: (\{.*\})\n\n/g)].map((m) => JSON.parse(m[1] as string).type);
      if (done) break;
    }
    await reader.cancel();
    // #76 : TimetableUpdated réémis dans le même snapshot (type déjà contractuel).
    expect(types).toEqual(["SyncCompleted", "NewsUpdated", "TimetableUpdated"]);
    const newsEvent = [...buf.matchAll(/data: (\{.*\})\n\n/g)]
      .map((m) => JSON.parse(m[1] as string))
      .find((e) => e.type === "NewsUpdated");
    expect(isContractEvent(newsEvent)).toBe(true);
    const items = (newsEvent?.data as { items: unknown[] }).items;
    expect(items.every(isNewsItem)).toBe(true);
    expect(items.length).toBe(2);
  });

  test("hors-ligne : cache news périmé = repli, badge stale, pas d'écran vide", async () => {
    // Le cache serveur garde le dernier payload valide (miroir SyncedRepository).
    const handler = createHandler(createMemoryStore({ news: NEWS }));
    const fetched = await (await handler(new Request("http://127.0.0.1/v1/news"))).text();
    const now = 1_000_000;
    // Réseau OK : cache réécrit, badge frais.
    expect(cacheStatus("news", now, now + CACHE_TTL_MS.news)).toBe("fresh");
    expect(parseApp(fetched).length).toBe(2);
    // Réseau KO : repli sur le cache, affiché même périmé (stale = bandeau).
    const stale = cacheStatus("news", now, now + CACHE_TTL_MS.news + 1);
    expect(stale).toBe("stale");
    expect(parseApp(fetched).length).toBe(2);
    // Cache absent + réseau KO : état vide propre, jamais de spinner infini.
    expect(parseApp(null)).toEqual([]);
  });
});
