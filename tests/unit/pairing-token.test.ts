// Contrat du token d'app (#12) : l'empreinte exposed par l'API est
// sha256(token) du VRAI token (celui que le push provider poste en `to:`), et
// le secret reste récupérable côté serveur pour la notification. Horloge
// injectée, token synthétique : aucun secret réel, aucun réseau.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { PairingService } from "../../server/api/pairing";

function service() {
  let now = 1_700_000_000_000;
  const svc = new PairingService({
    now: () => now,
    uuid: (() => {
      let n = 0;
      return () => `id-${(n += 1)}`;
    })(),
    pin: () => "123456",
    token: () => "secret-synthetique-1",
  });
  return {
    svc,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function paired() {
  const ctx = service();
  const started = ctx.svc.start("pixel");
  const res = ctx.svc.confirm(started.sessionId, "123456");
  if (!res.ok) throw new Error("appairage attendu réussi");
  return { ...ctx, device: res.device };
}

describe("token d'app (server/api/pairing)", () => {
  test("tokenHash = sha256 du vrai token, secret récupérable pour le push", () => {
    const { svc, device } = paired();
    const secret = svc.tokenOf(device.id);
    expect(secret).not.toBeNull();
    expect(device.tokenHash).toBe(createHash("sha256").update(secret as string, "utf8").digest("hex"));
    expect(device.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("vérificateur : le secret passe, un autre jeton non", () => {
    const { svc, device } = paired();
    expect(svc.verifyDeviceToken(svc.tokenOf(device.id) as string)).toBe(device.id);
    expect(svc.verifyDeviceToken("secret-synthetique-2")).toBeNull();
    expect(svc.verifyDeviceToken("")).toBeNull();
  });

  test("credential expiré ou révoqué : plus enregistré, plus vérifié", () => {
    const { svc, device, advance } = paired();
    expect(svc.verifyDeviceToken(svc.tokenOf(device.id) as string)).toBe(device.id);
    expect(svc.revoke(device.id)).toBe(true);
    expect(svc.verifyDeviceToken(svc.tokenOf(device.id) ?? "x")).toBeNull();
    expect(svc.tokenOf(device.id)).toBeNull();

    const second = svc.start("pixel-2");
    const res = svc.confirm(second.sessionId, "123456");
    if (!res.ok) throw new Error("appairage attendu réussi");
    expect(svc.verifyDeviceToken(svc.tokenOf(res.device.id) as string)).toBe(res.device.id);
    advance(31 * 24 * 3_600_000);
    expect(svc.verifyDeviceToken(svc.tokenOf(res.device.id) ?? "x")).toBeNull();
    expect(svc.devices()).toEqual([]);
  });
});
