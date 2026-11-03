// Le sommaire est récupéré par le serveur AVANT Chromium : redirections suivies
// à la main (chaque saut validé), corps lu en flux et borné, annulation
// combinée au délai, et slot de concurrence tenu jusqu'à la fin réelle.
// Fakes synthétiques : DNS injecté, `fetch` stubé, aucun réseau ni navigateur.
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createApp } from "../../server/infrastructure/http";
import {
  MAX_HTML_BYTES,
  ScrapeManualsError,
  scrapeManuals,
} from "../../server/infrastructure/manuals-scrape";
import type { HostResolver } from "../../server/infrastructure/ssrf";

const CONFIG = { platform: "editeur-fake" };
const PUBLIC_URL = "https://manuels.example.invalid/manuels/maths";
const PRIVATE_URL = "http://169.254.169.254/latest/meta-data/";
const PUBLIC_IP = "93.184.216.34";

function fakeResolver(table: Record<string, readonly string[]>): HostResolver {
  return async (host: string) => {
    const found = table[host];
    if (!found) throw new Error(`ENOTFOUND ${host}`);
    return found;
  };
}

const PUBLIC_RESOLVER = fakeResolver({ "manuels.example.invalid": [PUBLIC_IP] });

type FetchInit = { readonly redirect?: string; readonly signal?: AbortSignal };
let fetchSpy: { mockRestore: () => void } | null = null;

function stubFetch(
  handler: (url: string, init: FetchInit | undefined) => Response | Promise<Response>,
): void {
  fetchSpy?.mockRestore();
  const spy = spyOn(globalThis, "fetch");
  spy.mockImplementation((async (input: unknown, init?: FetchInit): Promise<Response> =>
    await handler(
      typeof input === "string" ? input : String((input as { url?: string })?.url ?? ""),
      init,
    )) as unknown as typeof fetch);
  fetchSpy = spy;
}

afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = null;
});

async function refusal(promise: Promise<unknown>): Promise<ScrapeManualsError> {
  try {
    await promise;
  } catch (err) {
    return err as ScrapeManualsError;
  }
  throw new Error("le scrape aurait dû être refusé");
}

/** Attend qu'une condition devienne vraie (aucune horloge réelle longue). */
async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("condition non atteinte");
}

describe("sommaire : redirections suivies à la main", () => {
  test("une redirection vers une cible privée est refusée SANS être fetchée", async () => {
    const seen: string[] = [];
    const inits: FetchInit[] = [];
    stubFetch((url, init) => {
      seen.push(url);
      if (init) inits.push(init);
      return new Response(null, { status: 302, headers: { location: PRIVATE_URL } });
    });

    const err = await refusal(
      scrapeManuals(CONFIG, { startUrl: PUBLIC_URL, page: 192, resolveHost: PUBLIC_RESOLVER }),
    );
    expect(err.reason).toBe("private_host");
    // Le saut privé n'est jamais contacté : la validation précède le fetch.
    expect(seen).toEqual([PUBLIC_URL]);
    // Le client HTTP ne suit jamais tout seul (`redirect: "follow"`).
    expect(inits.every((init) => init.redirect === "manual")).toBe(true);
  });

  test("une chaîne plus longue que le plafond de Chromium est refusée", async () => {
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      return new Response(null, {
        status: 302,
        headers: { location: `https://manuels.example.invalid/hop/${calls}` },
      });
    });

    const err = await refusal(
      scrapeManuals(CONFIG, { startUrl: PUBLIC_URL, page: 192, resolveHost: PUBLIC_RESOLVER }),
    );
    expect(err.reason).toBe("private_host");
    // 20 sauts autorisés (comme Chromium), le 21e refuse au lieu d'aller à l'aveugle.
    expect(calls).toBe(21);
  });
});

