// Scraper-only : le process ne sert QUE GET /v1/health + POST /v1/manuals/scrape,
// tout le reste = 404. Plateforme et URL de départ viennent du corps, jamais
// d'env ni de log ; les identifiants de portail sont REFUSÉS.
// Fakes synthétiques : scrape injecté, aucun navigateur, aucun réseau externe.
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp, start } from "../../server/infrastructure/http";
import {
  API_ROUTES,
  isManualsScrapeRequest,
  isManualsScrapeResponse,
} from "../../shared/contracts/api";
import { ScrapeManualsError, isLoginPage, scrapeManuals } from "../../server/infrastructure/manuals-scrape";
import type { HostResolver } from "../../server/infrastructure/ssrf";
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
    startUrl: "https://manuels.example.invalid/6e/maths",
    ...overrides,
  };
}

/** Corps qui PORTE des identifiants : le serveur doit le refuser (#526). */
function scrapeBodyWithCredentials() {
  return scrapeBody({
    username: syntheticManualAccount.username,
    password: syntheticManualAccount.password,
  });
}

const post = (path: string, body: unknown) =>
  new Request(`http://127.0.0.1${path}`, { method: "POST", body: JSON.stringify(body) });

// Le VRAI scraper, navigateur MOCKÉ : `playwright` et `fetch` sont stubés.
const PUBLIC_URL = "https://manuels.example.invalid/6e/maths";
/** IP publique factice (aucune adresse réelle n'est contactée). */
const PUBLIC_IP = "93.184.216.34";

/** Page de CONNEXION factice : le portail ne reconnaît pas la session. */
const LOGIN_HTML = `<html><body><form action="/connexion" method="post">
  <input type="text" name="username" />
  <input type="password" name="password" />
  <button type="submit">Se connecter</button>
</form></body></html>`;

/** Page de MANUEL factice : aucun champ mot de passe. */
const MANUAL_HTML =
  "<html><body><h1>Maths 6e</h1><p>Fractions : un demi, un quart.</p></body></html>";

/** HTML rendu par la page factice (commutable par les tests). */
let renderedHtml = MANUAL_HTML;

mock.module("playwright", () => ({
  chromium: {
    launch: async () => ({
      newContext: async () => ({
        newPage: async () => ({
          url: () => PUBLIC_URL,
          title: async () => "Titre factice",
          // La borne est appliquée DANS le navigateur : le faux rend au plus `max` caractères.
          evaluate: async (_fn: unknown, max: number) =>
            renderedHtml.length > max ? renderedHtml.slice(0, max + 1) : renderedHtml,
          route: async () => {},
          goto: async () => ({ status: () => 200, ok: () => true }),
        }),
        storageState: async () => {},
        close: async () => {},
      }),
      close: async () => {},
    }),
  },
}));

/** Résolveur FACTICE : aucun DNS réel dans les tests. */
const PUBLIC_RESOLVER: HostResolver = async (host) => {
  if (host === "manuels.example.invalid") return [PUBLIC_IP];
  throw new Error(`ENOTFOUND ${host}`);
};

let fetchSpy: { mockRestore: () => void } | null = null;

/** Stub du `fetch` global (chaîne de redirections) : aucun réseau réel. */
function stubFetch(): void {
  fetchSpy?.mockRestore();
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((() =>
    Promise.resolve(new Response("ok", { status: 200 }))) as unknown as typeof fetch);
}

afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = null;
  renderedHtml = MANUAL_HTML;
});

/** Motif de refus du scrape (le message seul ne dit pas tout). */
async function refusal(promise: Promise<unknown>): Promise<ScrapeManualsError> {
  try {
    await promise;
  } catch (err) {
    return err as ScrapeManualsError;
  }
  throw new Error("le scrape aurait dû être refusé");
}

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
    // La table ne liste plus que le vivant ; les routes métier supprimées sont 404.
    expect(API_ROUTES).toEqual([
      { method: "GET", path: "/v1/health" },
      { method: "POST", path: "/v1/manuals/scrape" },
      { method: "POST", path: "/v1/web/scrape" },
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

  test("scrape : page -> ManualDoc, aucun credential transmis au scraper, rien dans un log", async () => {
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
      // Le scraper ne s'authentifie pas : il ne reçoit QUE la plateforme (I24).
      expect(fake.calls[0]?.config).toEqual({ platform: syntheticManualAccount.platform });
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
      scrapeBody({ startUrl: "ftp://hote.invalid/x" }),
      scrapeBody({ startUrl: "  " }),
      // Le corps ne demande plus de jar : le serveur refuse (400).
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
    // Playwright absent : 501 franc, pas 502 ni 500.
    const res = await noBrowser.handler(post("/v1/manuals/scrape", scrapeBody()));
    expect(res.status).toBe(501);
  });

  test("contrat : gardes requête/réponse", async () => {
    expect(isManualsScrapeRequest(scrapeBody())).toBe(true);
    expect(isManualsScrapeRequest({ ...scrapeBody(), headless: false })).toBe(true);
    // C'est le SERVEUR qui refuse le corps qui demande un jar, pas le contrat.
    expect(isManualsScrapeRequest({ ...scrapeBody(), authFile: "manuel.json" })).toBe(true);
    // Le contrat n'exige ni ne valide d'identifiants : c'est le SERVEUR qui refuse.
    expect(isManualsScrapeRequest({ ...scrapeBody(), username: "u", password: "p" })).toBe(true);
    expect(isManualsScrapeRequest(null)).toBe(false);
    expect(isManualsScrapeResponse({ docs: [FAKE_DOC] })).toBe(true);
    expect(isManualsScrapeResponse({ docs: [] })).toBe(true);
    expect(isManualsScrapeResponse({ docs: [{ ...FAKE_DOC, page: 0 }] })).toBe(false);
    expect(isManualsScrapeResponse({ docs: "non" })).toBe(false);
  });

  test("#538 : le corps ne choisit plus le jar : le serveur impose le sien", async () => {
    const fake = fakeScrape();
    const app = createApp({ scrape: fake.scrape, authFile: "/srv/jars/serveur.json" });
    // Un corps qui demande un jar est REFUSÉ : celui d'un autre tenant n'est jamais monté.
    const refused = await app.handler(
      post("/v1/manuals/scrape", scrapeBody({ authFile: "manuel.json" })),
    );
    expect(refused.status).toBe(400);
    expect(fake.calls).toHaveLength(0);
    // Sans demande : le jar du serveur, et lui seul.
    await app.handler(post("/v1/manuals/scrape", scrapeBody()));
    expect(fake.calls[0]?.opts).toMatchObject({ defaultAuthFile: "/srv/jars/serveur.json" });
    // Et le corps ne peut pas nommer un jar : l'option n'existe plus.
    expect(fake.calls[0]?.opts).not.toHaveProperty("authFile");
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

  // Le repli en clair doit être BRUYANT : sinon un opérateur croit servir du HTTPS sans auth (I8).
  test("sans TLS : le repli en clair est BRUYANT (#421)", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const log = spyOn(console, "log").mockImplementation(() => {});
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
      log.mockRestore();
    }
  });
});

