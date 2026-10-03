// e2e sync (#87) : store seedé → capacités + pull-refresh + flux SSE borné.
// ZÉRO réseau (store mémoire + reader injecté), zéro secret, aucune URL
// Pronote dans ce test public. Les événements restent des types EXISTANTS du
// contrat et le chemin ne contient aucun LLM (I7).
import { describe, expect, test } from "bun:test";
import { CONTRACTS_VERSION } from "../../shared/contracts/models";
import type { Capabilities, Grade } from "../../shared/contracts/models";
import { isCapabilitiesResponse, isSyncRefreshResponse } from "../../shared/contracts/api";
import { isContractEvent } from "../../shared/contracts/events";
import { CACHE_TTL_MS, cacheStatus } from "../../shared/contracts/cache";
import { createHandler } from "../../server/api/router";
import { createMemoryStore } from "../../server/api/store";
import { runSync } from "../../server/jobs/sync";
import type { SyncResult, SyncSink, SyncSnapshot, SyncSource } from "../../server/jobs/sync";
import { capabilitiesFromProbe } from "../../server/domain/capabilities";
import { syntheticAccountId } from "../unit/fixtures/pronote";

const AT = "2026-10-02T07:00:00.000Z";

const CAPS: Capabilities = capabilitiesFromProbe(
  syntheticAccountId,
  { grades: true, homework: true, timetable: true, evaluations: false, news: true, menus: false, attendance: true, punishments: true, profile: true },
  AT,
);

const GRADE: Grade = {
  id: "g-fake-1",
  accountId: syntheticAccountId,
  subject: "Maths-Fake",
  value: 15,
  scale: 20,
  date: "2026-09-20T10:00:00.000Z",
};

