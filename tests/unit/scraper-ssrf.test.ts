// #362 : garde SSRF + `authFile` non piloté par l'appelant.
// #419 : la garde résout le NOM (DNS) — un nom public qui pointe vers une IP
//        privée est refusé avant la navigation.
//
// Fakes 100 % synthétiques : le module `playwright` est MOCKÉ (aucun
// navigateur, aucun réseau), la résolution DNS est INJECTÉE (aucune requête
// DNS réelle) et le jar est vérifié dans un répertoire temporaire. Le faux
// navigateur simule une REDIRECTION : la cible finale est celle que
// `page.url()` renvoie, et le route handler voit (ou non) le 302 — les deux
// cas sont testés.
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isManualsScrapeRequest } from "../../shared/contracts/api";
import { isBlockedHost, isPublicHttpUrl } from "../../shared/contracts/net";
import { createApp } from "../../server/infrastructure/http";
import {
  DEFAULT_AUTH_FILE,
  ScrapeManualsError,
  assertPublicRedirectChain,
  resolveAuthFile,
  scrapeManuals,
} from "../../server/infrastructure/manuals-scrape";
import { checkPublicHost } from "../../server/infrastructure/ssrf";
import type { HostResolver } from "../../server/infrastructure/ssrf";

const CONFIG = { platform: "editeur-fake", username: "u", password: "p" };
const PUBLIC_URL = "https://manuels.example.invalid/6e";

/** IP publique factice (aucune adresse réelle n'est contactée). */
const PUBLIC_IP = "93.184.216.34";

/**
 * Résolveur FACTICE : table hôte -> adresses. Aucune résolution DNS réelle,
 * aucun réseau : le test de la garde DNS (#419) reste hermétique. Un hôte
 * absent de la table = ENOTFOUND (comme le résolveur du système).
 */
function fakeResolver(table: Record<string, readonly string[]>): HostResolver {
  return async (host: string) => {
    const found = table[host];
    if (!found) throw new Error(`ENOTFOUND ${host}`);
    return found;
  };
}

/** Résolveur par défaut des tests : le seul hôte public du test résout. */
const PUBLIC_RESOLVER = fakeResolver({ "manuels.example.invalid": [PUBLIC_IP] });

/**
 * Motif de refus du scrape (le message seul ne dit pas tout : deux refus
 * SSRF portent des messages différents pour la même cause).
 */
async function refusal(promise: Promise<unknown>): Promise<ScrapeManualsError> {
  try {
    await promise;
  } catch (err) {
    return err as ScrapeManualsError;
  }
  throw new Error("le scrape aurait dû être refusé");
}

interface FakeOptions {
  /** URL FINALE de la navigation (après redirections). */
  finalUrl: string;
  /** false = la redirection finale n'est PAS vue par le route handler. */
  routeSeesRedirect?: boolean;
  status?: number;
}

interface FakeState {
  launched: number;
  contentCalls: number;
  aborted: string[];
  continued: string[];
  storageStatePaths: string[];
  routePattern: string | null;
}

let fake: FakeOptions = { finalUrl: PUBLIC_URL };
const state: FakeState = {
  launched: 0,
  contentCalls: 0,
  aborted: [],
  continued: [],
  storageStatePaths: [],
  routePattern: null,
};
let routeHandler: ((route: unknown) => Promise<void>) | null = null;
let fetchSpy: { mockRestore: () => void } | null = null;

/**
 * Stub du `fetch` global (vérification de la chaîne de redirections AVANT le
 * navigateur) : aucun réseau réel dans les tests.
 */
function stubFetch(handler: (url: string) => Response): void {
  fetchSpy?.mockRestore();
  const spy = spyOn(globalThis, "fetch");
  spy.mockImplementation(((input: unknown) =>
    Promise.resolve(
      handler(typeof input === "string" ? input : String((input as { url?: string })?.url ?? "")),
    )) as unknown as typeof fetch);
  fetchSpy = spy;
}

function resetState(): void {
  fake = { finalUrl: PUBLIC_URL };
  state.launched = 0;
  state.contentCalls = 0;
  state.aborted = [];
  state.continued = [];
  state.storageStatePaths = [];
  state.routePattern = null;
  routeHandler = null;
  stubFetch(() => new Response("ok", { status: 200 })); // pas de redirection
}

afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = null;
});

