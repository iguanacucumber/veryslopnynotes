// Tests #87 refresh de session + pull-refresh : horloge ET sleeper injectés,
// donc aucun `setTimeout` réel, aucun Date.now() caché, aucun réseau. Le
// scénario couvert est celui de l'acceptation : refresh 5 min sérialisé
// (une seule requête à la fois), timeout 10 s, retry ≤ 1, premier sync sans
// aucune alerte, événements de sync de types EXISTANTS uniquement.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONTRACTS_VERSION } from "../../shared/contracts/models";
import type { Assignment, Grade, TimetableEntry } from "../../shared/contracts/models";
import { isContractEvent } from "../../shared/contracts/events";
import type { ContractEvent } from "../../shared/contracts/events";
import {
  SESSION_REFRESH_ATTEMPTS,
  SESSION_REFRESH_TIMEOUT_MS,
  SESSION_REFRESH_TTL_MS,
  SessionRefreshError,
  SessionRefresher,
} from "../../server/integrations/session-refresh";
import { PronoteSessionStore } from "../../server/integrations/pronote-sessions";
import { PronoteAuthError } from "../../server/domain/ports";
import { handleSyncRefresh } from "../../server/api/sync-refresh";
import type { SyncRefreshActions } from "../../server/api/sync-refresh";
import { createHandler } from "../../server/api/router";
import { pairedDevice } from "./fixtures/pairing";
import { createMemoryStore } from "../../server/api/store";
import { isApiErrorBody } from "../../server/api/errors";
import { isSyncRefreshResponse } from "../../shared/contracts/api";
import { runSync, startSyncLoop } from "../../server/jobs/sync";
import type { SyncResult, SyncSink, SyncSnapshot, SyncSource } from "../../server/jobs/sync";
import { notifySyncResult } from "../../server/jobs/notify";
import type { GradePushSender } from "../../server/jobs/notify";
import {
  syntheticAccountId,
  syntheticPassword,
  syntheticUsername,
} from "./fixtures/pronote";

const AT = "2026-10-02T07:00:00.000Z";
const HASH = "a".repeat(64);

/**
 * Horloge manuelle + sleeper contrôlé : le timeout (deadline) et le backoff
 * sont résolus uniquement quand le test le demande, donc aucun délai réel.
 */
function bench() {
  let nowMs = 1_000_000;
  const pending: (() => void)[] = [];
  const slept: number[] = [];
  return {
    now: () => nowMs,
    advance: (ms: number) => {
      nowMs += ms;
    },
    sleep: (ms: number) => {
      slept.push(ms);
      return new Promise<void>((resolve) => pending.push(resolve));
    },
    /** Résout les attentes en attente (timeout OU backoff), dans l'ordre. */
    flush: () => {
      while (pending.length > 0) (pending.shift() as () => void)();
    },
    pendingCount: () => pending.length,
    slept,
  };
}

/**
 * Laisse les rejections asynchronces se propager et débloque les attentes
 * (deadline + backoff) au fil de l'eau. Aucun délai réel : on ne rend que ce
 * que le test a armé.
 */
async function settle(b: ReturnType<typeof bench>, rounds = 25): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
    await Promise.resolve();
    if (b.pendingCount() > 0) b.flush();
  }
}

