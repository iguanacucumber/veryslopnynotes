// Scraper-only (#209, #210) : le process ne sert QUE des manuels.
// Surface : GET /v1/health + POST /v1/manuals/scrape, sans auth. Tout le reste
// (les 28 chemins métier supprimés en #210) = 404. Credentials portail injectés par l'appelant
// dans le corps, jamais en env ni commités, jamais journalisés.
// Fakes 100 % synthétiques : scrape injecté, aucun navigateur, aucun réseau
// externe (Bun.serve uniquement sur 127.0.0.1 éphémère pour le client HTTPS).
import { describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp, start } from "../../server/infrastructure/http";
import {
  API_ROUTES,
  isManualsScrapeRequest,
  isManualsScrapeResponse,
} from "../../shared/contracts/api";
import { ScrapeManualsError } from "../../server/infrastructure/manuals-scrape";
import { syntheticManualAccount } from "./fixtures/manuals";

const ROOT = join(import.meta.dir, "..", "..");

const FAKE_DOC = {
  id: "scrape-1",
  platform: syntheticManualAccount.platform,
  title: "Maths-Fake 6e",
  subject: "Maths-Fake",
  page: 1,
  excerpt: "Extrait synthétique fractions, moitié et quart.",
};

function fakeScrape(docs: unknown[] = [FAKE_DOC]) {
  const calls: { config: unknown; opts: unknown }[] = [];
  return {
    calls,
    scrape: async (config: unknown, opts: unknown) => {
      calls.push({ config, opts });
      return docs as never;
    },
  };
}

function scrapeBody(overrides: Record<string, unknown> = {}) {
  return {
    platform: syntheticManualAccount.platform,
    username: syntheticManualAccount.username,
    password: syntheticManualAccount.password,
    startUrl: "https://manuels.example.invalid/6e/maths",
    ...overrides,
  };
}

const post = (path: string, body: unknown) =>
  new Request(`http://127.0.0.1${path}`, { method: "POST", body: JSON.stringify(body) });

