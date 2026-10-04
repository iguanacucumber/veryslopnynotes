import { describe, expect, test } from "bun:test";
import {
  HttpPushProvider,
  NoopPushProvider,
  PushError,
  createPushProvider,
  hashToken,
  shortHash,
} from "../../server/infrastructure/push-provider";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const FAKE_PUBLIC = "FAKE-PUBLIC-UNREAL-123";
const FAKE_PRIVATE = "FAKE-PRIVATE-UNREAL-456";

// 0.7.0 : config INJECTÉE (plus de lecture env — le serveur ne détient aucun
// credential). Clés VAPID factices, jamais valides.
const FULL_CONFIG = {
  provider: "https://push.example.invalid/send",
  vapidPublicKey: FAKE_PUBLIC,
  vapidPrivateKey: FAKE_PRIVATE,
  subject: "mailto:push@example.invalid",
};

function okFetch(seen: { url?: string; init?: RequestInit }, status = 200) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    seen.url = String(url);
    seen.init = init;
    return new Response("{}", { status });
  }) as unknown as typeof fetch;
}

describe("unit push", () => {
  test("hashToken sha256 hex64 stable et distinct", () => {
    const h1 = hashToken("tok-1");
    const h2 = hashToken("tok-1");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("tok-2")).not.toBe(h1);
  });

  test("shortHash = préfixe 8, jamais le hash complet", () => {
    const s = shortHash(HASH_A);
    expect(s).toContain(HASH_A.slice(0, 8));
    expect(s).not.toContain(HASH_A);
    expect(s.length).toBeLessThan(HASH_A.length);
  });

  test("HttpPushProvider : config incomplète refusée à la construction", () => {
    expect(
      () =>
        new HttpPushProvider(
          { provider: "", vapidPublicKey: "", vapidPrivateKey: "", subject: "" },
          {},
        ),
    ).toThrow();
  });

  test("Noop résout + log préfixe seul", async () => {
    const logs: string[] = [];
    await new NoopPushProvider({ logger: (m) => logs.push(m) }).send(HASH_A, {
      title: "Note",
      body: "15 en Maths",
    });
    expect(logs.join("\n")).toContain(HASH_A.slice(0, 8));
    expect(logs.join("\n")).not.toContain(HASH_A);
  });

  test("Http envoie POST JSON + headers publics, log sans secret", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const logs: string[] = [];
    const p = new HttpPushProvider(FULL_CONFIG, {
      fetchFn: okFetch(seen, 201),
      logger: (m) => logs.push(m),
    });
    // Config chargée depuis env (clés VAPID présentes, privée jamais sur le fil).
    await p.send(HASH_A, { title: "Note", body: "Nouvelle note" });
    expect(seen.url).toBe("https://push.example.invalid/send");
    const headers = (seen.init?.headers ?? {}) as Record<string, string>;
    expect(headers["authorization"]).toContain(FAKE_PUBLIC);
    expect(headers["authorization"]).not.toContain(FAKE_PRIVATE);
    expect(JSON.stringify(headers)).not.toContain(FAKE_PRIVATE);
    const body = String(seen.init?.body ?? "");
    expect(body).toContain(HASH_A);
    expect(body).toContain("Note");
    const joined = logs.join("\n");
    expect(joined).toContain(HASH_A.slice(0, 8));
    expect(joined).not.toContain(HASH_A);
    expect(joined).not.toContain(FAKE_PUBLIC);
    expect(joined).not.toContain(FAKE_PRIVATE);
  });

  test("Http provider symbolique → skip sans fetch", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const logs: string[] = [];
    const p = new HttpPushProvider(
      { provider: "webpush", vapidPublicKey: FAKE_PUBLIC, vapidPrivateKey: FAKE_PRIVATE, subject: "mailto:x@y.invalid" },
      { fetchFn, logger: (m) => logs.push(m) },
    );
    await p.send(HASH_B, { title: "DS", body: "DS maths demain" });
    expect(calls).toBe(0);
    expect(logs.join("\n")).toContain("skip");
  });

  test("Http 4xx/5xx → PushError + log statut, réseau → PushError", async () => {
    const bad = new HttpPushProvider(FULL_CONFIG, {
      fetchFn: okFetch({}, 404),
      logger: () => {},
    });
    const err404 = await bad.send(HASH_A, { title: "t", body: "b" }).catch((e: unknown) => e);
    expect(err404).toBeInstanceOf(PushError);
    expect((err404 as PushError).status).toBe(404);

    const down = new HttpPushProvider(FULL_CONFIG, {
      fetchFn: (async () => {
        throw new Error("down");
      }) as unknown as typeof fetch,
      logger: () => {},
    });
    const errNet = await down.send(HASH_A, { title: "t", body: "b" }).catch((e: unknown) => e);
    expect(errNet).toBeInstanceOf(PushError);
  });

  test("validation : hash/token/title/body invalides rejetés", async () => {
    const p = new NoopPushProvider();
    await expect(p.send("", { title: "t", body: "b" })).rejects.toBeInstanceOf(PushError);
    await expect(p.send("not-hex", { title: "t", body: "b" })).rejects.toBeInstanceOf(PushError);
    await expect(p.send(HASH_A, { title: "  ", body: "b" })).rejects.toBeInstanceOf(PushError);
    await expect(p.send(HASH_A, { title: "t", body: "" })).rejects.toBeInstanceOf(PushError);
    expect(() =>
      new HttpPushProvider(
        { provider: "", vapidPublicKey: "", vapidPrivateKey: "", subject: "" },
        {},
      ),
    ).toThrow();
  });

  test("createPushProvider : noop sans config, http avec config", async () => {
    const noop = createPushProvider(null);
    expect(noop).toBeInstanceOf(NoopPushProvider);
    const http = createPushProvider(FULL_CONFIG);
    expect(http).toBeInstanceOf(HttpPushProvider);
  });
});
