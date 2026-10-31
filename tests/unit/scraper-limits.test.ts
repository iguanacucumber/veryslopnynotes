// Le HTML récupéré est BORNÉ et sa lecture a un DÉLAI : `page.content()` lisait
// toute la page et n'avait aucune limite.
// Fakes synthétiques : `playwright` mocké, DNS injecté, `fetch` stubé.
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { createApp } from "../../server/infrastructure/http";
import {
  CONTENT_TIMEOUT_MS,
  MAX_HTML_BYTES,
  MAX_HTML_CHARS,
  ScrapeManualsError,
  scrapeManuals,
} from "../../server/infrastructure/manuals-scrape";
import type { HostResolver } from "../../server/infrastructure/ssrf";

const CONFIG = { platform: "editeur-fake" };
const PUBLIC_URL = "https://manuels.example.invalid/6e";
/** IP publique factice (aucune adresse réelle n'est contactée). */
const PUBLIC_IP = "93.184.216.34";

function fakeResolver(table: Record<string, readonly string[]>): HostResolver {
  return async (host: string) => {
    const found = table[host];
    if (!found) throw new Error(`ENOTFOUND ${host}`);
    return found;
  };
}

const PUBLIC_RESOLVER = fakeResolver({ "manuels.example.invalid": [PUBLIC_IP] });

interface FakeState {
  /** HTML rendu par la page ; `null` = la lecture ne finit JAMAIS. */
  html: string | null;
  /** true = la lecture ÉCHOUE (navigateur mort pendant la lecture). */
  contentFails: boolean;
  contentCalls: number;
  /** Borne demandée au navigateur (#525) : `null` = aucune lecture. */
  contentMax: number | null;
  /** En-têtes de la réponse (`content-length`, mesuré AVANT la lecture). */
  headers: Record<string, string>;
  browserClosed: boolean;
  contextClosed: boolean;
}

/** État neuf du faux navigateur (champs complets : le faux applique la borne). */
function fakeState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    html: "<html><body>texte</body></html>",
    contentFails: false,
    contentCalls: 0,
    contentMax: null,
    headers: {},
    browserClosed: false,
    contextClosed: false,
    ...overrides,
  };
}

let state: FakeState = fakeState();

let fetchSpy: { mockRestore: () => void } | null = null;

afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = null;
});

mock.module("playwright", () => ({
  chromium: {
    launch: async () => ({
      newContext: async () => ({
        newPage: async () => ({
          url: () => PUBLIC_URL,
          title: async () => "Titre factice",
          // La borne est appliquée DANS le navigateur : il ne matérialise jamais plus que `max`.
          evaluate: async (_fn: unknown, max: number) => {
            state.contentCalls += 1;
            state.contentMax = max;
            // `null` = la page streame sans jamais finir.
            if (state.html === null) return await new Promise<string>(() => {});
            if (state.contentFails) throw new Error("Target page, context or browser has been closed");
            return state.html.length > max ? state.html.slice(0, max + 1) : state.html;
          },
          route: async () => {},
          goto: async () => ({ status: () => 200, ok: () => true, headers: () => state.headers }),
        }),
        storageState: async () => {},
        close: async () => {
          state.contextClosed = true;
        },
      }),
      close: async () => {
        state.browserClosed = true;
      },
    }),
  },
}));

/** Stub du `fetch` global (chaîne de redirections) : aucun réseau réel. */
function stubFetch(): void {
  fetchSpy?.mockRestore();
  const spy = spyOn(globalThis, "fetch");
  spy.mockImplementation((() => Promise.resolve(new Response("ok", { status: 200 }))) as unknown as typeof fetch);
  fetchSpy = spy;
}

async function refusal(promise: Promise<unknown>): Promise<ScrapeManualsError> {
  try {
    await promise;
  } catch (err) {
    return err as ScrapeManualsError;
  }
  throw new Error("le scrape aurait dû être refusé");
}

describe("HTML scrapé borné (#422)", () => {
  test("une page factice VOLUMINEUSE est tronquée au plafond (avant le reparse)", async () => {
    stubFetch();
    state = fakeState({
      html: `<html><body>${"x".repeat(MAX_HTML_CHARS + 5_000)}<p>FIN</p></body></html>`,
    });
    const logs: string[] = [];
    const docs = await scrapeManuals(CONFIG, {
      startUrl: PUBLIC_URL,
      resolveHost: PUBLIC_RESOLVER,
      logger: (m) => logs.push(m),
    });
    // Le plafond est JOUÉ et dit dans le log : ni URL, ni credential.
    expect(state.contentCalls).toBe(1);
    expect(logs.join("\n")).toContain(`plafonne (${MAX_HTML_CHARS} caracteres`);
    // Le serveur n'explore pas 50 Mo : l'extrait vient du HTML tronqué.
    expect(docs).toHaveLength(1);
    expect(docs[0]?.excerpt.length).toBeLessThanOrEqual(4000);
  });

  test("le plafond s'applique AVANT le reparse : le contenu au-delà n'est jamais vu", async () => {
    stubFetch();
    // Tronqué, le commentaire n'est jamais fermé : preuve que le plafond passe AVANT cheerio.
    const page = (pad: number) => `<html><body><!--${"z".repeat(pad)}--><p>FIN</p></body></html>`;

    state = fakeState({ html: page(10) });
    const court = await scrapeManuals(CONFIG, { startUrl: PUBLIC_URL, resolveHost: PUBLIC_RESOLVER });
    expect(court).toHaveLength(1);
    expect(court[0]?.excerpt).toContain("FIN");

    state = fakeState({ html: page(MAX_HTML_CHARS) });
    const long = await scrapeManuals(CONFIG, { startUrl: PUBLIC_URL, resolveHost: PUBLIC_RESOLVER });
    expect(long).toHaveLength(0);
  });
});

