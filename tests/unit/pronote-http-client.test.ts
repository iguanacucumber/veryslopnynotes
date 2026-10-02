import { describe, expect, test } from "bun:test";
import { PronoteHttpClient, PronoteHttpError } from "../../server/integrations/PronoteHttpClient";
import { syntheticBaseUrl, syntheticDeviceUuid, syntheticSampleGrades } from "./fixtures/pronote";

function okJson(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

describe("PronoteHttpClient", () => {
  test("baseUrl injectée, pas de défaut", async () => {
    const seen: string[] = [];
    const fetchFn = (async (url: string | URL | Request) => {
      seen.push(String(url));
      return okJson({ ok: true });
    }) as unknown as typeof fetch;
    const client = new PronoteHttpClient({
      baseUrl: syntheticBaseUrl,
      deviceUuid: syntheticDeviceUuid,
      fetchFn,
    });
    await client.request("/grades");
    expect(seen[0]?.startsWith(syntheticBaseUrl)).toBe(true);
    expect(() => new PronoteHttpClient({ baseUrl: "", deviceUuid: syntheticDeviceUuid })).toThrow();
  });

  test("timeout déclenché (abort)", async () => {
    let calls = 0;
    const hanging = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls++;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "TimeoutError"));
        });
      });
    }) as unknown as typeof fetch;
    const client = new PronoteHttpClient({
      baseUrl: syntheticBaseUrl,
      deviceUuid: syntheticDeviceUuid,
      timeoutMs: 20,
      retryDelayMs: 1,
      fetchFn: hanging,
    });
    const err = await client.request("/grades").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PronoteHttpError);
    expect((err as PronoteHttpError).code).toBe("timeout");
    expect(calls).toBe(1);
  });

  test("retry 1x sur 5xx puis succès", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      if (calls === 1) return new Response("oups", { status: 500 });
      return okJson(syntheticSampleGrades, 200);
    }) as unknown as typeof fetch;
    const logs: string[] = [];
    const client = new PronoteHttpClient({
      baseUrl: syntheticBaseUrl,
      deviceUuid: syntheticDeviceUuid,
      retryDelayMs: 1,
      logger: (m) => logs.push(m),
      fetchFn,
    });
    const res = await client.request("/grades");
    expect(res).toEqual(syntheticSampleGrades);
    expect(calls).toBe(2);
    expect(logs.some((l) => l.includes("500"))).toBe(true);
  });

  test("pas de retry sur 4xx", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      return new Response("nope", { status: 404 });
    }) as unknown as typeof fetch;
    const client = new PronoteHttpClient({
      baseUrl: syntheticBaseUrl,
      deviceUuid: syntheticDeviceUuid,
      retryDelayMs: 1,
      fetchFn,
    });
    const err = await client.request("/grades").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PronoteHttpError);
    expect((err as PronoteHttpError).status).toBe(404);
    expect((err as PronoteHttpError).code).toBe("http_4xx");
    expect(calls).toBe(1);
  });

  test("logging sans secret", async () => {
    const fakePassword = "fake-pw-9x8y7z-UNREAL";
    const fakeToken = "fake-tok-abc123-UNREAL";
    const logs: string[] = [];
    const fetchFn = (async () => okJson({ ok: true })) as unknown as typeof fetch;
    const client = new PronoteHttpClient({
      baseUrl: syntheticBaseUrl,
      deviceUuid: syntheticDeviceUuid,
      logger: (m) => logs.push(m),
      fetchFn,
    });
    await client.request("/grades", {
      method: "POST",
      body: { user: "fake-user", password: fakePassword, token: fakeToken },
    });
    expect(logs.length).toBeGreaterThan(0);
    const joined = logs.join("\n");
    expect(joined).toContain("POST");
    expect(joined).toContain("200");
    expect(joined).not.toContain(fakePassword);
    expect(joined).not.toContain(fakeToken);
  });

  test("requêtes sérialisées (ordre)", async () => {
    const events: string[] = [];
    const fetchFn = (async (url: string | URL | Request) => {
      const path = String(url).endsWith("/a") ? "/a" : "/b";
      events.push(`start:${path}`);
      if (path === "/a") await new Promise((r) => setTimeout(r, 30));
      events.push(`end:${path}`);
      return okJson({ path });
    }) as unknown as typeof fetch;
    const client = new PronoteHttpClient({
      baseUrl: syntheticBaseUrl,
      deviceUuid: syntheticDeviceUuid,
      retryDelayMs: 1,
      fetchFn,
    });
    const [ra, rb] = await Promise.all([client.request("/a"), client.request("/b")]);
    expect(ra).toEqual({ path: "/a" });
    expect(rb).toEqual({ path: "/b" });
    expect(events).toEqual(["start:/a", "end:/a", "start:/b", "end:/b"]);
  });
});