describe("unit sync refresh (#87)", () => {
  test("constantes parité Papillon : TTL 5 min, timeout 10 s, retry ≤ 1", () => {
    expect(SESSION_REFRESH_TTL_MS).toBe(5 * 60 * 1000);
    expect(SESSION_REFRESH_TIMEOUT_MS).toBe(10_000);
    // 1 essai + 1 retry, comme PronoteHttpClient (pas de boucle de retry).
    expect(SESSION_REFRESH_ATTEMPTS).toBe(2);
  });

  test("session fraîche = zéro requête, expiration TTL = une renewal", async () => {
    const b = bench();
    let renewals = 0;
    const refresher = new SessionRefresher({
      renew: async () => {
        renewals += 1;
      },
      now: b.now,
      sleep: b.sleep,
    });
    expect(refresher.isFresh("acc-1")).toBe(false);
    const first = await refresher.refresh("acc-1");
    expect(first).toEqual({ refreshed: true, attempts: 1 });
    expect(renewals).toBe(1);
    // Refresh immédiat (< 5 min) : aucune requête Pronote de plus.
    expect(refresher.isFresh("acc-1")).toBe(true);
    expect(await refresher.refresh("acc-1")).toEqual({ refreshed: false, attempts: 0 });
    expect(renewals).toBe(1);
    // Juste avant le TTL : encore frais. Au-delà : renewal.
    b.advance(SESSION_REFRESH_TTL_MS - 1);
    expect(await refresher.refresh("acc-1")).toEqual({ refreshed: false, attempts: 0 });
    b.advance(1);
    expect((await refresher.refresh("acc-1")).refreshed).toBe(true);
    expect(renewals).toBe(2);
    // forget() (invalidation/logout) : la prochaine lecture renouvèle.
    refresher.forget("acc-1");
    expect(refresher.isFresh("acc-1")).toBe(false);
    expect((await refresher.refresh("acc-1")).refreshed).toBe(true);
    expect(renewals).toBe(3);
    // accountId vide : aucun appel réseau, aucun jeton deviné.
    expect(await refresher.refresh("  ")).toEqual({ refreshed: false, attempts: 0 });
    expect(renewals).toBe(3);
  });

  test("sérialisation : deux refresh concurrents = une seule renewal", async () => {
    const b = bench();
    let renewals = 0;
    const resolvers: (() => void)[] = [];
    const refresher = new SessionRefresher({
      renew: () => {
        renewals += 1;
        return new Promise<void>((resolve) => resolvers.push(resolve));
      },
      now: b.now,
      sleep: b.sleep,
    });
    const a = refresher.refresh("acc-1");
    const b2 = refresher.refresh("acc-1");
    const autre = refresher.refresh("acc-2");
    expect(renewals).toBe(2); // un par compte, jamais deux pour le même compte
    expect(resolvers).toHaveLength(2);
    // Les deux refresh du même compte partagent la MÊME renewal.
    expect(a).toBe(b2);
    for (const r of resolvers) r();
    await expect(a).resolves.toEqual({ refreshed: true, attempts: 1 });
    await expect(b2).resolves.toEqual({ refreshed: true, attempts: 1 });
    await expect(autre).resolves.toEqual({ refreshed: true, attempts: 1 });
    expect(renewals).toBe(2);
  });

  test("échec réseau : un seul retry après backoff, puis erreur typée", async () => {
    const b = bench();
    let appels = 0;
    const refresher = new SessionRefresher({
      renew: async () => {
        appels += 1;
        throw new Error("network injoignable");
      },
      now: b.now,
      sleep: b.sleep,
    });
    const pending = refresher.refresh("acc-1");
    // 1re tentative ratée → deadline (timeout) puis backoff du retry : on
    // débloque au fil de l'eau jusqu'au second essai.
    await settle(b);
    await expect(pending).rejects.toBeInstanceOf(SessionRefreshError);
    expect(appels).toBe(SESSION_REFRESH_ATTEMPTS);
    expect(b.slept).toContain(SESSION_REFRESH_TIMEOUT_MS); // deadline du 1er essai
    // Échec = session NON marquée fraîche : la lecture suivante réessaie.
    expect(refresher.isFresh("acc-1")).toBe(false);
  });

  test("timeout 10 s : renewal bloquée → erreur timeout, session invalidée", async () => {
    const b = bench();
    const refresher = new SessionRefresher({
      renew: () => new Promise<void>(() => {}), // renewal jamais rendue
      now: b.now,
      sleep: b.sleep,
    });
    const pending = refresher.refresh("acc-1");
    expect(b.pendingCount()).toBe(1); // la deadline est armée
    b.flush();
    await expect(pending).rejects.toMatchObject({ code: "timeout" });
    // Jamais de retry sur un timeout (comme PronoteHttpClient) : une seule
    // tentative, donc pas de délai supplémentaire ni de session « à moitié ».
    expect(b.slept).toEqual([SESSION_REFRESH_TIMEOUT_MS]);
  });

  test("session expirée : pas de retry, l'erreur remonte telle quelle", async () => {
    const b = bench();
    let appels = 0;
    const refresher = new SessionRefresher({
      renew: async () => {
        appels += 1;
        throw new PronoteAuthError("session expired", "session_expired");
      },
      now: b.now,
      sleep: b.sleep,
    });
    await expect(refresher.refresh("acc-1")).rejects.toBeInstanceOf(PronoteAuthError);
    expect(appels).toBe(1); // réessayer un login mort serait inutile
  });

  test("PronoteSessionStore : renewal avant lecture, aucun secret stocké", async () => {
    const b = bench();
    const logs: string[] = [];
    let renewals = 0;
    let logins = 0;
    const sessions = new PronoteSessionStore({
      pronoteUrl: "https://example.test/pronote/eleve.html",
      now: b.now,
      logger: (m) => logs.push(m),
      renew: async () => {
        renewals += 1;
      },
      clientFactory: (async () => {
        logins += 1;
        return { periods: [] };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as never,
    });
    await sessions.authenticate({
      accountId: syntheticAccountId,
      username: syntheticUsername,
      password: syntheticPassword,
      entKind: "ninegate",
    });
    expect(logins).toBe(1);
    expect(sessions.isAuthenticated(syntheticAccountId)).toBe(true);
    // Session ouverte = fraîche : le refresh de lecture ne renew pas encore.
    await sessions.refreshSession(syntheticAccountId);
    expect(renewals).toBe(0);
    // Au-delà du TTL : une renewal, pas de nouveau login SSO.
    b.advance(SESSION_REFRESH_TTL_MS + 1);
    await sessions.refreshSession(syntheticAccountId);
    expect(renewals).toBe(1);
    expect(logins).toBe(1);
    // invalidate() : la session est invalidée ET le TTL oublié.
    sessions.invalidate(syntheticAccountId);
    expect(sessions.isAuthenticated(syntheticAccountId)).toBe(false);
    // Renewal en échec réseau : erreur typée MAIS session conservée (un timeout
    // ne doit pas forcer un ré-appairage) ; session morte = client invalidé.
    let echec: "ok" | "network" | "expired" = "ok";
    const store2 = new PronoteSessionStore({
      pronoteUrl: "https://example.test/pronote/eleve.html",
      now: b.now,
      renew: async () => {
        if (echec === "network") throw new Error("network injoignable");
        if (echec === "expired") throw new PronoteAuthError("session expired", "session_expired");
      },
      clientFactory: (async () => ({ periods: [] })) as never,
    });
    await store2.authenticate({ accountId: syntheticAccountId, username: syntheticUsername, password: syntheticPassword, entKind: "ninegate" });
    b.advance(SESSION_REFRESH_TTL_MS + 1);
    echec = "network";
    await expect(store2.refreshSession(syntheticAccountId)).rejects.toMatchObject({ code: "network" });
    expect(store2.isAuthenticated(syntheticAccountId)).toBe(true);
    echec = "expired";
    await expect(store2.refreshSession(syntheticAccountId)).rejects.toMatchObject({ code: "session_expired" });
    expect(store2.isAuthenticated(syntheticAccountId)).toBe(false);
    expect(store2.getClient(syntheticAccountId)).toBeNull();

    // Sans renewal injectée : no-op (comportement d'avant #87, aucun crash).
    const sansRenew = new PronoteSessionStore({
      pronoteUrl: "https://example.test/pronote/eleve.html",
      clientFactory: (async () => ({ periods: [] })) as never,
    });
    await expect(sansRenew.refreshSession(syntheticAccountId)).resolves.toBeUndefined();
    const store = readStore();
    expect(store).not.toContain("this.password");
    expect(logs.join("\n")).not.toContain(syntheticPassword);
    expect(logs.join("\n")).not.toContain(syntheticUsername);
  });

  test("reader : refresh appelé avant chaque lecture du sync", async () => {
    const b = bench();
    let refreshCalls = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sessions = {
      requireClient: () => ({
        periods: [{ id: "p-1", grades: async () => [] }],
        homework: async () => [],
        lessons: async () => [],
      }),
      refreshSession: async () => {
        refreshCalls += 1;
        b.advance(SESSION_REFRESH_TTL_MS + 1);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const { PronoteClientReader } = await import("../../server/integrations/pronote-client-reader");
    const reader = new PronoteClientReader({ sessions });
    await reader.getGrades(syntheticAccountId);
    await reader.getAssignments(syntheticAccountId);
    await reader.getTimetable(syntheticAccountId);
    expect(refreshCalls).toBe(3);
    // Reader sans refresh (stubs de test) : aucun crash, lecture normale.
    const sansRefresh = new PronoteClientReader({ sessions: { requireClient: sessions.requireClient } });
    await expect(sansRefresh.getGrades(syntheticAccountId)).resolves.toBeDefined();
  });

  test("pull-refresh : événements de types EXISTANTS, 501 sans relecture", async () => {
    const events: ContractEvent[] = [
      { v: CONTRACTS_VERSION, type: "GradeCreated", at: AT, data: syntheticGrade("g1", 15) },
      { v: CONTRACTS_VERSION, type: "TimetableUpdated", at: AT, data: { entries: [] } },
      { v: CONTRACTS_VERSION, type: "SyncCompleted", at: AT, data: { accountId: syntheticAccountId, grades: 1, assignments: 0 } },
      { v: CONTRACTS_VERSION, type: "CacheInvalidated", at: AT, data: { resource: "capabilities", reason: "manual" } },
    ];
    const actions: SyncRefreshActions = { refresh: async () => events };
    const ok = await handleSyncRefresh(new Request("http://127.0.0.1/v1/sync/refresh"), actions);
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { events: unknown[] };
    expect(isSyncRefreshResponse(body)).toBe(true);
    expect(body.events).toHaveLength(events.length);
    expect(body.events.every(isContractEvent)).toBe(true);
    // Aucun type d'événement nouveau : l'app 0.3.0 sait déjà les traiter.
    for (const e of events) expect(body.events).toContainEqual(e);

    // Corps : absent = mono-compte, {} = idem, accountId réclamé par le client
    // validé pour la FORME (borne) mais JAMAIS utilisé comme identité : c'est le
    // compte RÉSOLU PAR LE SERVEUR qui part vers le port, même quand le corps en
    // réclame un autre (0.4.0 : le refresh relit le compte appairé du serveur).
    const vus: string[] = [];
    const spy: SyncRefreshActions = {
      refresh: async (accountId) => {
        vus.push(accountId);
        return [];
      },
    };
    for (const body0 of [undefined, "{}", JSON.stringify({ accountId: syntheticAccountId })]) {
      const res = await handleSyncRefresh(
        new Request("http://127.0.0.1/v1/sync/refresh", body0 === undefined ? undefined : { method: "POST", body: body0 }),
        spy,
        "acc-resolu-par-le-serveur",
      );
      expect(res.status).toBe(200);
    }
    // Le compte réclamé par le corps ne remplace JAMAIS celui du serveur.
    expect(vus).toEqual(["acc-resolu-par-le-serveur", "acc-resolu-par-le-serveur", "acc-resolu-par-le-serveur"]);
    // Sans compte résolu (routeur mono-compte : store vide) = port sans identité.
    await handleSyncRefresh(new Request("http://127.0.0.1/v1/sync/refresh", { method: "POST", body: "{}" }), spy);
    expect(vus.at(-1)).toBe("");
    const mauvais = await handleSyncRefresh(
      new Request("http://127.0.0.1/v1/sync/refresh", { method: "POST", body: "pas-du-json" }),
      spy,
    );
    expect(mauvais.status).toBe(400);
    expect(isApiErrorBody(await mauvais.json())).toBe(true);
    const tropLong = await handleSyncRefresh(
      new Request("http://127.0.0.1/v1/sync/refresh", { method: "POST", body: JSON.stringify({ accountId: "a".repeat(65) }) }),
      spy,
    );
    expect(tropLong.status).toBe(400);

    // Événement non contractuel filtré (jamais de 500 sur un flux ouvert).
    const sale = await handleSyncRefresh(
      new Request("http://127.0.0.1/v1/sync/refresh"),
      { refresh: async () => [{ v: "9.9.9", type: "GradeCreated", at: AT, data: {} }] as unknown as ContractEvent[] },
    );
    expect(sale.status).toBe(200);
    expect((await sale.json()) as { events: unknown[] }).toEqual({ events: [] });

    // Sans relecture branchée : 501 honnête, jamais un faux succès.
    const nonBranche = await handleSyncRefresh(new Request("http://127.0.0.1/v1/sync/refresh"), null);
    expect(nonBranche.status).toBe(501);
    expect(isApiErrorBody(await nonBranche.json())).toBe(true);

    // Session expirée / erreur = 401 / 500 typés, jamais de détail interne.
    const expiree = await handleSyncRefresh(new Request("http://127.0.0.1/v1/sync/refresh"), {
      refresh: async () => {
        throw new PronoteAuthError("session expired", "session_expired");
      },
    });
    expect(expiree.status).toBe(401);
    const cassee = await handleSyncRefresh(new Request("http://127.0.0.1/v1/sync/refresh"), {
      refresh: async () => {
        throw new Error("ECONNREFUSED 10.0.0.1:443");
      },
    });
    expect(cassee.status).toBe(500);
    expect(JSON.stringify(await cassee.json())).not.toContain("10.0.0.1");
  });

  test("premier sync : zéro événement, donc ZÉRO alerte (I7, acceptation #87)", async () => {
    const grades = [syntheticGrade("g1", 14)];
    const source: SyncSource = {
      grades: async () => grades,
      assignments: async () => [] as Assignment[],
      entries: async () => [] as TimetableEntry[],
    };
    let snapshot: SyncSnapshot | null = null;
    const sink: SyncSink = {
      loadSnapshot: async () => snapshot,
      saveSnapshot: async (s) => {
        snapshot = s;
      },
    };
    const sends: string[] = [];
    const sender: GradePushSender = {
      send: async (hash) => {
        sends.push(hash);
      },
    };
    const devices = [{ id: "d1", tokenHash: HASH }];
    const premier = await runSync(source, sink, AT);
    expect(premier.firstRun).toBe(true);
    expect(premier.events).toEqual([]);
    const notif = await notifySyncResult(premier, devices, sender);
    expect(notif.sent).toBe(0);
    expect(sends).toEqual([]);
    // Aucune alerte sécurité : le sync ne publie que des données structurées.
    expect(premier.events.filter((e) => e.type === "SecurityAlert")).toEqual([]);
    // Puis une note : GradeCreated (type existant), toujours sans LLM.
    grades.push(syntheticGrade("g2", 16));
    const second = await runSync(source, sink, AT);
    expect(second.events.map((e) => e.type)).toEqual(["GradeCreated"]);
    expect(second.events.every(isContractEvent)).toBe(true);
    // Rejeu identique : aucun événement (le pull-refresh n'envoie rien à vide).
    expect((await runSync(source, sink, AT)).events).toEqual([]);
  });

  test("sync d'arrière-plan borné : maxRuns arrête la boucle, 1er run silencieux", async () => {
    const grades = [syntheticGrade("g1", 14)];
    const source: SyncSource = {
      grades: async () => grades,
      assignments: async () => [] as Assignment[],
      entries: async () => [] as TimetableEntry[],
    };
    const { sink } = memorySink();
    const results: SyncResult[] = [];
    const stop = startSyncLoop(source, sink, 5, (r) => results.push(r), 2);
    await new Promise((r) => setTimeout(r, 60));
    stop();
    // Deux tours au maximum, pas plus (budget respecté, pas de tick orphelin).
    expect(results.length).toBeLessThanOrEqual(2);
    expect(results.length).toBeGreaterThanOrEqual(1);
    // Premier tour = snapshot initial, zéro événement, donc zéro alerte.
    expect(results[0].firstRun).toBe(true);
    expect(results[0].events).toEqual([]);
    for (const r of results) for (const e of r.events) expect(e.type === "GradeCreated" || e.type === "TimetableUpdated").toBe(true);
  });

  test("route POST /v1/sync/refresh : 405 sur GET, 501 par défaut", async () => {
    // Depuis 0.4.0 la route est fermée : bearer du device appairé obligatoire.
    const { pairing, auth } = pairedDevice();
    const handler = createHandler(createMemoryStore(), pairing);
    const mauvaisMethode = await handler(new Request("http://127.0.0.1/v1/sync/refresh", { headers: auth }));
    expect(mauvaisMethode.status).toBe(405);
    const parDefaut = await handler(new Request("http://127.0.0.1/v1/sync/refresh", { method: "POST", headers: auth }));
    expect(parDefaut.status).toBe(501);
    // Sans bearer : 401 (le compte n'est même pas résolu).
    const anonyme = await handler(new Request("http://127.0.0.1/v1/sync/refresh", { method: "POST", body: "{}" }));
    expect(anonyme.status).toBe(401);
    // Câblé : la relecture passe par les événements returned, pas par le store.
    const cable = createHandler(createMemoryStore(), pairing, undefined, undefined, undefined, null, null, {
      refresh: async () => [
        { v: CONTRACTS_VERSION, type: "SyncCompleted", at: AT, data: { accountId: syntheticAccountId, grades: 2, assignments: 1 } },
      ],
    });
    const res = await cable(new Request("http://127.0.0.1/v1/sync/refresh", { method: "POST", headers: auth, body: "{}" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: { type: string }[] };
    expect(isSyncRefreshResponse(body)).toBe(true);
    expect(body.events[0].type).toBe("SyncCompleted");
  });
});

function readStore(): string {
  return readFileSync(join(import.meta.dir, "..", "..", "server/integrations/pronote-sessions.ts"), "utf8");
}

function memorySink(): { sink: SyncSink; saved: () => SyncSnapshot | null } {
  let snapshot: SyncSnapshot | null = null;
  return {
    sink: {
      loadSnapshot: async () => snapshot,
      saveSnapshot: async (s) => {
        snapshot = s;
      },
    },
    saved: () => snapshot,
  };
}

function syntheticGrade(id: string, value: number): Grade {
  return {
    id,
    accountId: syntheticAccountId,
    subject: "Maths-Fake",
    value,
    scale: 20,
    date: "2026-09-20T10:00:00.000Z",
  };
}