// Relecture ADVERSARIALE de server/api/pairing.ts (appairage QR+PIN, commit
// ca13389). Un bug par test, un test RED pour le seul bug qu'il nomme.
// Fakes 100 % synthétiques : horloge injectée (aucun sleep, aucun Date.now()),
// PIN/sessionId déterministes, store mémoire vide, aucun réseau, aucun secret,
// aucun .env.local. PIN synthétiques ("123456", "424242"), aucun secret-fake
// réel ni URL Pronote : la règle d'or (IP serveur uniquement) n'est pas touchée.
import { describe, expect, test } from "bun:test";
import { PairingService } from "../../server/api/pairing";
import { createHandler } from "../../server/api/router";
import { createMemoryStore } from "../../server/api/store";

/** Service à horloge injectée : `advance` rend les expirations déterministes. */
function service(opts: { ttlMs?: number; maxAttempts?: number; pin?: string } = {}) {
  let now = 1_700_000_000_000;
  let n = 0;
  const svc = new PairingService({
    ttlMs: opts.ttlMs ?? 600_000,
    maxAttempts: opts.maxAttempts ?? 5,
    now: () => now,
    uuid: () => `session-${(n += 1)}`,
    pin: () => opts.pin ?? "123456",
  });
  return {
    svc,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("bugs pairing (relecture adversariale)", () => {
  test("BUG: `start()` ne borne pas le nombre de sessions — 5 000 POST /v1/pairing/start (route non authentifiée) = 5 000 entrées en mémoire, OOM du serveur et 5 000 PIN actifs", () => {
    const { svc } = service();
    for (let i = 0; i < 5_000; i += 1) svc.start("pixel");
    // Plafond attendu : les sessions affichées à l'écran (quelques dizaines),
    // pas une entrée par requête entrante sur une route ouverte.
    expect(svc.pending()).toBeLessThanOrEqual(64);
  });

  test("BUG: aucune purge des sessions expirées — une session morte reste en mémoire (et comptée par `pending()`) jusqu'à ce qu'un `confirm` la touche", () => {
    const { svc, advance } = service({ ttlMs: 600_000 });
    svc.start("pixel");
    svc.start("pixel-2");
    svc.start("pixel-3");
    // TTL dépassé, personne ne confirme : le compteur public doit retomber à 0.
    advance(600_001);
    expect(svc.pending()).toBe(0);
  });

  test("BUG: une session verrouillée n'est jamais supprimée — elle ne peut plus jamais aboutir (tout code erroné refusé à jamais) mais reste en mémoire jusqu'au prochain `confirm`", () => {
    const { svc } = service({ maxAttempts: 2 });
    const started = svc.start("pixel");
    svc.confirm(started.sessionId, "000000");
    const locked = svc.confirm(started.sessionId, "000001");
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.failure).toBe("locked");
    // Session morte = purge immédiate attendue.
    expect(svc.pending()).toBe(0);
  });

  test("BUG: le token appairé n'a aucune durée de vie — 10 ans après l'appairage le device reste enregistré (et `revoke` n'est appelé par aucune route : un token volé ne se révoque pas)", () => {
    const { svc, advance } = service();
    const started = svc.start("pixel");
    const done = svc.confirm(started.sessionId, "123456");
    expect(done.ok).toBe(true);
    advance(10 * 365 * 24 * 3_600_000);
    // Un credential expiré n'est plus enregistré : `revoke` ne trouve rien.
    if (done.ok) expect(svc.revoke(done.device.id)).toBe(false);
  });

  test("BUG: les échecs sont distinguables — PIN faux = 400 « pairing wrong_code » vs session inexistante = 404 « pairing unknown_session » : oracle d'existence de session (et fuite des tentatives restantes via « locked »)", async () => {
    let n = 0;
    const pairing = new PairingService({
      now: () => 1_700_000_000_000,
      uuid: () => `session-${(n += 1)}`,
      pin: () => "123456",
    });
    const handler = createHandler(createMemoryStore(), pairing);
    const confirm = (body: unknown) =>
      handler(
        new Request("http://127.0.0.1/v1/pairing/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    const started = pairing.start("pixel");
    const inconnu = await confirm({ sessionId: "session-inexistante", code: "000000" });
    const mauvais = await confirm({ sessionId: started.sessionId, code: "000000" });
    // Les deux échecs doivent être indiscernables (même statut, même corps).
    expect({ status: mauvais.status, body: await mauvais.json() }).toEqual({
      status: inconnu.status,
      body: await inconnu.json(),
    });
  });

  test("BUG: le PIN est accepté exactement à `expiresAt` (`now() > expiresAt` au lieu de `>=`) — la session survit une échéance de plus", () => {
    const { svc, advance } = service({ ttlMs: 600_000 });
    const started = svc.start("pixel");
    // Exactement à la fin du TTL de 600 000 ms : déjà expiré.
    advance(600_000);
    const res = svc.confirm(started.sessionId, "123456");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failure).toBe("expired");
  });

  test("BUG: le PIN est stocké EN CLAIR dans la Map des sessions alors que l'en-tête du fichier promet « empreinte sha256 seule conservée » — un dump mémoire du serveur expose tous les PIN d'appairage actifs", () => {
    const svc = new PairingService({ uuid: () => "session-1", pin: () => "424242" });
    svc.start("pixel");
    // L'entrée interne ne doit porter que l'empreinte du PIN, jamais le PIN.
    const entrees = [...(svc as unknown as { sessions: Map<string, { code: string }> }).sessions.values()];
    expect(JSON.stringify(entrees)).not.toContain("424242");
  });
});