describe("scraper-only (#209)", () => {
  test("sonde vivacité sans auth, HEAD sans corps", async () => {
    const app = createApp({ scrape: fakeScrape().scrape });
    const health = await app.handler(new Request("http://127.0.0.1/v1/health"));
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok", version: expect.any(String) });
    const head = await app.handler(new Request("http://127.0.0.1/v1/health", { method: "HEAD" }));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  test("surface : les 28 chemins métier + chemins inconnus = 404, avec ou sans bearer", async () => {
    const app = createApp({ scrape: fakeScrape().scrape });
    const auth = { authorization: "Bearer jeton-jamais-vu" };
    // #210 : la table ne liste plus que le vivant ; les 31 routes métier
    // supprimées restent 404 par construction (rejet avant toute lecture).
    expect(API_ROUTES).toEqual([
      { method: "GET", path: "/v1/health" },
      { method: "POST", path: "/v1/manuals/scrape" },
    ]);
    const olds = [
      "/v1/pairing/start",
      "/v1/pairing/confirm",
      "/v1/setup",
      "/v1/grades",
      "/v1/periods",
      "/v1/assignments",
      "/v1/assignments/toggle",
      "/v1/timetable",
      "/v1/events",
      "/v1/security/alerts",
      "/v1/homework/generate",
      "/v1/revision-sheets",
      "/v1/revision-sheets/pdf",
      "/v1/subjects/prefs",
      "/v1/news",
      "/v1/menus",
      "/v1/attendance",
      "/v1/punishments",
      "/v1/me",
      "/v1/media",
      "/v1/capabilities",
      "/v1/sync/refresh",
      "/v1/discussions",
      "/v1/discussions/messages",
      "/v1/discussions/recipients",
      "/v1/discussions/reply",
      "/v1/discussions/read-state",
      "/v1/discussions/delete",
    ];
    expect(olds.length).toBeGreaterThanOrEqual(28);
    for (const path of [...olds, "/v1/inconnu", "/"]) {
      for (const headers of [{}, auth]) {
        const res = await app.handler(
          new Request(`http://127.0.0.1${path}`, { method: "GET", headers }),
        );
        expect({ path, status: res.status }).toEqual({ path, status: path === "/v1/health" ? 200 : 404 });
      }
    }
  });

  test("mauvaises méthodes = 405 avec Allow, jamais de fuite", async () => {
    const app = createApp({ scrape: fakeScrape().scrape });
    const get = await app.handler(new Request("http://127.0.0.1/v1/manuals/scrape"));
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
    const put = await app.handler(
      new Request("http://127.0.0.1/v1/health", { method: "PUT" }),
    );
    expect(put.status).toBe(405);
    expect(put.headers.get("allow")).toBe("GET");
  });

  test("scrape : page -> ManualDoc, credentials transmis au scraper sans transiter par un log", async () => {
    const fake = fakeScrape();
    const app = createApp({ scrape: fake.scrape });
    const logs: string[] = [];
    const spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => String(a)).join(" "));
    });
    try {
      const res = await app.handler(post("/v1/manuals/scrape", scrapeBody()));
      expect(res.status).toBe(200);
      const payload = await res.json();
      expect(isManualsScrapeResponse(payload)).toBe(true);
      expect(payload.docs).toHaveLength(1);
      expect(fake.calls).toHaveLength(1);
      expect(fake.calls[0]?.config).toEqual({
        platform: syntheticManualAccount.platform,
        username: syntheticManualAccount.username,
        password: syntheticManualAccount.password,
      });
      expect(fake.calls[0]?.opts).toMatchObject({ startUrl: "https://manuels.example.invalid/6e/maths" });
    } finally {
      spy.mockRestore();
    }
    const joined = logs.join("\n");
    expect(joined).not.toContain(syntheticManualAccount.password);
    expect(joined).not.toContain(syntheticManualAccount.username);
    expect(joined).not.toContain("manuels.example.invalid");
  });

  test("scrape : corps invalide = 400 typé, jamais d'appel scraper", async () => {
    const fake = fakeScrape();
    const app = createApp({ scrape: fake.scrape });
    for (const body of [
      scrapeBody({ password: undefined }),
      scrapeBody({ startUrl: "ftp://hote.invalid/x" }),
      scrapeBody({ startUrl: "  " }),
      scrapeBody({ authFile: "/etc/passwd" }),
      scrapeBody({ authFile: "../jar.json" }),
      {},
    ]) {
      const res = await app.handler(post("/v1/manuals/scrape", body));
      expect(res.status).toBe(400);
    }
    expect(fake.calls).toHaveLength(0);
    const huge = await app.handler(
      new Request("http://127.0.0.1/v1/manuals/scrape", { method: "POST", body: "x".repeat(9000) }),
    );
    expect(huge.status).toBe(400);
    expect(fake.calls).toHaveLength(0);
  });

  test("scrape : échec scraper = 502 typé, inattendu = 500, Playwright absent = 501", async () => {
    const failing = createApp({
      scrape: async () => {
        throw new ScrapeManualsError("mur de connexion");
      },
    });
    expect((await failing.handler(post("/v1/manuals/scrape", scrapeBody()))).status).toBe(502);
    const broken = createApp({
      scrape: async () => {
        throw new Error("panne interne");
      },
    });
    expect((await broken.handler(post("/v1/manuals/scrape", scrapeBody()))).status).toBe(500);
    const noBrowser = createApp({
      scrape: async () => {
        throw new ScrapeManualsError("Playwright non installé — e2e manuals skippé");
      },
    });
    // Playwright absent : message reconnu comme capability manquante (#374 :
    // 501 franc, pas 502 « scrape impossible » ni 500 « unexpected failure »).
    const res = await noBrowser.handler(post("/v1/manuals/scrape", scrapeBody()));
    expect(res.status).toBe(501);
  });

  test("contrat : gardes requête/réponse", async () => {
    expect(isManualsScrapeRequest(scrapeBody())).toBe(true);
    expect(isManualsScrapeRequest({ ...scrapeBody(), headless: false })).toBe(true);
    // #362 : `authFile` = NOM de jar, plus un chemin.
    expect(isManualsScrapeRequest({ ...scrapeBody(), authFile: "manuel.json" })).toBe(true);
    expect(isManualsScrapeRequest({ ...scrapeBody(), authFile: "playwright/.auth/x.json" })).toBe(false);
    expect(isManualsScrapeRequest({ ...scrapeBody(), password: "" })).toBe(false);
    expect(isManualsScrapeRequest(null)).toBe(false);
    expect(isManualsScrapeResponse({ docs: [FAKE_DOC] })).toBe(true);
    expect(isManualsScrapeResponse({ docs: [] })).toBe(true);
    expect(isManualsScrapeResponse({ docs: [{ ...FAKE_DOC, page: 0 }] })).toBe(false);
    expect(isManualsScrapeResponse({ docs: "non" })).toBe(false);
  });

  test("#362 : le corps ne fournit qu'un NOM de jar, le serveur impose son chemin", async () => {
    const fake = fakeScrape();
    const app = createApp({ scrape: fake.scrape, authFile: "/srv/jars/serveur.json" });
    await app.handler(post("/v1/manuals/scrape", scrapeBody({ authFile: "manuel.json" })));
    expect(fake.calls[0]?.opts).toMatchObject({ authFile: "manuel.json" });
    // Sans nom demandé : le jar du serveur, jamais un chemin venu du corps.
    await app.handler(post("/v1/manuals/scrape", scrapeBody()));
    expect(fake.calls[1]?.opts).toMatchObject({ authFile: undefined });
    expect(fake.calls[1]?.opts).toMatchObject({ defaultAuthFile: "/srv/jars/serveur.json" });
  });

  test("I8 : aucun credential lu dans l'environnement (PORT/HOST/TLS seuls, dans start)", async () => {
    const src = readFileSync(join(ROOT, "server/infrastructure/http.ts"), "utf8");
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "\n")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    const envReads = code.split("\n").filter((l) => /Bun\.env|process\.env/.test(l));
    // Une seule lecture : le `env` par défaut de start(), jamais un credential.
    expect(envReads).toHaveLength(1);
    expect(envReads[0]).toContain("= Bun.env as Record");
    expect(code).toContain('envValue(env, "PORT")');
    expect(code).toContain('envValue(env, "HOST")');
    expect(code).toContain("TLS_CERT_FILE");
    expect(code).toContain("TLS_KEY_FILE");
  });

  test("sans auth : aucun bearer exigé ni lu sur les routes servies", async () => {
    const src = readFileSync(join(ROOT, "server/infrastructure/http.ts"), "utf8");
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "\n")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .map((l) => {
        const idx = l.search(/(?<!:)\/\//);
        return idx >= 0 ? l.slice(0, idx) : l;
      })
      .join("\n");
    expect(code).not.toMatch(/authorization/i);
    expect(code).not.toMatch(/bearer/i);
    // Et le comportement le prouve : 200/400/404 sans aucun en-tête.
    const app = createApp({ scrape: fakeScrape().scrape });
    expect((await app.handler(new Request("http://127.0.0.1/v1/health"))).status).toBe(200);
    expect((await app.handler(post("/v1/manuals/scrape", scrapeBody()))).status).toBe(200);
  });

  // #421 : le repli en clair ne doit pas être SILENCIEUX. Le serveur accepte
  // de tourner en http (bornes aux tests et à Docker), mais il doit le DIRE
  // fort : sans ça, un opérateur croit démarrer en HTTPS et expose un
  // scraper sans auth (I8) en clair.
  test("sans TLS : le repli en clair est BRUYANT (#421)", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const server = start({ PORT: "0", HOST: "127.0.0.1" });
    try {
      expect(warn).toHaveBeenCalled();
      const message = warn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(message).toContain("CLAIR");
      expect(message).toContain("TLS_CERT_FILE");
      // Le rappel n'expose aucun secret : seulement des NOMS de variables.
      expect(message).not.toMatch(/PRIVATE KEY|sk-or-v1/);
    } finally {
      server.stop(true);
      warn.mockRestore();
    }
  });
});