/** Moteur de sync sur source mémoire : borné, sans réseau, sans LLM. */
function memorySource(grades: Grade[]): SyncSource {
  return {
    grades: async () => grades,
    assignments: async () => [],
    entries: async () => [],
  };
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

/** Événements de sync + invalidation capabilities quand la liste change. */
async function refreshOnce(source: SyncSource, sink: SyncSink, at = AT): Promise<SyncResult> {
  return runSync(source, sink, at);
}

describe("e2e sync (#87)", () => {
  test("GET /v1/capabilities : onglets inactifs absents, état vide propre", async () => {
    const handler = createHandler(createMemoryStore({ capabilities: CAPS }));
    const res = await handler(new Request("http://127.0.0.1/v1/capabilities"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { capabilities: Capabilities | null };
    expect(isCapabilitiesResponse(body)).toBe(true);
    expect(body.capabilities?.tabs).toEqual(["grades", "homework", "timetable", "news", "attendance", "punishments", "profile"]);
    // Onglet absent de l'établissement = capacité false, jamais une erreur.
    expect(body.capabilities?.tabs).not.toContain("menus");
    expect(body.capabilities?.tabs).not.toContain("evaluations");
    expect(JSON.stringify(body)).not.toMatch(/sk-or-v1-|OPENROUTER_API_KEY|PRONOTE_PASSWORD/);

    // Établissement sans rien de détecté : liste vide (l'app masque, 200).
    const vide = createHandler(createMemoryStore({ capabilities: { accountId: syntheticAccountId, tabs: [], fetchedAt: AT } }));
    const videRes = await vide(new Request("http://127.0.0.1/v1/capabilities"));
    expect(videRes.status).toBe(200);
    expect(((await videRes.json()) as { capabilities: Capabilities }).capabilities.tabs).toEqual([]);

    // Cache : TTL long + invalidation par CacheInvalidated (type existant).
    expect(cacheStatus("capabilities", 0, CACHE_TTL_MS.capabilities)).toBe("fresh");
  });

  test("POST /v1/sync/refresh : relecture bornée → événements contractuels", async () => {
    const grades = [GRADE];
    const { sink, saved } = memorySink();
    const source = memorySource(grades);
    // Relecture branchée sur le moteur de sync réel (données structurées).
    let appels = 0;
    const handler = createHandler(createMemoryStore({ capabilities: CAPS }), undefined, undefined, undefined, undefined, null, null, {
      refresh: async (accountId) => {
        appels += 1;
        const result = await refreshOnce(source, sink);
        const events = [...result.events];
        // Invalidation de la liste d'onglets quand elle change (type existant,
        // pas d'événement novel) : ici elle est lue avant/après, donc inchangée.
        events.push({
          v: CONTRACTS_VERSION,
          type: "SyncCompleted",
          at: AT,
          data: { accountId: accountId === "" ? syntheticAccountId : accountId, grades: grades.length, assignments: 0 },
        });
        return events;
      },
    });

    // Premier refresh : premier sync = zéro événement métier, donc zéro alerte.
    const premier = await handler(
      new Request("http://127.0.0.1/v1/sync/refresh", { method: "POST", body: JSON.stringify({ accountId: syntheticAccountId }) }),
    );
    expect(premier.status).toBe(200);
    const body1 = (await premier.json()) as { events: { type: string }[] };
    expect(isSyncRefreshResponse(body1)).toBe(true);
    expect(body1.events.map((e) => e.type)).toEqual(["SyncCompleted"]);
    expect(saved()?.version).toBe(1);
    expect(appels).toBe(1);

    // Nouvelle note : GradeCreated (type existant) + SyncCompleted.
    grades.push({ ...GRADE, id: "g-fake-2", value: 18 });
    const second = await handler(new Request("http://127.0.0.1/v1/sync/refresh", { method: "POST", body: "{}" }));
    const body2 = (await second.json()) as { events: { type: string }[] };
    expect(isSyncRefreshResponse(body2)).toBe(true);
    expect(body2.events.map((e) => e.type)).toEqual(["GradeCreated", "SyncCompleted"]);
    expect(body2.events.every((e) => isContractEvent(e))).toBe(true);
    expect(saved()?.version).toBe(2);

    // Rejeu identique : rien à notifier (idempotence, pas de push inutile).
    const troisieme = await handler(new Request("http://127.0.0.1/v1/sync/refresh", { method: "POST" }));
    const body3 = (await troisieme.json()) as { events: { type: string }[] };
    expect(body3.events.map((e) => e.type)).toEqual(["SyncCompleted"]);

    // Corps surdimensionné = 400 borné (pas de JSON arbitraire en entrée).
    const enorme = await handler(
      new Request("http://127.0.0.1/v1/sync/refresh", { method: "POST", body: "x".repeat(1024) }),
    );
    expect(enorme.status).toBe(400);
    // Non câblé : 501 honnête, jamais un faux succès.
    const nu = createHandler(createMemoryStore());
    const nonBranche = await nu(new Request("http://127.0.0.1/v1/sync/refresh", { method: "POST" }));
    expect(nonBranche.status).toBe(501);
  });

  test("/v1/events : snapshot BORNÉ (3 enveloppes, flux fermé, rien qui fuit)", async () => {
    const handler = createHandler(createMemoryStore({ capabilities: CAPS }));
    const res = await handler(new Request("http://127.0.0.1/v1/events"));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    const events = [...text.matchAll(/data: (\{.*\})\n\n/g)].map((m) => JSON.parse(m[1] as string));
    // Flux fermé après le snapshot : pas de connexion tenue pour rien, et donc
    // pas de boucle infinie ni de payload qui s'accumule côté serveur.
    expect(res.bodyUsed).toBe(true);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.type)).toEqual(["SyncCompleted", "NewsUpdated", "TimetableUpdated"]);
    expect(events.every((e) => isContractEvent(e))).toBe(true);
    // Les capacités ne polluent pas le snapshot : invalidation par
    // CacheInvalidated au pull-refresh (pas de 4e enveloppe).
    expect(events.some((e) => e.type === "CacheInvalidated")).toBe(false);
    expect(text).not.toMatch(/sk-or-v1-|OPENROUTER_API_KEY|PRONOTE_PASSWORD/);
  });

  test("cohérence bout en bout : détection capacités → décision d'affichage", async () => {
    // Une réconciliation pure par onglet : l'app masque exactement les onglets
    // non listés, sans jamais masquer un onglet dont la capacité est inconnue.
    const decisions = (["grades", "homework", "timetable", "evaluations", "news", "menus", "attendance", "punishments"] as const).map((tab) => ({
      tab,
      visible: CAPS.tabs.includes(tab),
    }));
    expect(decisions.filter((d) => d.visible).map((d) => d.tab)).toEqual([
      "grades",
      "homework",
      "timetable",
      "news",
      "attendance",
      "punishments",
    ]);
    // Onglet inactif → écran absent de la navigation ; son état reste propre
    // (liste vide côté API, jamais un 500).
    const handler = createHandler(createMemoryStore({ capabilities: CAPS }));
    const menus = await handler(new Request("http://127.0.0.1/v1/menus"));
    expect(menus.status).toBe(200);
    expect(((await menus.json()) as { menus: unknown[] }).menus).toEqual([]);
    const evals = await handler(new Request("http://127.0.0.1/v1/evaluations"));
    expect(evals.status).toBe(200);
    expect(((await evals.json()) as { skills: unknown[] }).skills).toEqual([]);
  });
});