mock.module("playwright", () => ({
  chromium: {
    launch: async () => {
      state.launched += 1;
      return {
        newContext: async () => ({
          newPage: async () => ({
            url: () => fake.finalUrl,
            title: async () => "Titre factice",
            content: async () => {
              state.contentCalls += 1;
              return "<html><body>SECRET-INTERNAL-SERVICE</body></html>";
            },
            route: async (pattern: string, handler: (r: unknown) => Promise<void>) => {
              state.routePattern = pattern;
              routeHandler = handler;
            },
            goto: async (url: string) => {
              const targets = fake.routeSeesRedirect === false ? [url] : [url, fake.finalUrl];
              for (const target of targets) {
                if (!routeHandler) break;
                let aborted = false;
                await routeHandler({
                  request: () => ({ url: () => target, resourceType: () => "document" }),
                  abort: async () => {
                    aborted = true;
                    state.aborted.push(target);
                  },
                  continue: async () => {
                    state.continued.push(target);
                  },
                });
                if (aborted) throw new Error("net::ERR_BLOCKED_BY_CLIENT");
              }
              return { status: () => fake.status ?? 200, ok: () => (fake.status ?? 200) < 400 };
            },
          }),
          storageState: async (o: { path: string }) => {
            state.storageStatePaths.push(o.path);
          },
          close: async () => {},
        }),
        close: async () => {},
      };
    },
  },
}));

describe("garde SSRF : hôte privé/interne refusé (#362)", () => {
  const PRIVES = [
    "[::ffff:127.0.0.1]",
    "::ffff:7f00:1",
    "2130706433",
    "0x7f000001",
    "127.0.0.1",
    "169.254.169.254",
    "10.0.0.5",
    "192.168.1.1",
    "172.16.0.1",
    "172.31.255.255",
    "fc00::1",
    "fe80::1",
    "localhost",
  ];

  test("tous les hôtes privés/internes sont refusés, un hôte public est accepté", () => {
    // Vrai positif : la liste ne doit laisser passer AUCUN hôte.
    expect(PRIVES.filter((h) => !isBlockedHost(h))).toEqual([]);
    expect(isBlockedHost("manuels.example.invalid")).toBe(false);
    expect(isBlockedHost("8.8.8.8")).toBe(false);
    expect(isPublicHttpUrl("https://manuels.example.invalid/6e/maths")).toBe(true);
  });

  test("la forme NORMALISÉE par new URL() est bien refusée (le trou de #362)", () => {
    // new URL() transforme 127.0.0.1 en [::ffff:7f00:1] et 2130706433 en
    // 127.0.0.1 : la garde doit porter sur la forme normalisée, pas sur la
    // chaîne brute.
    expect(new URL("http://[::ffff:127.0.0.1]:8080/x").hostname).toBe("[::ffff:7f00:1]");
    expect(isBlockedHost(new URL("http://[::ffff:127.0.0.1]:8080/x").hostname)).toBe(true);
    expect(new URL("http://2130706433/").hostname).toBe("127.0.0.1");
    expect(isBlockedHost(new URL("http://2130706433/").hostname)).toBe(true);
    expect(new URL("http://0x7f000001/").hostname).toBe("127.0.0.1");
    expect(isBlockedHost(new URL("http://0x7f000001/").hostname)).toBe(true);
    // Formes exotiques qui normalisent vers la boucle locale.
    for (const url of [
      "http://127.0.0.1./",
      "http://0x7f.0.0.1/",
      "http://0177.0.0.1/",
      "http://017700000001/",
      "http://0/",
      "http://[::]/",
      "http://[0:0:0:0:0:ffff:127.0.0.1]/",
      "http://[64:ff9b::7f00:1]/",
      "http://user:pass@127.0.0.1/",
    ]) {
      expect(isPublicHttpUrl(url)).toBe(false);
    }
    // Le userinfo ne doit pas servir de leurre : l'hôte reste le vrai.
    expect(isPublicHttpUrl("http://127.0.0.1:80@editeur.example.invalid/")).toBe(true);
  });

  test("le contrat refuse aussi les startUrl privées", () => {
    const base = { platform: "p", username: "u", password: "m", startUrl: PUBLIC_URL };
    expect(isManualsScrapeRequest(base)).toBe(true);
    for (const url of [
      "http://[::ffff:127.0.0.1]:9/x",
      "http://2130706433/",
      "http://0x7f000001/",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.5/",
      "http://localhost:8080/",
      "http://[fc00::1]/",
    ]) {
      expect(isManualsScrapeRequest({ ...base, startUrl: url })).toBe(false);
    }
  });
});