// Le scraper ne s'authentifie pas, et une PAGE DE CONNEXION n'est jamais un manuel
// (le portail rendait son login en 200 et il devenait citable).
describe("#526 — identifiants refusés, page de connexion jamais ingérée", () => {
  test("le contrat n'exige plus d'identifiants (usage réel : la session est celle du serveur)", () => {
    expect(
      isManualsScrapeRequest({ platform: "editeur-fake", startUrl: "https://manuels.example.invalid/6e/maths" }),
    ).toBe(true);
  });

  test("des identifiants dans le corps = 400 dédié, aucun scrape, aucun log", async () => {
    const fake = fakeScrape();
    const app = createApp({ scrape: fake.scrape });
    const logs: string[] = [];
    const spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => String(a)).join(" "));
    });
    try {
      const res = await app.handler(post("/v1/manuals/scrape", scrapeBodyWithCredentials()));
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error?: { code?: string; message?: string } };
      expect(json.error?.code).toBe("bad_request");
      // Le message NOMME les champs à retirer : l'appelant sait quoi enlever.
      expect(json.error?.message).toContain("username");
      expect(json.error?.message).toContain("password");
      // Aucun scrape lancé : le credential ne va nulle part.
      expect(fake.calls).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
    // Et il ne finit pas dans un log.
    const joined = logs.join("\n");
    expect(joined).not.toContain(syntheticManualAccount.username);
    expect(joined).not.toContain(syntheticManualAccount.password);
  });

  test("la détection : un champ mot de passe = page de connexion, un manuel = non", () => {
    expect(isLoginPage(LOGIN_HTML)).toBe(true);
    expect(isLoginPage(MANUAL_HTML)).toBe(false);
    // Le type peut être écrit en majuscules, le nom peut porter la casse.
    expect(isLoginPage("<html><body><input type='Password'></body></html>")).toBe(true);
    expect(isLoginPage("<html><body><input name='PASSWORD'></body></html>")).toBe(true);
    // Un champ qui n'est PAS un mot de passe n'est pas un formulaire de login.
    expect(isLoginPage("<html><body><input type='text' name='username'></body></html>")).toBe(false);
  });

  test("une page de connexion (HTTP 200) n'est JAMAIS ingérée comme un manuel", async () => {
    stubFetch();
    renderedHtml = LOGIN_HTML;
    const err = await refusal(
      scrapeManuals(
        { platform: syntheticManualAccount.platform },
        { startUrl: PUBLIC_URL, resolveHost: PUBLIC_RESOLVER },
      ),
    );
    expect(err).toBeInstanceOf(ScrapeManualsError);
    expect(err.reason).toBe("login_required");
    expect(err.message).toMatch(/page de connexion/);
  });

  test("une vraie page de manuel est toujours ingérée (le refus ne mord pas tout)", async () => {
    stubFetch();
    renderedHtml = MANUAL_HTML;
    const docs = await scrapeManuals(
      { platform: syntheticManualAccount.platform },
      { startUrl: PUBLIC_URL, resolveHost: PUBLIC_RESOLVER },
    );
    expect(docs).toHaveLength(1);
    expect(docs[0]?.excerpt).toContain("Fractions");
  });

  test("côté HTTP : la page de connexion = 502 login_required (jamais un doc)", async () => {
    stubFetch();
    renderedHtml = LOGIN_HTML;
    const app = createApp({ scrape: scrapeManuals, resolveHost: PUBLIC_RESOLVER });
    const res = await app.handler(post("/v1/manuals/scrape", scrapeBody()));
    expect(res.status).toBe(502);
    expect((await res.json()) as unknown).toMatchObject({ error: { code: "login_required" } });
  });
});