// Le plafond protège l'ALLOCATION, pas seulement le REPARSE : il est demandé à la page.
describe("plafond appliqué AVANT la matérialisation (#525)", () => {
  test("la borne est demandée AU navigateur (la chaîne traversante est bornée)", async () => {
    stubFetch();
    state = fakeState({ html: "<html><body>texte</body></html>" });
    await scrapeManuals(CONFIG, { startUrl: PUBLIC_URL, resolveHost: PUBLIC_RESOLVER });
    // Le plafond est demandé À LA PAGE, jamais appliqué après coup sur une chaîne construite.
    expect(state.contentCalls).toBe(1);
    expect(state.contentMax).toBe(MAX_HTML_CHARS);
  });

  test("une page trop volumineuse est REFUSÉE SANS être lue", async () => {
    stubFetch();
    state = fakeState({
      html: "<html><body>texte</body></html>",
      headers: { "content-length": String(MAX_HTML_BYTES + 1) },
    });
    const err = await refusal(
      scrapeManuals(CONFIG, { startUrl: PUBLIC_URL, resolveHost: PUBLIC_RESOLVER }),
    );
    expect(err).toBeInstanceOf(ScrapeManualsError);
    expect(err.message).toContain("trop volumineuse");
    // La page n'a JAMAIS été lue : rien n'a été matérialisé, ni sérialisé.
    expect(state.contentCalls).toBe(0);
  });

  test("une réponse SANS content-length reste bornée par la lecture", async () => {
    stubFetch();
    state = fakeState({ html: "<html><body>texte</body></html>" });
    const docs = await scrapeManuals(CONFIG, { startUrl: PUBLIC_URL, resolveHost: PUBLIC_RESOLVER });
    // Taille inconnue : la lecture BORNÉE s'applique, la chaîne reste ≤ plafond.
    expect(docs).toHaveLength(1);
    expect(state.contentCalls).toBe(1);
    expect(state.contentMax).toBe(MAX_HTML_CHARS);
  });
});

describe("délai de lecture du HTML (#422)", () => {
  test("une page qui ne finit pas de streamer est coupée, le navigateur meurt", async () => {
    stubFetch();
    state = fakeState({ html: null });
    const err = await refusal(
      scrapeManuals(CONFIG, {
        startUrl: PUBLIC_URL,
        resolveHost: PUBLIC_RESOLVER,
        contentTimeoutMs: 50,
      }),
    );
    // Motif `timeout` : 504, pas 502 « scrape impossible ».
    expect(err).toBeInstanceOf(ScrapeManualsError);
    expect(err.reason).toBe("timeout");
    // Le délai coupe la LECTURE et ferme le navigateur.
    expect(state.browserClosed).toBe(true);
    expect(state.contextClosed).toBe(true);
  });

  test("le délai de lecture par défaut est plus court que le délai HTTP (30 s)", () => {
    expect(CONTENT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(CONTENT_TIMEOUT_MS).toBeLessThan(30_000);
  });

  test("navigateur mort pendant la lecture = échec de scrape (502), pas une panne du serveur", async () => {
    stubFetch();
    state = fakeState({ html: "<html><body>texte</body></html>", contentFails: true });
    const err = await refusal(scrapeManuals(CONFIG, { startUrl: PUBLIC_URL, resolveHost: PUBLIC_RESOLVER }));
    expect(err).toBeInstanceOf(ScrapeManualsError);
    // Motif `generic` => 502 « scrape impossible » (jamais 500 « unexpected »).
    expect(err.reason).toBe("generic");
    // Message FIXE : le message de Playwright peut contenir l'URL.
    expect(err.message).not.toContain("Target page");
  });

  test("HTTP : un refus `timeout` du scraper = 504 (jamais 502)", async () => {
    const app = createApp({
      scrape: async () => {
        throw new ScrapeManualsError("lecture du HTML trop longue (delai depasse)", "timeout");
      },
    });
    const res = await app.handler(
      new Request("http://127.0.0.1/v1/manuals/scrape", {
        method: "POST",
        body: JSON.stringify({
          platform: "editeur-fake",
          startUrl: PUBLIC_URL,
        }),
      }),
    );
    expect(res.status).toBe(504);
    expect((await res.json()) as unknown).toMatchObject({ error: { code: "timeout" } });
  });
});
