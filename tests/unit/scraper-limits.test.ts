// #422 : le HTML récupéré est BORNÉ et sa lecture a un DÉLAI.
// Avant : `page.content()` lisait TOUTE la page en mémoire (le reparse
// cheerio en fait plusieurs fois la taille : une page de 50 Mo = des
// centaines de Mo, x2 scrapes simultanés) et n'avait AUCUN délai — une page
// qui ne finit pas de streamer survit au délai de 30 s et garde le Chromium
// vivant.
//
// Fakes 100 % synthétiques : le module `playwright` est MOCKÉ (aucun
// navigateur), la résolution DNS est INJECTÉE et le `fetch` global (chaîne
// de redirections) est stubé : aucun réseau réel dans les tests.
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { createApp } from "../../server/infrastructure/http";
import {
  CONTENT_TIMEOUT_MS,
  MAX_HTML_CHARS,
  ScrapeManualsError,
  scrapeManuals,
} from "../../server/infrastructure/manuals-scrape";
import type { HostResolver } from "../../server/infrastructure/ssrf";

const CONFIG = { platform: "editeur-fake", username: "u", password: "p" };
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
  browserClosed: boolean;
  contextClosed: boolean;
}

let state: FakeState = {
  html: "<html><body>texte</body></html>",
  contentFails: false,
  contentCalls: 0,
  browserClosed: false,
  contextClosed: false,
};

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
          content: async () => {
            state.contentCalls += 1;
            // `null` = la page streame sans jamais finir.
            if (state.html === null) return await new Promise<string>(() => {});
            if (state.contentFails) throw new Error("Target page, context or browser has been closed");
            return state.html;
          },
          route: async () => {},
          goto: async () => ({ status: () => 200, ok: () => true }),
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
    state = {
      html: `<html><body>${"x".repeat(MAX_HTML_CHARS + 5_000)}<p>FIN</p></body></html>`,
      contentFails: false,
      contentCalls: 0,
      browserClosed: false,
      contextClosed: false,
    };
    const logs: string[] = [];
    const docs = await scrapeManuals(CONFIG, {
      startUrl: PUBLIC_URL,
      resolveHost: PUBLIC_RESOLVER,
      logger: (m) => logs.push(m),
    });
    // La page est rendue, le plafond est JOUGÉ (et dit dans le log : ni URL,
    // ni credential, seulement un compte).
    expect(state.contentCalls).toBe(1);
    expect(logs.join("\n")).toContain(`plafonne (${MAX_HTML_CHARS} caracteres`);
    // Le serveur n'explore pas 50 Mo : l'extrait vient du HTML tronqué.
    expect(docs).toHaveLength(1);
    expect(docs[0]?.excerpt.length).toBeLessThanOrEqual(4000);
  });

  test("le plafond s'applique AVANT le reparse : le contenu au-delà n'est jamais vu", async () => {
    stubFetch();
    // La page place son texte APRÈS un gros commentaire. Tronquée au
    // plafond, le commentaire n'est jamais fermé : le reparse ne voit QUE le
    // HTML tronqué, donc aucun texte. Sans plafond, le MÊME HTML donnerait
    // « FIN » — c'est ce qui prouve l'ordre (plafond AVANT cheerio).
    const page = (pad: number) => `<html><body><!--${"z".repeat(pad)}--><p>FIN</p></body></html>`;

    state = { html: page(10), contentFails: false, contentCalls: 0, browserClosed: false, contextClosed: false };
    const court = await scrapeManuals(CONFIG, { startUrl: PUBLIC_URL, resolveHost: PUBLIC_RESOLVER });
    expect(court).toHaveLength(1);
    expect(court[0]?.excerpt).toContain("FIN");

    state = {
      html: page(MAX_HTML_CHARS),
      contentFails: false,
      contentCalls: 0,
      browserClosed: false,
      contextClosed: false,
    };
    const long = await scrapeManuals(CONFIG, { startUrl: PUBLIC_URL, resolveHost: PUBLIC_RESOLVER });
    expect(long).toHaveLength(0);
  });
});

describe("délai de lecture du HTML (#422)", () => {
  test("une page qui ne finit pas de streamer est coupée, le navigateur meurt", async () => {
    stubFetch();
    state = { html: null, contentFails: false, contentCalls: 0, browserClosed: false, contextClosed: false };
    const err = await refusal(
      scrapeManuals(CONFIG, {
        startUrl: PUBLIC_URL,
        resolveHost: PUBLIC_RESOLVER,
        contentTimeoutMs: 50,
      }),
    );
    // Motif `timeout` : le handler HTTP en fait un 504 (pas un 502 « scrape
    // impossible » qui ferait croire à une panne du portail).
    expect(err).toBeInstanceOf(ScrapeManualsError);
    expect(err.reason).toBe("timeout");
    // Le délai coupe la LECTURE, pas seulement la promesse : le navigateur
    // est fermé (pas de Chromium fantôme).
    expect(state.browserClosed).toBe(true);
    expect(state.contextClosed).toBe(true);
  });

  test("le délai de lecture par défaut est plus court que le délai HTTP (30 s)", () => {
    expect(CONTENT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(CONTENT_TIMEOUT_MS).toBeLessThan(30_000);
  });

  test("navigateur mort pendant la lecture = échec de scrape (502), pas une panne du serveur", async () => {
    stubFetch();
    state = {
      html: "<html><body>texte</body></html>",
      contentFails: true,
      contentCalls: 0,
      browserClosed: false,
      contextClosed: false,
    };
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
          username: "u",
          password: "p",
          startUrl: PUBLIC_URL,
        }),
      }),
    );
    expect(res.status).toBe(504);
    expect((await res.json()) as unknown).toMatchObject({ error: { code: "timeout" } });
  });
});
