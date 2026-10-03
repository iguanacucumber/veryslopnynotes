// Porte d'authentification du routeur (0.4.0) : TOUTE route exige le bearer
// d'un device appairé, sauf celles qui servent à OBTENIR le credential
// (appairage) et la sonde de vivacité. Pilotage 100 % en mémoire (Request
// construits ici), données et token synthétiques, aucun réseau, aucun secret.
import { describe, expect, test } from "bun:test";
import { API_ROUTES, isPairingConfirmResponse, isPairingStartResponse } from "../../shared/contracts/api";
import { isApiErrorBody } from "../../server/api/errors";
import { PairingService } from "../../server/api/pairing";
import { createHandler } from "../../server/api/router";
import { createMemoryStore } from "../../server/api/store";
import type { AssignmentActions } from "../../server/api/assignments";
import type { DiscussionActions } from "../../server/api/discussions";
import type { SyncRefreshActions } from "../../server/api/sync-refresh";

/** Le SEUL corps de refus possible d'un bearer absent/invalide (aucune fuite). */
const attendu401 = { error: { code: "unauthorized", message: "jeton d'appareil invalide" } };

/** Les 3 seules routes ouvertes : obtenir un credential + savoir si on est vif. */
const OPEN: readonly string[] = ["/v1/health", "/v1/pairing/start", "/v1/pairing/confirm"];

async function json(res: Response): Promise<unknown> {
  return res.json();
}

