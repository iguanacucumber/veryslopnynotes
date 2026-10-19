// Plafond de concurrence + annulation RÉELLE du scraper (#363).
// Avant : le compteur était incrémenté APRÈS un `await` (lecture du corps)
// et le délai d'attente ne faisait que rejeter la promesse — 8 requêtes
// parallèles = 8 Chromium, et les navigateurs continuaient après le timeout.
// Fakes 100 % synthétiques : aucun navigateur, aucun réseau.
import { describe, expect, test } from "bun:test";
import { createApp } from "../../server/infrastructure/http";
import { scrapeManuals } from "../../server/infrastructure/manuals-scrape";
import { syntheticManualAccount } from "./fixtures/manuals";

const FAKE_DOC = {
  id: "scrape-1",
  platform: syntheticManualAccount.platform,
  title: "Maths-Fake 6e",
  subject: "Maths-Fake",
  page: 1,
  excerpt: "Extrait synthétique fractions, moitié et quart.",
};

function scrapeBody(overrides: Record<string, unknown> = {}) {
  return {
    platform: syntheticManualAccount.platform,
    username: syntheticManualAccount.username,
    password: syntheticManualAccount.password,
    startUrl: "https://manuels.example.invalid/6e/maths",
    ...overrides,
  };
}

const post = (body: unknown, signal?: AbortSignal) =>
  new Request("http://127.0.0.1/v1/manuals/scrape", {
    method: "POST",
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });

describe("plafond de concurrence du scraper (#363)", () => {
  test("8 requêtes parallèles : 2 scrapes lancés, le reste 503, compteur à 0", async () => {
    let running = 0;
    let maxRunning = 0;
    let started = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const app = createApp({
      scrape: async () => {
        started += 1;
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await gate;
        running -= 1;
        return [FAKE_DOC];
      },
    });

    // Les 8 handlers entrent AVANT le premier await du faux scrape : le
    // compteur est incrémenté avant toute lecture de corps, donc le plafond
    // est réellement appliqué (avant #363 : les 8 passaient).
    const pending = Array.from({ length: 8 }, () => app.handler(post(scrapeBody())));
    const peak = app.inFlightScrapes();
    release();
    const responses = await Promise.all(pending);

    // Observable d'abord : 2 scrapes lancés au maximum, 6 refus typés.
    expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 503, 503, 503, 503, 503, 503]);
    expect(started).toBe(2);
    expect(maxRunning).toBe(2);
    expect(peak).toBe(2);
    expect(app.inFlightScrapes()).toBe(0);

    const busy = responses.find((r) => r.status === 503);
    expect(busy?.headers.get("retry-after")).toBe("5");
    expect((await busy?.json()) as unknown).toMatchObject({ error: { code: "busy" } });
  });

  test("délai dépassé : le scraper reçoit l'annulation (navigateur tué), compteur à 0", async () => {
    let aborted = false;
    let gotSignal = false;
    const app = createApp({
      timeoutMs: 40,
      scrape: async (_config, opts) => {
        gotSignal = Boolean(opts.signal);
        return await new Promise<never>((_resolve, reject) => {
          opts.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("annulé"));
          });
        });
      },
    });

    const res = await app.handler(post(scrapeBody()));
    // #422 : le délai dépassé = 504 (le code exact), pas 502 : le portail
    // n'est pas en cause, c'est le temps qui manque.
    expect(res.status).toBe(504);
    expect((await res.json()) as unknown).toMatchObject({ error: { code: "timeout" } });
    expect(gotSignal).toBe(true);
    // Le délai n'a pas seulement rejeté la promesse : le scraper a été
    // annulé (sinon le Chromium continue en arrière-plan).
    expect(aborted).toBe(true);
    expect(app.inFlightScrapes()).toBe(0);
  });

  test("client abandonne : le scrape est annulé et le compteur libéré", async () => {
    const ac = new AbortController();
    let aborted = false;
    let markStarted: () => void = () => {};
    const startedP = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const app = createApp({
      timeoutMs: 5_000,
      scrape: async (_config, opts) =>
        await new Promise<never>((_resolve, reject) => {
          opts.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("annulé"));
          });
          markStarted();
        }),
    });

    const pending = app.handler(post(scrapeBody(), ac.signal));
    await startedP;
    expect(app.inFlightScrapes()).toBe(1);
    ac.abort();
    const res = await pending;
    expect(aborted).toBe(true);
    expect(res.status).toBe(502);
    expect(app.inFlightScrapes()).toBe(0);
  });

  test("corps invalide : le compteur est libéré (aucun slot fuité)", async () => {
    const app = createApp({ scrape: async () => [FAKE_DOC] });
    const res = await app.handler(post({ platform: "editeur-fake" }));
    expect(res.status).toBe(400);
    expect(app.inFlightScrapes()).toBe(0);
  });

  test("scrapManuals : signal déjà annulé = refus immédiat, aucun navigateur", async () => {
    const ac = new AbortController();
    ac.abort();
    // Aucun Chromium lancé : le refus part avant l'import de Playwright.
    await expect(
      scrapeManuals(
        {
          platform: syntheticManualAccount.platform,
          username: syntheticManualAccount.username,
          password: syntheticManualAccount.password,
        },
        { startUrl: "https://manuels.example.invalid/6e/maths", signal: ac.signal },
      ),
    ).rejects.toThrow(/annul/);
  });
});
