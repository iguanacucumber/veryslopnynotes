// Mode public (I8) : seau PAR JETON, file FIFO bornée, 429 + Retry-After.
// Charge synthétique de 40 requêtes, fakes purs : aucun Chromium, aucun réseau.
// La boucle locale reste sans jeton et sans limite (comportement 503 d'origine).
import { describe, expect, test } from "bun:test";
import { createApp } from "../../server/infrastructure/http";
import { PublicAdmission } from "../../server/infrastructure/rate-limit";
import { MANUALS_SCRAPE_PATH, WEB_SCRAPE_PATH } from "../../shared/contracts/api";
import { syntheticManualAccount } from "./fixtures/manuals";

const TOKEN = "jeton-public-de-test-0123456789";
const FAKE_DOC = {
  id: "scrape-1",
  platform: syntheticManualAccount.platform,
  title: "Maths-Fake 6e",
  subject: "Maths-Fake",
  page: 1,
  excerpt: "Extrait synthétique fractions, moitié et quart.",
};
const FAKE_WEB = { title: "Page factice", excerpt: "Texte factice." };

function scrapeBody() {
  return {
    platform: syntheticManualAccount.platform,
    startUrl: "https://manuels.example.invalid/6e/maths",
  };
}

function post(path: string, body: unknown, token?: string): Request {
  return new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("condition non atteinte");
}

describe("seau par jeton — déterministe, horloge injectée", () => {
  test("la rafale est consommée par jeton ; le second jeton garde son seau", async () => {
    let now = 0;
    const limiter = new PublicAdmission(
      { burst: 2, refillPerSecond: 1, maxConcurrent: 10, maxQueue: 0 },
      () => now,
    );

    expect((await limiter.acquire("empreinte-a")).ok).toBe(true);
    expect((await limiter.acquire("empreinte-a")).ok).toBe(true);
    const refused = await limiter.acquire("empreinte-a");
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.retryAfterMs).toBe(1_000);

    // Un autre jeton n'est pas puni par la rafale du premier.
    expect((await limiter.acquire("empreinte-b")).ok).toBe(true);

    now = 1_000;
    expect((await limiter.acquire("empreinte-a")).ok).toBe(true);
  });

  test("la reconstitution ne dépasse jamais la rafale", async () => {
    let now = 0;
    const limiter = new PublicAdmission(
      { burst: 2, refillPerSecond: 1, maxConcurrent: 10, maxQueue: 0 },
      () => now,
    );
    await limiter.acquire("jeton");
    await limiter.acquire("jeton");
    now = 100_000;
    expect((await limiter.acquire("jeton")).ok).toBe(true);
    expect((await limiter.acquire("jeton")).ok).toBe(true);
    expect((await limiter.acquire("jeton")).ok).toBe(false);
  });

  test("la file sert FIFO et ne dépasse jamais la concurrence", async () => {
    const limiter = new PublicAdmission(
      { burst: 10, refillPerSecond: 0, maxConcurrent: 1, maxQueue: 2 },
      () => 0,
    );
    const first = await limiter.acquire("a");
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = limiter.acquire("b");
    const third = limiter.acquire("c");
    let thirdDone = false;
    void third.then(() => {
      thirdDone = true;
    });

    first.admission.release();
    const secondResult = await second;
    expect(secondResult.ok).toBe(true);
    expect(thirdDone).toBe(false);
    if (secondResult.ok) secondResult.admission.release();

    const thirdResult = await third;
    expect(thirdResult.ok).toBe(true);
    if (thirdResult.ok) thirdResult.admission.release();
  });

  test("file pleine = refus immédiat, le jeton emprunté est rendu", async () => {
    const limiter = new PublicAdmission(
      { burst: 10, refillPerSecond: 0, maxConcurrent: 1, maxQueue: 1 },
      () => 0,
    );
    const first = await limiter.acquire("t");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const queued = limiter.acquire("t");
    const refused = await limiter.acquire("t");
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.retryAfterMs).toBeGreaterThan(0);

    first.admission.release();
    expect((await queued).ok).toBe(true);
  });

  test("client parti en file : le jeton est rendu et le slot reste libre", async () => {
    const limiter = new PublicAdmission(
      { burst: 10, refillPerSecond: 0, maxConcurrent: 1, maxQueue: 1 },
      () => 0,
    );
    const first = await limiter.acquire("t");
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const controller = new AbortController();
    const queued = limiter.acquire("t", controller.signal);
    controller.abort();
    const abandoned = await queued;
    expect(abandoned.ok).toBe(false);

    first.admission.release();
    // Le jeton rendu permet une nouvelle admission malgré burst déjà consommé.
    expect((await limiter.acquire("t")).ok).toBe(true);
  });
});

