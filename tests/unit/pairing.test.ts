import { describe, expect, test } from "bun:test";
import { isPairingStartResponse } from "../../shared/contracts/api";
import { isDevice } from "../../shared/contracts/models";
import { PairingService } from "../../server/api/pairing";

function service(nowValue = 1_000_000) {
  let now = nowValue;
  let n = 0;
  return {
    svc: new PairingService({
      ttlMs: 60_000,
      maxAttempts: 2,
      now: () => now,
      uuid: () => `uuid-${(n += 1)}`,
      pin: () => "123456",
    }),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("unit pairing", () => {
  test("start → code PIN 6 chiffres, confirm OK → device", () => {
    const { svc } = service();
    const started = svc.start("pixel");
    expect(isPairingStartResponse(started)).toBe(true);
    expect(started.code).toBe("123456");
    const res = svc.confirm(started.sessionId, "123456");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(isDevice(res.device)).toBe(true);
      expect(res.device.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(svc.pending()).toBe(0);
  });

  test("rejeu après succès → unknown_session", () => {
    const { svc } = service();
    const started = svc.start("pixel");
    expect(svc.confirm(started.sessionId, "123456").ok).toBe(true);
    const replay = svc.confirm(started.sessionId, "123456");
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.failure).toBe("unknown_session");
  });

  test("mauvais code → wrong_code puis locked, expiration → expired", () => {
    const { svc, advance } = service();
    const started = svc.start("pixel");
    const first = svc.confirm(started.sessionId, "000000");
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.failure).toBe("wrong_code");
    const second = svc.confirm(started.sessionId, "000000");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.failure).toBe("locked");

    const fresh = svc.start("pixel2");
    advance(61_000);
    const late = svc.confirm(fresh.sessionId, "123456");
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.failure).toBe("expired");
  });

  test("session inconnue + révocation", () => {
    const { svc } = service();
    const res = svc.confirm("nope", "123456");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failure).toBe("unknown_session");

    const started = svc.start("pixel");
    const done = svc.confirm(started.sessionId, "123456");
    expect(done.ok).toBe(true);
    if (done.ok) {
      expect(svc.revoke(done.device.id)).toBe(true);
      expect(svc.revoke(done.device.id)).toBe(false);
    }
  });
});
