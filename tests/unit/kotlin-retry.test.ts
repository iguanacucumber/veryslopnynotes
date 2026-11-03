// #874 : réessai BORNÉ des seules lectures idempotentes. Le VRAI
// `ClientBase.post` est rejoué par le pilote, avec attente et horloge
// FACTICES : le nombre de tentatives, l'échéance et le jitter sont
// déterministes. Outillage absent = SKIP BRUYANT.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "RetryParityMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

const WRITE = "SaisieMessage";

interface Step {
  kind: string;
  retryAfterMs?: number;
}

interface RunOptions {
  function?: string;
  outcomes: Step[];
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  budgetMs?: number;
  random?: number;
}

interface RunResult {
  sends: number;
  refreshes: number;
  delays: number[];
  error: string | null;
}

async function run(opts: RunOptions): Promise<RunResult> {
  return JSON.parse(await link!.ask({ op: "run", ...opts })) as RunResult;
}

async function classify(kind: string): Promise<boolean> {
  const line = await link!.ask({ op: "classify", step: { kind } });
  return (JSON.parse(line) as { transient: boolean }).transient;
}

async function delay(opts: Record<string, number>): Promise<number | null> {
  const line = await link!.ask({ op: "delay", ...opts });
  return (JSON.parse(line) as { delay: number | null }).delay;
}

