// Une page web choisie par l'élève devient une source citée bornée. Même moteur
// que le manuel (garde SSRF, plafond de concurrence), sauf : pas de jar de
// session, contenu non textuel refusé, userinfo refusé.
// Fakes synthétiques : Playwright mocké, DNS injecté, `fetch` stubé.
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { createApp } from "../../server/infrastructure/http";
import { MAX_HTML_BYTES, ScrapeManualsError } from "../../server/infrastructure/manuals-scrape";
import { scrapeWebPage } from "../../server/infrastructure/web-scrape";
import type { HostResolver } from "../../server/infrastructure/ssrf";
import { isWebScrapeRequest } from "../../shared/contracts/api";
import { isPublicPageUrl } from "../../shared/contracts/net";

const PUBLIC_URL = "https://page.example.invalid/article";
const PUBLIC_IP = "93.184.216.34";

function fakeResolver(table: Record<string, readonly string[]>): HostResolver {
  return async (host: string) => {
    const found = table[host];
    if (!found) throw new Error(`ENOTFOUND ${host}`);
    return found;
  };
}

const PUBLIC_RESOLVER = fakeResolver({ "page.example.invalid": [PUBLIC_IP] });

interface FakeState {
  launched: number;
  contentCalls: number;
  storageStateCalls: number;
  storageStatePaths: string[];
  routeCalls: number;
  headers: Record<string, string>;
  /** `null` = la page ne finit jamais de streamer (délai de lecture). */
  html: string | null;
  finalUrl: string;
  title: string;
}

function fakeState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    launched: 0,
    contentCalls: 0,
    storageStateCalls: 0,
    storageStatePaths: [],
    routeCalls: 0,
    headers: { "content-type": "text/html; charset=utf-8" },
    html: "<html><body><h1>Article</h1><p>Texte lisible.</p></body></html>",
    finalUrl: PUBLIC_URL,
    title: "  Titre de la page  ",
    ...overrides,
  };
}

let state: FakeState = fakeState();
let fetchSpy: { mockRestore: () => void } | null = null;

mock.module("playwright", () => ({
  chromium: {
    launch: async () => {
      state.launched += 1;
      return {
        newContext: async (options?: { storageState?: string }) => {
          if (options?.storageState) {
            state.storageStatePaths.push(options.storageState);
          }
          return {
            newPage: async () => ({
              url: () => state.finalUrl,
              title: async () => state.title,
              evaluate: async (_fn: unknown, max: number) => {
                state.contentCalls += 1;
                if (state.html === null) return await new Promise<string>(() => {});
                return state.html.length > max ? state.html.slice(0, max + 1) : state.html;
              },
              route: async () => {
                state.routeCalls += 1;
              },
              goto: async () => ({ status: () => 200, ok: () => true, headers: () => state.headers }),
            }),
            storageState: async (options?: { path?: string }) => {
              state.storageStateCalls += 1;
              if (options?.path) state.storageStatePaths.push(options.path);
            },
            close: async () => {},
          };
        },
        close: async () => {},
      };
    },
  },
}));

function stubFetch(handler?: (url: string) => Response): void {
  fetchSpy?.mockRestore();
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return handler ? handler(url) : new Response("ok", { status: 200 });
  }) as unknown as typeof fetch);
}

afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = null;
  state = fakeState();
});

async function refusal(promise: Promise<unknown>): Promise<ScrapeManualsError> {
  try {
    await promise;
  } catch (err) {
    return err as ScrapeManualsError;
  }
  throw new Error("le scrape aurait dû être refusé");
}

describe("page web : garde SSRF (#634)", () => {
  test("localhost, IP privée, link-local/metadata et rebinding DNS sont refusés AVANT le navigateur", async () => {
    const cases: readonly { url: string; resolve: HostResolver }[] = [
      { url: "http://127.0.0.1/page", resolve: PUBLIC_RESOLVER },
      { url: "http://10.0.0.8/page", resolve: PUBLIC_RESOLVER },
      { url: "http://169.254.169.254/latest/meta-data/", resolve: PUBLIC_RESOLVER },
      {
        url: "https://rebind.example.invalid/page",
        resolve: fakeResolver({ "rebind.example.invalid": [PUBLIC_IP, "10.0.0.5"] }),
      },
    ];
    for (const { url, resolve } of cases) {
      const err = await refusal(
        scrapeWebPage({ startUrl: url, resolveHost: resolve }),
      );
      expect(err).toBeInstanceOf(ScrapeManualsError);
      expect(err.reason).toBe("private_host");
    }
    expect(state.launched).toBe(0);
    expect(state.contentCalls).toBe(0);
  });

  test("une redirection hors allowlist est refusée avant la navigation", async () => {
    stubFetch((url) =>
      url.startsWith(PUBLIC_URL)
        ? new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } })
        : new Response("ok", { status: 200 }),
    );
    const err = await refusal(
      scrapeWebPage({ startUrl: PUBLIC_URL, resolveHost: PUBLIC_RESOLVER }),
    );
    expect(err.reason).toBe("private_host");
    expect(state.launched).toBe(0);
  });

  test("le contrat refuse aussi une URL avec identifiants ou schéma non http", () => {
    expect(isWebScrapeRequest({ url: PUBLIC_URL })).toBe(true);
    expect(isWebScrapeRequest({ url: "https://user:pass@page.example.invalid/a" })).toBe(false);
    expect(isWebScrapeRequest({ url: "ftp://page.example.invalid/a" })).toBe(false);
    expect(isWebScrapeRequest({ url: "http://127.0.0.1/a" })).toBe(false);
    expect(isWebScrapeRequest({ url: "https://page.example.invalid/" + "x".repeat(2100) })).toBe(false);
    expect(isPublicPageUrl(PUBLIC_URL)).toBe(true);
  });
});

