import { describe, expect, test } from "bun:test";
import { PronoteHttpClient } from "../../server/integrations/PronoteHttpClient";
import { PronoteAuthProvider } from "../../server/integrations/pronote-auth";
import { PronoteLectureProvider } from "../../server/integrations/pronote-lectures";
import { PronoteReadError } from "../../server/domain/ports";
import { isAssignment, isGrade, isTimetableEntry } from "../../shared/contracts/models";
import {
  syntheticAccountId,
  syntheticAssignment,
  syntheticAssignmentsOk,
  syntheticAuthSuccess,
  syntheticAuthToken,
  syntheticBaseUrl,
  syntheticDeviceUuid,
  syntheticEntKind,
  syntheticGrade,
  syntheticGradesOk,
  syntheticPassword,
  syntheticTimetableEntry,
  syntheticTimetableOk,
  syntheticUsername,
} from "./fixtures/pronote";

function okJson(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

const creds = {
  accountId: syntheticAccountId,
  username: syntheticUsername,
  password: syntheticPassword,
  entKind: syntheticEntKind,
};

async function makeLectures(fetchFn: typeof fetch, logs: string[] = []) {
  const client = new PronoteHttpClient({
    baseUrl: syntheticBaseUrl,
    deviceUuid: syntheticDeviceUuid,
    retryDelayMs: 1,
    fetchFn,
  });
  const auth = new PronoteAuthProvider({ client });
  await auth.authenticate(creds);
  const lectures = new PronoteLectureProvider({
    client,
    sessions: auth,
    logger: (m) => logs.push(m),
  });
  return { auth, lectures };
}

describe("PronoteLectureProvider", () => {
  test("grades OK typées + pagination + Untrusted", async () => {
    const seen: string[] = [];
    const headers: Record<string, string>[] = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      seen.push(u);
      headers.push({ ...(init?.headers as Record<string, string>) });
      if (u.includes("/auth")) return okJson(syntheticAuthSuccess);
      return okJson(syntheticGradesOk);
    }) as unknown as typeof fetch;
    const logs: string[] = [];
    const { lectures } = await makeLectures(fetchFn, logs);

    const page = await lectures.getGrades(syntheticAccountId, { limit: 10 });
    expect(page.items.__untrusted).toBe(true);
    expect(page.items.value).toHaveLength(1);
    expect(isGrade(page.items.value[0])).toBe(true);
    expect(page.items.value[0]?.id).toBe(syntheticGrade.id);
    expect(page.nextCursor).toBe("cur-fake-2");

    // Token en header, jamais en URL/query.
    const gradeUrl = seen.find((u) => u.includes("/grades")) ?? "";
    expect(gradeUrl).not.toContain(syntheticAuthToken);
    expect(gradeUrl).toContain("limit=10");
    const gradeHeaders = headers[seen.indexOf(gradeUrl)] ?? {};
    expect(gradeHeaders["Authorization"]).toBe(`Bearer ${syntheticAuthToken}`);
    // Logs sans secret.
    expect(logs.join("\n")).not.toContain(syntheticAuthToken);
    expect(logs.join("\n")).not.toContain(syntheticPassword);
  });

  test("assignments + timetable OK, contrats valides", async () => {
    const fetchFn = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/auth")) return okJson(syntheticAuthSuccess);
      if (u.includes("/assignments")) return okJson(syntheticAssignmentsOk);
      return okJson(syntheticTimetableOk);
    }) as unknown as typeof fetch;
    const { lectures } = await makeLectures(fetchFn);

    const a = await lectures.getAssignments(syntheticAccountId);
    expect(a.items.__untrusted).toBe(true);
    expect(a.items.value).toHaveLength(1);
    expect(isAssignment(a.items.value[0])).toBe(true);
    expect(a.items.value[0]?.id).toBe(syntheticAssignment.id);
    expect(a.nextCursor).toBeNull();

    const t = await lectures.getTimetable(syntheticAccountId, {
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-07T00:00:00.000Z",
    });
    expect(t.items.__untrusted).toBe(true);
    expect(isTimetableEntry(t.items.value[0])).toBe(true);
    expect(t.items.value[0]?.id).toBe(syntheticTimetableEntry.id);
  });

  test("réponse array nue acceptée, invalides filtrés", async () => {
    const fetchFn = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/auth")) return okJson(syntheticAuthSuccess);
      return okJson([syntheticGrade, { ...syntheticGrade, id: "  ", value: -5 }]);
    }) as unknown as typeof fetch;
    const { lectures } = await makeLectures(fetchFn);
    const page = await lectures.getGrades(syntheticAccountId);
    expect(page.items.value).toHaveLength(1);
    expect(page.items.value[0]?.id).toBe(syntheticGrade.id);
    expect(page.nextCursor).toBeNull();
  });

  test("401/403 -> session_expired, sans session -> session_expired", async () => {
    for (const status of [401, 403]) {
      const fetchFn = (async (url: string | URL | Request) => {
        const u = String(url);
        if (u.includes("/auth")) return okJson(syntheticAuthSuccess);
        return new Response("nope", { status });
      }) as unknown as typeof fetch;
      const { lectures } = await makeLectures(fetchFn);
      const err = await lectures.getGrades(syntheticAccountId).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PronoteReadError);
      expect((err as PronoteReadError).code).toBe("session_expired");
    }
    // Sans session (mauvais accountId) -> session_expired sans appel réseau lectures.
    const fetchFn = (async (url: string | URL | Request) => {
      if (String(url).includes("/auth")) return okJson(syntheticAuthSuccess);
      throw new Error("ne doit pas appeler lectures sans session");
    }) as unknown as typeof fetch;
    const client = new PronoteHttpClient({
      baseUrl: syntheticBaseUrl,
      deviceUuid: syntheticDeviceUuid,
      retryDelayMs: 1,
      fetchFn,
    });
    const auth = new PronoteAuthProvider({ client });
    const lectures = new PronoteLectureProvider({ client, sessions: auth });
    const err = await lectures.getGrades("acc-inconnu").catch((e: unknown) => e);
    expect((err as PronoteReadError).code).toBe("session_expired");
    const errEmpty = await lectures.getGrades("  ").catch((e: unknown) => e);
    expect((errEmpty as PronoteReadError).code).toBe("session_expired");
  });

  test("5xx / forme invalide -> ent_unavailable", async () => {
    const badFetch = (async (url: string | URL | Request) => {
      if (String(url).includes("/auth")) return okJson(syntheticAuthSuccess);
      return new Response("oups", { status: 500 });
    }) as unknown as typeof fetch;
    const { lectures: l5xx } = await makeLectures(badFetch);
    expect((await l5xx.getGrades(syntheticAccountId).catch((e: unknown) => e) as PronoteReadError).code).toBe(
      "ent_unavailable",
    );

    const shapeFetch = (async (url: string | URL | Request) => {
      if (String(url).includes("/auth")) return okJson(syntheticAuthSuccess);
      return okJson({ nope: 1 });
    }) as unknown as typeof fetch;
    const { lectures: lBad } = await makeLectures(shapeFetch);
    expect((await lBad.getAssignments(syntheticAccountId).catch((e: unknown) => e) as PronoteReadError).code).toBe(
      "ent_unavailable",
    );
  });

  test("network/timeout mappés, zero secret en log", async () => {
    const netFail = (async (url: string | URL | Request) => {
      if (String(url).includes("/auth")) return okJson(syntheticAuthSuccess);
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const netLogs: string[] = [];
    const { lectures: lNet } = await makeLectures(netFail, netLogs);
    // retryDelay 1ms + 1 retry : échec final network.
    expect((await lNet.getGrades(syntheticAccountId).catch((e: unknown) => e) as PronoteReadError).code).toBe("network");

    const hanging = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/auth")) return okJson(syntheticAuthSuccess);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "TimeoutError"));
        });
      });
    }) as unknown as typeof fetch;
    const timeoutClient = new PronoteHttpClient({
      baseUrl: syntheticBaseUrl,
      deviceUuid: syntheticDeviceUuid,
      timeoutMs: 20,
      retryDelayMs: 1,
      fetchFn: hanging,
    });
    const timeoutAuth = new PronoteAuthProvider({ client: timeoutClient });
    await timeoutAuth.authenticate(creds);
    const timeoutLogs: string[] = [];
    const lTimeout = new PronoteLectureProvider({
      client: timeoutClient,
      sessions: timeoutAuth,
      logger: (m) => timeoutLogs.push(m),
    });
    expect((await lTimeout.getGrades(syntheticAccountId).catch((e: unknown) => e) as PronoteReadError).code).toBe(
      "timeout",
    );

    for (const logs of [netLogs, timeoutLogs]) {
      expect(logs.join("\n")).not.toContain(syntheticAuthToken);
      expect(logs.join("\n")).not.toContain(syntheticPassword);
    }
  });

  test("timetable from/to invalides -> ent_unavailable", async () => {
    const fetchFn = (async (url: string | URL | Request) => {
      if (String(url).includes("/auth")) return okJson(syntheticAuthSuccess);
      return okJson(syntheticTimetableOk);
    }) as unknown as typeof fetch;
    const { lectures } = await makeLectures(fetchFn);
    for (const bad of [{ from: "pas-une-date" }, { to: "xxx" }]) {
      const err = await lectures.getTimetable(syntheticAccountId, bad).catch((e: unknown) => e);
      expect((err as PronoteReadError).code).toBe("ent_unavailable");
    }
  });
});