describe("redirection : l'URL finale est re-vérifiée (#362)", () => {
  test("chaîne de redirection vers une cible privée : refusée AVANT le navigateur", async () => {
    resetState();
    // Chromium suit un 302 SANS repasser par le route handler (mesuré) :
    // la chaîne est donc vérifiée avant que le navigateur ne parte.
    stubFetch(() =>
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }),
    );
    await expect(
      scrapeManuals(CONFIG, { startUrl: PUBLIC_URL, resolveHost: PUBLIC_RESOLVER }),
    ).rejects.toThrow(ScrapeManualsError);
    expect(state.launched).toBe(0); // le navigateur n'est même pas lancé
    expect(state.contentCalls).toBe(0);
  });

  test("chaîne de redirections publique : acceptée, sauts suivis un par un", async () => {
    const seen: string[] = [];
    stubFetch((url) => {
      seen.push(url);
      return new Response(null, { status: 302, headers: { location: "https://manuels.example.invalid/6e/maths" } });
    });
    await assertPublicRedirectChain(PUBLIC_URL, undefined, PUBLIC_RESOLVER);
    expect(seen[0]).toBe(PUBLIC_URL);
    // La cible privée d'un 302 est refusée par la fonction de garde.
    stubFetch(() => new Response(null, { status: 302, headers: { location: "http://[::ffff:127.0.0.1]:9/x" } }));
    await expect(assertPublicRedirectChain(PUBLIC_URL, undefined, PUBLIC_RESOLVER)).rejects.toThrow(
      ScrapeManualsError,
    );
  });

  test("redirection interceptée : requête vers la cible privée coupée, aucun extrait", async () => {
    resetState();
    fake = { finalUrl: "http://[::ffff:127.0.0.1]:9/secret", routeSeesRedirect: true };
    await expect(
      scrapeManuals(CONFIG, { startUrl: PUBLIC_URL, resolveHost: PUBLIC_RESOLVER }),
    ).rejects.toThrow(ScrapeManualsError);
    expect(state.aborted).toContain("http://[::ffff:127.0.0.1]:9/secret");
    expect(state.contentCalls).toBe(0);
    expect(state.storageStatePaths).toEqual([]);
  });

  test("redirection qui échappe au route handler : l'URL finale est refusée quand même", async () => {
    resetState();
    fake = { finalUrl: "http://169.254.169.254/latest/meta-data/", routeSeesRedirect: false };
    await expect(
      scrapeManuals(CONFIG, { startUrl: PUBLIC_URL, resolveHost: PUBLIC_RESOLVER }),
    ).rejects.toThrow(ScrapeManualsError);
    expect(state.aborted).toEqual([]);
    expect(state.contentCalls).toBe(0);
    expect(state.storageStatePaths).toEqual([]);
  });

  test("URL publique : scrape normal, jar écrit sous le répertoire du serveur", async () => {
    resetState();
    fake = { finalUrl: PUBLIC_URL, routeSeesRedirect: true };
    const docs = await scrapeManuals(CONFIG, { startUrl: PUBLIC_URL, resolveHost: PUBLIC_RESOLVER });
    expect(docs).toHaveLength(1);
    expect(docs[0]?.excerpt).toContain("SECRET-INTERNAL-SERVICE");
    expect(state.contentCalls).toBe(1);
    expect(state.routePattern).toBe("**/*");
    expect(state.storageStatePaths).toEqual([DEFAULT_AUTH_FILE]);
  });
});

