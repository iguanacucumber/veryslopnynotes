import { describe, expect, test } from "bun:test";
import { PronoteHttpClient } from "../../server/integrations/PronoteHttpClient";
import { PronoteAuthProvider } from "../../server/integrations/pronote-auth";
import { PronoteAuthError } from "../../server/domain/ports";
import {
  syntheticAccountId,
  syntheticAuthSuccess,
  syntheticAuthToken,
  syntheticBaseUrl,
  syntheticDeviceUuid,
  syntheticEntKind,
  syntheticPassword,
  syntheticUsername,
} from "./fixtures/pronote";

function okJson(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

function makeSetup(fetchFn: typeof fetch, clientLogs: string[] = [], authLogs: string[] = []) {
  const client = new PronoteHttpClient({
    baseUrl: syntheticBaseUrl,
    deviceUuid: syntheticDeviceUuid,
    retryDelayMs: 1,
    logger: (m) => clientLogs.push(m),
    fetchFn,
  });
  const auth = new PronoteAuthProvider({ client, logger: (m) => authLogs.push(m) });
  return { client, auth };
}

const creds = {
  accountId: syntheticAccountId,
  username: syntheticUsername,
  password: syntheticPassword,
  entKind: syntheticEntKind,
};

describe("PronoteAuthProvider", () => {
  test("auth OK + sessions isolées par accountId", async () => {
    const seen: string[] = [];
    const bodies: string[] = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push(String(url));
      bodies.push(String(init?.body ?? ""));
      return okJson(syntheticAuthSuccess);
    }) as unknown as typeof fetch;
    const clientLogs: string[] = [];
    const authLogs: string[] = [];
    const { auth } = makeSetup(fetchFn, clientLogs, authLogs);

    const session = await auth.authenticate(creds);
    expect(session.accountId).toBe(syntheticAccountId);
    expect(auth.isAuthenticated(syntheticAccountId)).toBe(true);
    expect(auth.getSessionToken(syntheticAccountId)).toBe(syntheticAuthToken);
    // Second compte isolé : pas de session pré-existante.
    expect(auth.isAuthenticated("acc-fake-2")).toBe(false);
    expect(auth.getSessionToken("acc-fake-2")).toBeNull();
    await auth.authenticate({ ...creds, accountId: "acc-fake-2" });
    expect(auth.getSessionToken(syntheticAccountId)).toBe(syntheticAuthToken);
    expect(auth.getSessionToken("acc-fake-2")).toBe(syntheticAuthToken);

    // Secrets en body uniquement, jamais en URL/path/query.
    expect(seen[0]).not.toContain(syntheticPassword);
    expect(seen[0]).not.toContain(syntheticAuthToken);
    expect(bodies.join("\n")).toContain(syntheticPassword);
    // Logs sans secret.
    const joined = [...clientLogs, ...authLogs].join("\n");
    expect(joined).not.toContain(syntheticPassword);
    expect(joined).not.toContain(syntheticAuthToken);
  });

  test("401/403 -> invalid_credentials, erreur propre sans secret", async () => {
    for (const status of [401, 403]) {
      const fetchFn = (async () => new Response("nope", { status })) as unknown as typeof fetch;
      const clientLogs: string[] = [];
      const authLogs: string[] = [];
      const { auth } = makeSetup(fetchFn, clientLogs, authLogs);
      const err = await auth.authenticate(creds).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PronoteAuthError);
      expect((err as PronoteAuthError).code).toBe("invalid_credentials");
      expect((err as Error).message).not.toContain(syntheticPassword);
      expect((err as Error).message).not.toContain(syntheticAuthToken);
      const joined = [...clientLogs, ...authLogs].join("\n");
      expect(joined).not.toContain(syntheticPassword);
      expect(joined).not.toContain(syntheticAuthToken);
      expect(auth.isAuthenticated(syntheticAccountId)).toBe(false);
    }
  });

  test("5xx / réponse invalide -> ent_unavailable", async () => {
    const badFetch = (async () => new Response("oups", { status: 500 })) as unknown as typeof fetch;
    const { auth: auth5xx } = makeSetup(badFetch);
    const err5xx = await auth5xx.authenticate(creds).catch((e: unknown) => e);
    expect((err5xx as PronoteAuthError).code).toBe("ent_unavailable");

    const invalidShape = (async () => okJson({ nope: 1 })) as unknown as typeof fetch;
    const { auth: authBad } = makeSetup(invalidShape);
    const errBad = await authBad.authenticate(creds).catch((e: unknown) => e);
    expect((errBad as PronoteAuthError).code).toBe("ent_unavailable");
  });

  test("network/timeout mappés, zero secret en log", async () => {
    const netFail = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const netLogs: string[] = [];
    const { auth: authNet } = makeSetup(netFail, [], netLogs);
    const errNet = await authNet.authenticate(creds).catch((e: unknown) => e);
    expect((errNet as PronoteAuthError).code).toBe("network");

    const hanging = (async (_url: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "TimeoutError"));
        });
      });
    }) as unknown as typeof fetch;
    const timeoutLogs: string[] = [];
    const timeoutClient = new PronoteHttpClient({
      baseUrl: syntheticBaseUrl,
      deviceUuid: syntheticDeviceUuid,
      timeoutMs: 20,
      retryDelayMs: 1,
      fetchFn: hanging,
    });
    const authTimeout = new PronoteAuthProvider({
      client: timeoutClient,
      logger: (m) => timeoutLogs.push(m),
    });
    const errTimeout = await authTimeout.authenticate(creds).catch((e: unknown) => e);
    expect((errTimeout as PronoteAuthError).code).toBe("timeout");

    for (const logs of [netLogs, timeoutLogs]) {
      const joined = logs.join("\n");
      expect(joined).not.toContain(syntheticPassword);
      expect(joined).not.toContain(syntheticAuthToken);
    }
  });

  test("validation vide -> invalid_credentials", async () => {
    const fetchFn = (async () => okJson(syntheticAuthSuccess)) as unknown as typeof fetch;
    const { auth } = makeSetup(fetchFn);
    for (const bad of [
      { ...creds, accountId: "  " },
      { ...creds, username: "" },
      { ...creds, password: "" },
      { ...creds, entKind: "" },
    ]) {
      const err = await auth.authenticate(bad).catch((e: unknown) => e);
      expect((err as PronoteAuthError).code).toBe("invalid_credentials");
    }
  });

  test("invalidate + session_expired + re-auth OK (changement IP)", async () => {
    const fetchFn = (async () => okJson(syntheticAuthSuccess)) as unknown as typeof fetch;
    const { auth } = makeSetup(fetchFn);
    await auth.authenticate(creds);
    expect(auth.requireSessionToken(syntheticAccountId)).toBe(syntheticAuthToken);
    // Changement IP : session serveur invalide → purge locale puis re-auth.
    auth.invalidate(syntheticAccountId);
    expect(auth.isAuthenticated(syntheticAccountId)).toBe(false);
    let code = "";
    try {
      auth.requireSessionToken(syntheticAccountId);
    } catch (e) {
      code = (e as PronoteAuthError).code;
    }
    expect(code).toBe("session_expired");
    const session = await auth.authenticate(creds);
    expect(session.accountId).toBe(syntheticAccountId);
    expect(auth.requireSessionToken(syntheticAccountId)).toBe(syntheticAuthToken);
  });
});