describe("réessai borné des lectures idempotentes (#874)", () => {
  test.skipIf(skip)("un 5xx passager : deux réessais, trois envois au plus", async () => {
    const r = await run({
      outcomes: [{ kind: "http503" }, { kind: "http503" }, { kind: "ok" }],
      random: 1,
    });
    expect(r).toEqual({
      sends: 3,
      refreshes: 0,
      delays: [250, 500],
      error: null,
    });
  });

  test.skipIf(skip)("un 5xx persistant s'ARRÊTE à maxAttempts", async () => {
    const r = await run({
      outcomes: [{ kind: "http503" }, { kind: "http503" }, { kind: "http503" }, { kind: "http503" }],
      maxAttempts: 3,
    });
    expect(r.sends).toBe(3);
    expect(r.delays).toHaveLength(2);
    expect(r.error).toBe("PronoteAPIError");
  });

  test.skipIf(skip)("maxAttempts est un plafond dur, pas une suggestion", async () => {
    const r = await run({
      outcomes: [{ kind: "http500" }, { kind: "http500" }, { kind: "ok" }],
      maxAttempts: 2,
    });
    expect(r.sends).toBe(2);
    expect(r.error).toBe("PronoteAPIError");
  });

  test.skipIf(skip)("panne de transport (IO, timeout) : réessayée", async () => {
    for (const kind of ["io", "timeout"]) {
      const r = await run({ outcomes: [{ kind }, { kind: "ok" }] });
      expect({ kind, ...r }).toEqual({
        kind,
        sends: 2,
        refreshes: 0,
        delays: [250],
        error: null,
      });
    }
  });

  test.skipIf(skip)("TLS et certificat : AUCUN réessai", async () => {
    for (const [kind, error] of [
      ["tls", "SSLHandshakeException"],
      ["cert", "CertificateException"],
    ] as const) {
      const r = await run({ outcomes: [{ kind }, { kind: "ok" }] });
      expect({ kind, sends: r.sends, delays: r.delays, error: r.error }).toEqual({
        kind,
        sends: 1,
        delays: [],
        error,
      });
    }
  });

  test.skipIf(skip)("4xx, rate-limit et objets typés : AUCUN réessai", async () => {
    for (const [kind, error] of [
      ["http403", "PronoteAPIError"],
      ["http404", "PronoteAPIError"],
      ["http429", "RateLimitedError"],
      ["g22", "ExpiredObject"],
      ["g25", "RateLimitedError"],
      ["g99", "PronoteAPIError"],
      ["cancelled", "RequestCancelled"],
    ] as const) {
      const r = await run({ outcomes: [{ kind }, { kind: "ok" }] });
      expect({ kind, sends: r.sends, delays: r.delays, error: r.error }).toEqual({
        kind,
        sends: 1,
        delays: [],
        error,
      });
    }
  });

  test.skipIf(skip)("écriture non idempotente : JAMAIS réessayée, même sur 5xx/IO", async () => {
    for (const kind of ["http500", "http503", "io", "timeout"]) {
      const r = await run({ function: WRITE, outcomes: [{ kind }, { kind: "ok" }] });
      expect({ kind, sends: r.sends, delays: r.delays }).toEqual({
        kind,
        sends: 1,
        delays: [],
      });
    }
  });

  test.skipIf(skip)("401/G=10 : le rejeu d'auth reste UNIQUE, hors réessai transitoire", async () => {
    for (const kind of ["http401", "g10"]) {
      const r = await run({ outcomes: [{ kind }, { kind }, { kind: "ok" }] });
      // Envoi 1 refusé -> refresh -> rejeu 2 refusé : l'auth ne se réessaie pas.
      expect({ kind, ...r }).toEqual({
        kind,
        sends: 2,
        refreshes: 1,
        delays: [],
        error: "PronoteAPIError",
      });
    }
  });

  test.skipIf(skip)("auth puis 5xx : un refresh unique, le 5xx lui-même est réessayé", async () => {
    const r = await run({
      outcomes: [{ kind: "http401" }, { kind: "http503" }, { kind: "ok" }],
    });
    expect(r).toEqual({
      sends: 3,
      refreshes: 1,
      delays: [250],
      error: null,
    });
  });

  test.skipIf(skip)("Retry-After est un PLANCHER du délai", async () => {
    const r = await run({
      outcomes: [{ kind: "http503", retryAfterMs: 5000 }, { kind: "ok" }],
      baseDelayMs: 100,
      random: 1,
    });
    expect(r.sends).toBe(2);
    expect(r.delays).toEqual([5000]);
  });

  test.skipIf(skip)("Retry-After au-delà du budget : aucune tentative", async () => {
    const r = await run({
      outcomes: [{ kind: "http503", retryAfterMs: 5000 }, { kind: "ok" }],
      budgetMs: 1000,
    });
    expect(r.sends).toBe(1);
    expect(r.delays).toEqual([]);
    expect(r.error).toBe("PronoteAPIError");
  });

  test.skipIf(skip)("le budget TOTAL arrête les réessais", async () => {
    // 400 puis 800 ms : la seconde attente dépasse les 600 ms restants.
    const r = await run({
      outcomes: [{ kind: "http503" }, { kind: "http503" }, { kind: "ok" }],
      maxAttempts: 10,
      baseDelayMs: 400,
      maxDelayMs: 5000,
      budgetMs: 1000,
      random: 1,
    });
    expect(r.sends).toBe(2);
    expect(r.delays).toEqual([400]);
    expect(r.error).toBe("PronoteAPIError");
  });

  test.skipIf(skip)("jitter : délai dans [palier/2, palier], plafonné", async () => {
    // Palier 1 : 400 ms -> tirage 0 = 200, tirage 1 = 400.
    expect(await delay({ retryIndex: 1, baseDelayMs: 400, random: 0, remainingMs: 10_000 })).toBe(200);
    expect(await delay({ retryIndex: 1, baseDelayMs: 400, random: 1, remainingMs: 10_000 })).toBe(400);
    // Palier 2 : 800 ms.
    expect(await delay({ retryIndex: 2, baseDelayMs: 400, random: 1, remainingMs: 10_000 })).toBe(800);
    // Le plafond [maxDelayMs] borne la croissance.
    expect(
      await delay({ retryIndex: 8, baseDelayMs: 400, maxDelayMs: 500, random: 1, remainingMs: 10_000 }),
    ).toBe(500);
  });

  test.skipIf(skip)("les classes transitoires sont exactement celles annoncées", async () => {
    const transitoires = ["http500", "http502", "http503", "http504", "io", "timeout"];
    const definitifs = [
      "http401",
      "http403",
      "http404",
      "http429",
      "g10",
      "g22",
      "g25",
      "g99",
      "tls",
      "cert",
      "cancelled",
    ];
    for (const kind of transitoires) expect({ kind, transient: await classify(kind) }).toEqual({ kind, transient: true });
    for (const kind of definitifs) expect({ kind, transient: await classify(kind) }).toEqual({ kind, transient: false });
  });

  test.skipIf(skip)("Retry-After : secondes et date RFC 1123, forme illisible ignorée", async () => {
    const parse = async (value: string, nowMs = 0) =>
      (JSON.parse(await link!.ask({ op: "parseAfter", value, nowMs })) as { ms: number | null }).ms;
    expect(await parse("7")).toBe(7000);
    expect(await parse("-1")).toBeNull();
    expect(await parse("bientôt")).toBeNull();
    const date = "Wed, 21 Oct 2015 07:28:00 GMT";
    expect(await parse(date, Date.parse(date) - 2000)).toBe(2000);
  });

  test.skipIf(skip)("les défauts sont bornés et documentés", async () => {
    const line = await link!.ask({ op: "constants" });
    expect(JSON.parse(line)).toEqual({
      maxAttempts: 3,
      baseDelayMs: 250,
      maxDelayMs: 2000,
      budgetMs: 20_000,
    });
  });
});