describe("garde SSRF : le NOM est résolu (#419)", () => {
  test("un nom public qui résout vers 127.0.0.1 est REFUSÉ (rebinding)", async () => {
    resetState();
    const resolve = fakeResolver({ "interne.example.invalid": ["127.0.0.1"] });
    const err = await refusal(
      scrapeManuals(CONFIG, { startUrl: "https://interne.example.invalid/secret", resolveHost: resolve }),
    );
    expect(err.reason).toBe("private_host");
    expect(err.message).toMatch(/hote prive/);
    // Le refus arrive AVANT le navigateur : aucune requête vers l'interne,
    // aucun extrait.
    expect(state.launched).toBe(0);
    expect(state.contentCalls).toBe(0);
  });

  test("une seule adresse privée suffit à refuser le nom (10.0.0.5)", async () => {
    resetState();
    const resolve = fakeResolver({ "interne.example.invalid": [PUBLIC_IP, "10.0.0.5"] });
    await expect(
      scrapeManuals(CONFIG, { startUrl: "https://interne.example.invalid/secret", resolveHost: resolve }),
    ).rejects.toThrow(ScrapeManualsError);
    expect(state.launched).toBe(0);
  });

  test("un nom public qui résout vers une IP publique est ACCEPTÉ", async () => {
    resetState();
    fake = { finalUrl: PUBLIC_URL, routeSeesRedirect: true };
    const docs = await scrapeManuals(CONFIG, { startUrl: PUBLIC_URL, resolveHost: PUBLIC_RESOLVER });
    expect(docs).toHaveLength(1);
    expect(state.launched).toBe(1);
  });

  test("un nom introuvable est refusé EXPLICITEMENT (jamais un silence)", async () => {
    resetState();
    const resolve = fakeResolver({}); // tout est ENOTFOUND
    const err = await refusal(scrapeManuals(CONFIG, { startUrl: PUBLIC_URL, resolveHost: resolve }));
    expect(err.reason).toBe("unresolved_host");
    expect(err.message).toMatch(/hote introuvable/);
    expect(state.launched).toBe(0);
  });

  test("le verdict de la garde : privé / public / introuvable", async () => {
    expect(
      await checkPublicHost("interne.example.invalid", fakeResolver({ "interne.example.invalid": ["127.0.0.1"] })),
    ).toBe("private");
    expect(
      await checkPublicHost("public.example.invalid", fakeResolver({ "public.example.invalid": [PUBLIC_IP] })),
    ).toBe("public");
    expect(await checkPublicHost("inconnu.example.invalid", fakeResolver({}))).toBe("unresolved");
    // Un littéral privé reste refusé SANS résolution (garde littérale #362).
    expect(await checkPublicHost("127.0.0.1", fakeResolver({}))).toBe("private");
    expect(await checkPublicHost("169.254.169.254", fakeResolver({}))).toBe("private");
  });

  test("un littéral public ne déclenche AUCUNE résolution (v4 et v6)", async () => {
    const resolve = async (): Promise<readonly string[]> => {
      throw new Error("resolution DNS inattendue");
    };
    expect(await checkPublicHost("8.8.8.8", resolve)).toBe("public");
    expect(await checkPublicHost("[2606:4700::1111]", resolve)).toBe("public");
  });

  test("redirection vers un nom privé : refusée AVANT le navigateur", async () => {
    resetState();
    stubFetch(() =>
      new Response(null, { status: 302, headers: { location: "https://interne.example.invalid/secret" } }),
    );
    const resolve = fakeResolver({
      "manuels.example.invalid": [PUBLIC_IP],
      "interne.example.invalid": ["127.0.0.1"],
    });
    await expect(assertPublicRedirectChain(PUBLIC_URL, undefined, resolve)).rejects.toThrow(ScrapeManualsError);
    expect(state.launched).toBe(0);
  });

  test("le route handler résout le nom : une navigation rebindée est COUPÉE", async () => {
    resetState();
    fake = { finalUrl: "https://interne.example.invalid/secret", routeSeesRedirect: true };
    const resolve = fakeResolver({
      "manuels.example.invalid": [PUBLIC_IP],
      "interne.example.invalid": ["127.0.0.1"],
    });
    // La requête vers le nom privé est coupée AVANT le réseau, et le scrape
    // est refusé (document bloqué) : aucun extrait.
    const err = await refusal(scrapeManuals(CONFIG, { startUrl: PUBLIC_URL, resolveHost: resolve }));
    expect(err.reason).toBe("private_host");
    expect(state.aborted).toContain("https://interne.example.invalid/secret");
    expect(state.continued).not.toContain("https://interne.example.invalid/secret");
    expect(state.contentCalls).toBe(0);
  });

  test("l'URL FINALE (après navigation) est résolue : un nom privé est refusé", async () => {
    resetState();
    // La redirection échappe au route handler (Chromium ne le rappelle pas) :
    // seule la re-vérification de l'URL FINALE rattrape le nom rebindé.
    fake = { finalUrl: "https://interne.example.invalid/secret", routeSeesRedirect: false };
    const resolve = fakeResolver({
      "manuels.example.invalid": [PUBLIC_IP],
      "interne.example.invalid": ["127.0.0.1"],
    });
    const err = await refusal(scrapeManuals(CONFIG, { startUrl: PUBLIC_URL, resolveHost: resolve }));
    expect(err.reason).toBe("private_host");
    expect(state.contentCalls).toBe(0);
    expect(state.storageStatePaths).toEqual([]);
  });

  test("le refus SSRF est EXPLICITE côté HTTP (403 private_host), navigateur jamais lancé", async () => {
    resetState();
    // Bout en bout : le VRAI scraper (Playwright mocké) + un faux résolveur.
    const app = createApp({
      scrape: scrapeManuals,
      resolveHost: fakeResolver({ "interne.example.invalid": ["127.0.0.1"] }),
    });
    const res = await app.handler(
      new Request("http://127.0.0.1/v1/manuals/scrape", {
        method: "POST",
        body: JSON.stringify({
          platform: "editeur-fake",
          username: "u",
          password: "p",
          startUrl: "https://interne.example.invalid/secret",
        }),
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()) as unknown).toMatchObject({ error: { code: "private_host" } });
    // Le refus arrive avant le navigateur : aucune requête vers l'interne.
    expect(state.launched).toBe(0);
    expect(state.contentCalls).toBe(0);
  });

  test("un nom introuvable est EXPLICITE côté HTTP (502 unresolved_host)", async () => {
    resetState();
    const app = createApp({ scrape: scrapeManuals, resolveHost: fakeResolver({}) });
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
    // Jamais un « scrape impossible » trompeur : c'est le DNS qui ne répond pas.
    expect(res.status).toBe(502);
    expect((await res.json()) as unknown).toMatchObject({ error: { code: "unresolved_host" } });
    expect(state.launched).toBe(0);
  });
});

describe("authFile : plus piloté par l'appelant (#362)", () => {
  test("un chemin hors périmètre est refusé et AUCUN fichier n'est écrit", async () => {
    resetState();
    const dir = mkdtempSync(join(tmpdir(), "vsn-authfile-"));
    const victim = join(dir, "victim.json");
    writeFileSync(victim, "ORIGINAL");
    try {
      await expect(
        scrapeManuals(CONFIG, { startUrl: PUBLIC_URL, authFile: victim, resolveHost: PUBLIC_RESOLVER }),
      ).rejects.toThrow(ScrapeManualsError);
      // Le fichier est intact, le navigateur n'est même pas lancé, aucun jar
      // n'est écrit : le refus arrive AVANT toute écriture.
      expect(readFileSync(victim, "utf8")).toBe("ORIGINAL");
      expect(state.launched).toBe(0);
      expect(state.storageStatePaths).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("tout chemin (absolu, relatif, « .. ») est refusé", () => {
    for (const p of [
      "shared/contracts/api.ts",
      "../jar.json",
      "/etc/passwd",
      "playwright/.auth/x.json",
      "..",
      "x/../y.json",
      "  ",
      "jar.txt",
    ]) {
      expect(() => resolveAuthFile(p)).toThrow(ScrapeManualsError);
    }
  });

  test("un NOM valide reste sous le répertoire imposé par le serveur", () => {
    expect(resolveAuthFile("manuel.json")).toBe(join("playwright/.auth", "manuel.json"));
    expect(resolveAuthFile(undefined)).toBe(DEFAULT_AUTH_FILE);
    // Le jar par défaut est choisi par l'exploitant du serveur, pas par
    // l'appelant de l'API : il passe tel quel.
    expect(resolveAuthFile(undefined, "/var/lib/scraper/jar.json")).toBe("/var/lib/scraper/jar.json");
  });

  test("le contrat n'accepte plus un chemin de jar", () => {
    const base = { platform: "p", username: "u", password: "m", startUrl: PUBLIC_URL };
    expect(isManualsScrapeRequest({ ...base, authFile: "manuel.json" })).toBe(true);
    for (const p of ["playwright/.auth/x.json", "../jar.json", "/etc/passwd", "..", "jar.txt"]) {
      expect(isManualsScrapeRequest({ ...base, authFile: p })).toBe(false);
    }
  });
});