describe("HTTP — authentification puis quota par jeton", () => {
  test("401 ne consomme pas le seau ; le premier scrape valide passe", async () => {
    const app = createApp({
      token: TOKEN,
      rateLimit: { burst: 1, refillPerSecond: 0, maxQueue: 0, now: () => 0 },
      scrape: async () => [FAKE_DOC],
    });

    expect((await app.handler(post(MANUALS_SCRAPE_PATH, scrapeBody()))).status).toBe(401);
    expect(
      (await app.handler(post(MANUALS_SCRAPE_PATH, scrapeBody(), "mauvais-jeton"))).status,
    ).toBe(401);
    expect((await app.handler(post(MANUALS_SCRAPE_PATH, scrapeBody(), TOKEN))).status).toBe(200);

    const refused = await app.handler(post(MANUALS_SCRAPE_PATH, scrapeBody(), TOKEN));
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await refused.json()) as unknown).toMatchObject({ error: { code: "rate_limited" } });
  });

  test("les deux routes de scrape partagent le seau du jeton", async () => {
    const app = createApp({
      token: TOKEN,
      rateLimit: { burst: 1, refillPerSecond: 0, maxQueue: 0, now: () => 0 },
      scrape: async () => [FAKE_DOC],
      scrapeWeb: async () => [FAKE_WEB],
    });

    expect((await app.handler(post(MANUALS_SCRAPE_PATH, scrapeBody(), TOKEN))).status).toBe(200);
    const web = await app.handler(
      post(WEB_SCRAPE_PATH, { url: "https://manuels.example.invalid/page" }, TOKEN),
    );
    expect(web.status).toBe(429);
    expect(Number(web.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  });

  test("la boucle locale sans jeton reste sans quota", async () => {
    const app = createApp({
      rateLimit: { burst: 1, refillPerSecond: 0, maxQueue: 0, now: () => 0 },
      scrape: async () => [FAKE_DOC],
    });
    expect((await app.handler(post(MANUALS_SCRAPE_PATH, scrapeBody()))).status).toBe(200);
    expect((await app.handler(post(MANUALS_SCRAPE_PATH, scrapeBody()))).status).toBe(200);
  });
});

describe("charge synthétique — 40 requêtes publiques", () => {
  test("2 en cours, 4 en file, le reste 429 ; aucun scrape au-delà du quota", async () => {
    let running = 0;
    let maxRunning = 0;
    let started = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const app = createApp({
      token: TOKEN,
      // Horloge figée : aucune reconstitution pendant la mesure.
      rateLimit: { burst: 6, refillPerSecond: 0, maxQueue: 4, now: () => 0 },
      scrape: async () => {
        started += 1;
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await gate;
        running -= 1;
        return [FAKE_DOC];
      },
    });

    const pending = Array.from({ length: 40 }, () =>
      app.handler(post(MANUALS_SCRAPE_PATH, scrapeBody(), TOKEN)),
    );
    await until(() => running === 2);

    release();
    const responses = await Promise.all(pending);
    const statuses = responses.map((response) => response.status);

    expect(statuses.filter((status) => status === 200)).toHaveLength(6);
    expect(statuses.filter((status) => status === 429)).toHaveLength(34);
    expect(started).toBe(6);
    expect(maxRunning).toBe(2);
    expect(app.inFlightScrapes()).toBe(0);

    for (const response of responses.filter((candidate) => candidate.status === 429)) {
      expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    }
  });
});