describe("sommaire : corps lu en flux et borné", () => {
  test("un corps chunked sans content-length est coupé au plafond, pas bufferisé", async () => {
    const chunk = new Uint8Array(64 * 1024);
    const totalChunks = 200; // ~12,5 Mio : bien au-delà du plafond
    let pulled = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= totalChunks) {
          controller.close();
          return;
        }
        pulled += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    stubFetch(() => new Response(stream, { status: 200 }));

    const err = await refusal(
      scrapeManuals(CONFIG, { startUrl: PUBLIC_URL, page: 192, resolveHost: PUBLIC_RESOLVER }),
    );
    expect(err.reason).toBe("too_large");
    // La lecture s'arrête au plafond : le flux n'est pas vidé jusqu'au bout.
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(totalChunks);
    expect(pulled).toBeLessThanOrEqual(Math.ceil(MAX_HTML_BYTES / chunk.byteLength) + 1);
  });
});

describe("sommaire : annulation combinée au délai", () => {
  test("le signal de l'appelant annule le fetch du sommaire (AbortSignal.any)", async () => {
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let seenSignal: AbortSignal | undefined;
    stubFetch((_url, init) => {
      seenSignal = init?.signal;
      markStarted();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    });

    const controller = new AbortController();
    const pending = scrapeManuals(
      CONFIG,
      { startUrl: PUBLIC_URL, page: 192, resolveHost: PUBLIC_RESOLVER, signal: controller.signal },
    );
    const err = refusal(pending);
    await started;
    expect(seenSignal).toBeDefined();
    expect(seenSignal?.aborted).toBe(false);
    controller.abort();
    expect((await err).reason).toBe("generic");
    expect(seenSignal?.aborted).toBe(true);
  });
});

const FAKE_DOC = {
  id: "scrape-1",
  platform: CONFIG.platform,
  title: "Titre factice",
  subject: "Matiere factice",
  page: 1,
  excerpt: "Extrait factice.",
};

function post(body: unknown): Request {
  return new Request("http://127.0.0.1/v1/manuals/scrape", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const BODY = { platform: CONFIG.platform, startUrl: PUBLIC_URL, page: 192 };

describe("slot de concurrence tenu jusqu'à la fin réelle", () => {
  test("timeout : la réponse part, le slot reste tenu tant que le scrape court", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const app = createApp({
      timeoutMs: 20,
      // Ignore l'annulation : simule un Chromium qui met du temps à mourir.
      scrape: async () => {
        await gate;
        return [FAKE_DOC];
      },
    });

    const res = await app.handler(post(BODY));
    expect(res.status).toBe(504);
    // Le scrape n'a PAS fini : le slot n'est pas rendu, aucun 3e Chromium.
    expect(app.inFlightScrapes()).toBe(1);

    release();
    await until(() => app.inFlightScrapes() === 0);
  });

  test("mode public : l'admission attend la fin réelle avant de servir la file", async () => {
    const TOKEN = "jeton-public-de-test-0123456789";
    let releaseFirst: () => void = () => {};
    let releaseSecond: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    let calls = 0;
    const app = createApp({
      token: TOKEN,
      timeoutMs: 100,
      // 2 scrapes simultanés (plafond du process) : le 3e attend la file.
      rateLimit: { burst: 10, refillPerSecond: 0, maxQueue: 1, now: () => 0 },
      scrape: async () => {
        const call = (calls += 1);
        if (call === 1) await firstGate;
        if (call === 2) await secondGate;
        return [FAKE_DOC];
      },
    });
    const withToken = (): Request =>
      new Request("http://127.0.0.1/v1/manuals/scrape", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify(BODY),
      });

    const first = app.handler(withToken());
    const second = app.handler(withToken());
    await until(() => calls === 2);
    const third = app.handler(withToken());
    let thirdDone = false;
    void third.then(() => {
      thirdDone = true;
    });

    expect((await first).status).toBe(504);
    expect((await second).status).toBe(504);
    // Les deux scrapes courent encore : le slot d'admission n'est pas rendu.
    expect(app.inFlightScrapes()).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(thirdDone).toBe(false);

    releaseFirst();
    // Le premier scrape finit vraiment : le 3e entre enfin.
    expect((await third).status).toBe(200);
    releaseSecond();
    await until(() => app.inFlightScrapes() === 0);
  });
});