describe("page web : contenu et session (#634)", () => {
  test("aucun jar de session n'est monté ni persisté (aucun cookie de l'élève)", async () => {
    stubFetch();
    const docs = await scrapeWebPage({
      startUrl: PUBLIC_URL,
      resolveHost: PUBLIC_RESOLVER,
      defaultAuthFile: "/tmp/jar-qui-ne-doit-pas-etre-monte.json",
    });
    expect(docs).toHaveLength(1);
    expect(docs[0]?.title).toBe("Titre de la page");
    expect(docs[0]?.excerpt).toContain("Texte lisible");
    expect(state.launched).toBe(1);
    expect(state.storageStateCalls).toBe(0);
    expect(state.storageStatePaths).toEqual([]);
  });

  test("un contenu non textuel est refusé (motif not_text)", async () => {
    stubFetch();
    state = fakeState({ headers: { "content-type": "application/pdf" } });
    const err = await refusal(
      scrapeWebPage({ startUrl: PUBLIC_URL, resolveHost: PUBLIC_RESOLVER }),
    );
    expect(err.reason).toBe("not_text");
    expect(state.contentCalls).toBe(0);
  });

  test("une page trop volumineuse est refusée SANS lecture (motif too_large)", async () => {
    stubFetch();
    state = fakeState({
      headers: {
        "content-type": "text/html",
        "content-length": String(MAX_HTML_BYTES + 1),
      },
    });
    const err = await refusal(
      scrapeWebPage({ startUrl: PUBLIC_URL, resolveHost: PUBLIC_RESOLVER }),
    );
    expect(err.reason).toBe("too_large");
    expect(state.contentCalls).toBe(0);
  });

  test("une page qui ne finit pas de streamer est refusée au délai de lecture", async () => {
    stubFetch();
    state = fakeState({ html: null });
    const err = await refusal(
      scrapeWebPage({
        startUrl: PUBLIC_URL,
        resolveHost: PUBLIC_RESOLVER,
        contentTimeoutMs: 20,
      }),
    );
    expect(err.reason).toBe("timeout");
  });

  test("un titre qui est une URL ne devient pas un libellé citable", async () => {
    stubFetch();
    state = fakeState({ title: PUBLIC_URL });
    const docs = await scrapeWebPage({ startUrl: PUBLIC_URL, resolveHost: PUBLIC_RESOLVER });
    expect(docs[0]?.title).toBe("Page web");
    expect(JSON.stringify(docs)).not.toContain(PUBLIC_URL);
  });

  test("une page sans texte lisible ne produit aucune source", async () => {
    stubFetch();
    state = fakeState({ html: "<html><body><script>x()</script></body></html>" });
    expect(await scrapeWebPage({ startUrl: PUBLIC_URL, resolveHost: PUBLIC_RESOLVER })).toEqual([]);
  });
});

describe("page web : route HTTP (#634)", () => {
  test("POST /v1/web/scrape valide le corps et rend titre + texte", async () => {
    const calls: unknown[] = [];
    const app = createApp({
      scrapeWeb: async (opts) => {
        calls.push(opts);
        return [{ title: "Titre", excerpt: "Texte" }];
      },
    });
    const res = await app.handler(
      new Request("http://127.0.0.1/v1/web/scrape", {
        method: "POST",
        body: JSON.stringify({ url: PUBLIC_URL }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ docs: [{ title: "Titre", excerpt: "Texte" }] });
    expect(calls).toHaveLength(1);
  });

  test("un corps hors contrat est refusé avant tout scrape", async () => {
    let called = 0;
    const app = createApp({
      scrapeWeb: async () => {
        called += 1;
        return [];
      },
    });
    for (const body of [
      {},
      { url: "ftp://page.example.invalid/a" },
      { url: "https://user:pass@page.example.invalid/a" },
      { url: "http://127.0.0.1/a" },
    ]) {
      const res = await app.handler(
        new Request("http://127.0.0.1/v1/web/scrape", { method: "POST", body: JSON.stringify(body) }),
      );
      expect(res.status).toBe(400);
    }
    expect(called).toBe(0);
  });

  test("le refus SSRF de la route est explicite (403), jamais une page inventée", async () => {
    const app = createApp({
      scrapeWeb: async () => {
        throw new ScrapeManualsError("prive", "private_host");
      },
    });
    const res = await app.handler(
      new Request("http://127.0.0.1/v1/web/scrape", {
        method: "POST",
        body: JSON.stringify({ url: PUBLIC_URL }),
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()) as unknown).toMatchObject({ error: { code: "private_host" } });
  });

  test("les motifs contenu non textuel et page trop grande ont leur code HTTP", async () => {
    for (const [reason, status, code] of [
      ["not_text", 415, "not_text"],
      ["too_large", 413, "too_large"],
      ["timeout", 504, "timeout"],
    ] as const) {
      const app = createApp({
        scrapeWeb: async () => {
          throw new ScrapeManualsError("refus", reason);
        },
      });
      const res = await app.handler(
        new Request("http://127.0.0.1/v1/web/scrape", {
          method: "POST",
          body: JSON.stringify({ url: PUBLIC_URL }),
        }),
      );
      expect(res.status).toBe(status);
      expect((await res.json()) as unknown).toMatchObject({ error: { code } });
    }
  });
});