describe("porte d'authentification du routeur", () => {
  test("toute route hors appairage + /v1/health est fermée sans bearer", async () => {
    const { pairing } = appaired();
    const h = createHandler(createMemoryStore(), pairing);
    for (const route of API_ROUTES) {
      const res = await h(
        new Request(`http://127.0.0.1${route.path}`, {
          method: route.method,
          body: route.method === "GET" ? undefined : "{}",
        }),
      );
      if (OPEN.includes(route.path)) {
        // Route ouverte : le statut est celui de la route, jamais un 401 d'auth.
        expect({ path: route.path, status: res.status }).toEqual({
          path: route.path,
          status: route.path === "/v1/health" ? 200 : 400, // corps `{}` incomplet
        });
        continue;
      }
      expect({ path: route.path, method: route.method, status: res.status }).toEqual({
        path: route.path,
        method: route.method,
        status: 401,
      });
      expect(res.headers.get("www-authenticate")).not.toBeNull();
      expect(isApiErrorBody(await json(res))).toBe(true);
    }
  });

  test("HEAD /v1/health reste ouvert (sonde de vivacité), et les autres HEAD aussi", async () => {
    const { pairing, auth } = appaired();
    const h = createHandler(createMemoryStore(), pairing);
    // Même route que GET : ouverte, statut identique, aucun corps (RFC 9110).
    const health = await h(new Request("http://127.0.0.1/v1/health", { method: "HEAD" }));
    expect(health.status).toBe(200);
    expect(await health.text()).toBe("");
    // HEAD sur une route fermée = même refus que le GET (aucune fuite par HEAD).
    const grades = await h(new Request("http://127.0.0.1/v1/grades", { method: "HEAD" }));
    expect(grades.status).toBe(401);
    expect(grades.headers.get("www-authenticate")).not.toBeNull();
    // Avec le bon bearer, la sonde répond 200.
    expect((await h(new Request("http://127.0.0.1/v1/health", { method: "HEAD", headers: auth }))).status).toBe(200);
  });

  test("les refus sont INDISTINGUABLES : inconnu, révoqué, mal formé = un seul 401", async () => {
    const { pairing, token } = appaired();
    const h = createHandler(createMemoryStore(), pairing);
    const presents = [
      "",
      "Bearer",
      "Basic dXNlcjpwYXNz",
      "Bearer jeton-jamais-vu",
      `Bearer ${token.slice(0, -2)}xx`,
      `Bearer ${token} extra`,
    ];
    const vus: { status: number | null; corps: string; defi: string | null }[] = [];
    for (const authorization of presents) {
      const res = await h(
        new Request("http://127.0.0.1/v1/grades", { headers: authorization === "" ? {} : { authorization } }),
      );
      vus.push({ status: res.status, corps: JSON.stringify(await json(res)), defi: res.headers.get("www-authenticate") });
    }
    // Un seul statut, un seul message, un seul défi : aucune fuite sur la cause.
    expect(new Set(vus.map((v) => v.status))).toEqual(new Set([401]));
    expect(new Set(vus.map((v) => v.corps))).toEqual(new Set([JSON.stringify(attendu401)]));
    expect(new Set(vus.map((v) => v.defi))).toEqual(new Set(['Bearer realm="api"']));
    // Le schéma d'authentification est insensible à la casse (RFC 9110 §11.1) :
    // `bearer <token>` est donc ACCEPTÉ, ce n'est pas un refus différent.
    expect(
      (await h(new Request("http://127.0.0.1/v1/grades", { headers: { authorization: `bearer ${token}` } }))).status,
    ).toBe(200);
    // Le même refus une fois le credential RÉVOQUÉ.
    const device = pairing.devices()[0];
    expect(pairing.revoke(device?.id ?? "")).toBe(true);
    const apres = await h(new Request("http://127.0.0.1/v1/grades", { headers: { authorization: `Bearer ${token}` } }));
    expect(apres.status).toBe(401);
    expect(JSON.stringify(await json(apres))).toBe(vus[3]?.corps);
  });

  test("l'appairage est la seule porte du secret : une seule fois, et il ouvre les routes", async () => {
    const pairing = new PairingService();
    const h = createHandler(createMemoryStore(), pairing);
    // /v1/pairing/start : ouverte (le device n'a pas encore de credential).
    const start = await h(
      new Request("http://127.0.0.1/v1/pairing/start", {
        method: "POST",
        body: JSON.stringify({ deviceName: "pixel-test" }),
      }),
    );
    expect(start.status).toBe(200);
    const { sessionId, code } = (await json(start)) as { sessionId: string; code: string };
    expect(isPairingStartResponse({ sessionId, code })).toBe(true);
    // /v1/pairing/confirm : ouverte, et SEULE réponse qui porte le secret.
    const confirm = await h(
      new Request("http://127.0.0.1/v1/pairing/confirm", {
        method: "POST",
        body: JSON.stringify({ sessionId, code }),
      }),
    );
    expect(confirm.status).toBe(200);
    const charge = await json(confirm);
    expect(isPairingConfirmResponse(charge)).toBe(true);
    const { token } = charge as { token: string };
    expect(token.length).toBeGreaterThan(0);
    // Le secret NE VIT PAS dans le credential stocké : seulement son sha256.
    expect(pairing.devices()[0]?.tokenHash).not.toBe(token);
    expect(pairing.devices().map((d) => JSON.stringify(d)).join(" ")).not.toContain(token);
    // Rejeu : même 401, et JAMAIS de secret dans un refus.
    const replay = await h(
      new Request("http://127.0.0.1/v1/pairing/confirm", {
        method: "POST",
        body: JSON.stringify({ sessionId, code }),
      }),
    );
    expect(replay.status).toBe(401);
    expect(JSON.stringify(await json(replay))).not.toContain(token);
    // Le token ouvre effectivement les routes fermées.
    expect((await h(new Request("http://127.0.0.1/v1/grades", { headers: { authorization: `Bearer ${token}` } }))).status).toBe(200);
  });

  test("le compte servi est résolu par le serveur, jamais celui réclamé par le client", async () => {
    const store = createMemoryStore({ userInfo: { accountId: "acc-serveur", displayName: "Camille Exemple" } });
    const vus: string[] = [];
    const assignmentActions: AssignmentActions = {
      setAssignmentDone: async (accountId, assignmentId, done) => {
        vus.push(`toggle:${accountId}`);
        return {
          id: assignmentId,
          accountId: "acc-serveur",
          subject: "Maths",
          title: "Exos",
          dueDate: "2026-10-05T08:00:00.000Z",
          done,
        };
      },
    };
    const syncRefresh: SyncRefreshActions = {
      refresh: async (accountId) => {
        vus.push(`sync:${accountId}`);
        return [];
      },
    };
    const discussionActions: DiscussionActions = {
      createDiscussion: async (accountId) => {
        vus.push(`create:${accountId}`);
      },
      replyToDiscussion: async (accountId) => {
        vus.push(`reply:${accountId}`);
      },
      setDiscussionRead: async (accountId) => {
        vus.push(`read:${accountId}`);
      },
      deleteDiscussion: async (accountId) => {
        vus.push(`delete:${accountId}`);
      },
    };
    const { pairing, auth } = appaired();
    const h = createHandler(
      store,
      pairing,
      null,
      undefined,
      undefined,
      assignmentActions,
      undefined,
      syncRefresh,
      discussionActions,
    );
    const post = (path: string, body0: unknown) =>
      h(
        new Request(`http://127.0.0.1${path}`, {
          method: "POST",
          headers: auth,
          body: JSON.stringify(body0),
        }),
      );
    const revente = "compte-victime";
    await post("/v1/assignments/toggle", { accountId: revente, assignmentId: "a-1", done: true });
    await post("/v1/sync/refresh", { accountId: revente });
    await post("/v1/discussions", { accountId: revente, subject: "S", body: "B", recipientIds: ["r-1"] });
    await post("/v1/discussions/reply", { accountId: revente, discussionId: "d-1", body: "B" });
    await post("/v1/discussions/read-state", { accountId: revente, discussionId: "d-1", read: true });
    await post("/v1/discussions/delete", { accountId: revente, discussionId: "d-1" });
    // Un seul compte atteint les ports : celui résolu par le serveur.
    expect(vus).toEqual([
      "toggle:acc-serveur",
      "sync:acc-serveur",
      "create:acc-serveur",
      "reply:acc-serveur",
      "read:acc-serveur",
      "delete:acc-serveur",
    ]);
  });
});

/** Appaire un device comme le fait l'app : start puis confirm, secret récupéré. */
function appaired(): { pairing: PairingService; token: string; auth: Record<string, string> } {
  const pairing = new PairingService();
  const started = pairing.start("pixel-test");
  const confirmed = pairing.confirm(started.sessionId, started.code);
  if (!confirmed.ok) throw new Error("appairage de test impossible");
  return { pairing, token: confirmed.token, auth: { authorization: `Bearer ${confirmed.token}` } };
}
