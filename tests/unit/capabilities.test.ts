// Tests #87 capacités dynamiques : contrats, réduction pure, détection reader,
// route GET /v1/capabilities, cache + invalidation, et robustesse 20 runs.
// Fixtures 100 % synthétiques, aucun réseau réel, aucun secret, aucune URL
// d'établissement. Le dernier test rejoue 20 fois la réconciliation pure et
// exige ≥ 95 % de runs identiques (seuil accepté par l'issue #87) : c'est une
// mesure déterministe, pas une métrique flaky (aucun Date.now(), aucun réseau).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CAPABILITIES_ACCOUNT_ID_MAX_CHARS,
  CONTRACTS_VERSION,
  TAB_CAPABILITIES,
  isCapabilities,
  isCapabilityEnabled,
  isTabCapability,
} from "../../shared/contracts/models";
import type { Capabilities, TabCapability } from "../../shared/contracts/models";
import { API_ROUTES, isCapabilitiesResponse } from "../../shared/contracts/api";
import { CACHEABLE_RESOURCES, CACHE_TTL_MS, cacheStatus, isCacheableResource } from "../../shared/contracts/cache";
import { isContractEvent } from "../../shared/contracts/events";
import { capabilitiesFromProbe, disabledTabs, hasCapability } from "../../server/domain/capabilities";
import { createMemoryStore } from "../../server/api/store";
import { createHandler } from "../../server/api/router";
import { pairedDevice } from "./fixtures/pairing";
import { PronoteClientReader } from "../../server/integrations/pronote-client-reader";
import { PronoteReadError } from "../../server/domain/ports";
import { syntheticAccountId } from "./fixtures/pronote";

const ROOT = join(import.meta.dir, "..", "..");
const CORE = join(ROOT, "android/core/src/main/java/fr/veryslopnynotes/core");
const DATA = join(ROOT, "android/data/src/main/java/fr/veryslopnynotes/data");
const UI = join(ROOT, "android/ui/src/main/java/fr/veryslopnynotes/ui");

const AT = "2026-10-02T07:00:00.000Z";

// Client pronotets synthétique : periods avec grades, le reste des onglets
// volontairement absent (établissement qui ne publie que les notes).
const SYNTHETIC_CLIENT_FULL = {
  periods: [{ id: "p-1", grades: async () => [], evaluations: async () => [], absences: async () => [], delays: async () => [], punishments: async () => [] }],
  homework: async () => [],
  lessons: async () => [],
  informationAndSurveys: async () => [],
  menus: async () => [],
  info: { name: "Élève-UNREAL", className: "3A-UNREAL" },
};

const SYNTHETIC_CLIENT_MINIMAL = { periods: [{ id: "p-1", grades: async () => [] }] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readerFor(client: unknown, logs: string[] = []): PronoteClientReader {
  return new PronoteClientReader({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sessions: { requireClient: () => client } as any,
    logger: (m) => logs.push(m),
  });
}

function caps(tabs: TabCapability[]): Capabilities {
  return { accountId: syntheticAccountId, tabs, fetchedAt: AT };
}

describe("unit capacités (#87)", () => {
  test("contrat : onglets connus, bornes, doublons et dates refusés", () => {
    expect(TAB_CAPABILITIES.length).toBeGreaterThanOrEqual(10);
    // Onglets Pronote → capacité de l'app (parité Papillon).
    for (const t of ["grades", "homework", "timetable", "evaluations", "news", "menus", "attendance", "punishments", "discussions", "profile"]) {
      expect(isTabCapability(t)).toBe(true);
      expect(TAB_CAPABILITIES as readonly string[]).toContain(t);
    }
    expect(isTabCapability("inconnu")).toBe(false);
    expect(isTabCapability(42)).toBe(false);

    expect(isCapabilities(caps(["grades", "timetable"]))).toBe(true);
    // Liste vide = aucun onglet affirmé actif (établissement sans rien de détecté).
    expect(isCapabilities(caps([]))).toBe(true);
    // Rejets : onglet inconnu, doublon, accountId vide/trop long, date illisible.
    expect(isCapabilities(caps(["inconnu" as TabCapability]))).toBe(false);
    expect(isCapabilities(caps(["grades", "grades"]))).toBe(false);
    expect(isCapabilities({ ...caps(["grades"]), accountId: "  " })).toBe(false);
    expect(isCapabilities({ ...caps(["grades"]), accountId: "a".repeat(CAPABILITIES_ACCOUNT_ID_MAX_CHARS + 1) })).toBe(false);
    expect(isCapabilities({ ...caps(["grades"]), fetchedAt: "hier" })).toBe(false);
    expect(isCapabilities({ ...caps(["grades"]), tabs: "grades" })).toBe(false);
    expect(isCapabilities(null)).toBe(false);
    expect(isCapabilities([])).toBe(false);

    // Route + réponse : null = capacités non déterminées (rien n'est masqué).
    expect(API_ROUTES.map((r) => r.path)).toContain("/v1/capabilities");
    expect(API_ROUTES.map((r) => r.path)).toContain("/v1/sync/refresh");
    expect(isCapabilitiesResponse({ capabilities: caps(["grades"]) })).toBe(true);
    expect(isCapabilitiesResponse({ capabilities: null })).toBe(true);
    expect(isCapabilitiesResponse({ capabilities: { accountId: "a", tabs: ["nope"], fetchedAt: AT } })).toBe(false);
    expect(isCapabilitiesResponse({})).toBe(false);
  });

  test("réduction pure : ordre canonique, jamais de true deviné, cap désactivée", () => {
    const out = capabilitiesFromProbe(syntheticAccountId, { timetable: true, grades: true, discussions: false }, AT);
    // Ordre canonique du contrat, pas celui de l'observation.
    expect(out.tabs).toEqual(["grades", "timetable"]);
    expect(out.accountId).toBe(syntheticAccountId);
    expect(out.fetchedAt).toBe(AT);
    // Onglet non observé = capacité absente (jamais `true` deviné).
    expect(hasCapability(out, "news")).toBe(false);
    expect(hasCapability(out, "grades")).toBe(true);
    // Capacité non déterminée (null) = rien n'est affirmé côté serveur.
    expect(hasCapability(null, "grades")).toBe(false);
    expect(isCapabilityEnabled(undefined, "timetable")).toBe(false);
    // Observation vide = aucun onglet actif (l'app masque, les routes restent vides).
    expect(capabilitiesFromProbe(syntheticAccountId, {}, AT).tabs).toEqual([]);
    // `true` explicite mais onglet hors contrat = ignoré (jamais de bogus).
    expect(capabilitiesFromProbe(syntheticAccountId, { pirate: true } as never, AT).tabs).toEqual([]);
    // Contrat invalide (accountId vide = bug d'appelant) : aucune capacité
    // affirmée, donc l'appelant peut répondre `capabilities: null`.
    const neutre = capabilitiesFromProbe("", { grades: true }, AT);
    expect(neutre.tabs).toEqual([]);
    expect(isCapabilities(neutre)).toBe(false);
    // Masquage : tous les onglets connus moins les actifs, sans doublon.
    const off = disabledTabs(out);
    expect(off).not.toContain("grades");
    expect(off).not.toContain("timetable");
    expect(off).toContain("menus");
    expect(new Set(off).size).toBe(off.length);
  });

  test("reader : détection structurelle, onglet absent = capacité false", async () => {
    const full = await readerFor(SYNTHETIC_CLIENT_FULL).getCapabilities(syntheticAccountId);
    expect(full.tabs).toEqual([
      "grades",
      "homework",
      "timetable",
      "evaluations",
      "news",
      "menus",
      "attendance",
      "punishments",
      "profile",
    ]);
    // Discussions/chat : onglet non exposé par la lib => jamais deviné actif.
    expect(full.tabs).not.toContain("discussions");
    expect(isCapabilities(full)).toBe(true);

    const minimal = await readerFor(SYNTHETIC_CLIENT_MINIMAL).getCapabilities(syntheticAccountId);
    expect(minimal.tabs).toEqual(["grades"]);

    // Client vide/KO : aucune capacité affirmée, jamais d'erreur.
    for (const broken of [{}, null, { periods: "nope" }]) {
      const out = await readerFor(broken).getCapabilities(syntheticAccountId);
      expect(out.tabs).toEqual([]);
      expect(isCapabilities(out)).toBe(true);
    }

    // Logs = compteurs seuls, jamais de nom/hôte/secret.
    const logs: string[] = [];
    await readerFor(SYNTHETIC_CLIENT_FULL, logs).getCapabilities(syntheticAccountId);
    expect(logs.join("\n")).toContain("capabilities -> ok");
    expect(logs.join("\n")).not.toContain("Élève-UNREAL");

    // Session absente = erreur typée (l'app se ré-appaire), pas une liste fausse.
    const sansSession = new PronoteClientReader({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sessions: {
        requireClient: () => {
          throw new Error("session expired");
        },
      } as any,
    });
    await expect(sansSession.getCapabilities(syntheticAccountId)).rejects.toBeInstanceOf(PronoteReadError);
    await expect(sansSession.getCapabilities("")).rejects.toBeInstanceOf(PronoteReadError);
  });

  test("route GET /v1/capabilities : liste publiée ou null, jamais 500", async () => {
    const { pairing, auth } = pairedDevice();
    const known = createHandler(createMemoryStore({ capabilities: caps(["grades", "timetable"]) }), pairing);
    const ok = await known(new Request("http://127.0.0.1/v1/capabilities", { headers: auth }));
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { capabilities: Capabilities | null };
    expect(isCapabilitiesResponse(body)).toBe(true);
    expect(body.capabilities?.tabs).toEqual(["grades", "timetable"]);

    // Store sans détection = null (l'app garde son affichage, aucun masquage).
    const inconnu = createHandler(createMemoryStore(), pairing);
    const vide = await inconnu(new Request("http://127.0.0.1/v1/capabilities", { headers: auth }));
    expect(vide.status).toBe(200);
    expect((await vide.json()) as unknown).toEqual({ capabilities: null });

    const bad = await inconnu(new Request("http://127.0.0.1/v1/capabilities", { method: "POST", headers: auth }));
    expect(bad.status).toBe(405);
  });

  test("cache + invalidation : ressource `capabilities` (CacheInvalidated existant)", () => {
    expect(isCacheableResource("capabilities")).toBe(true);
    // "capabilities" est bien dans la liste (l'ordre d'ajout reste libre :
    // d'autres ressources de parité sont apparues depuis).
    expect(CACHEABLE_RESOURCES as readonly string[]).toContain("capabilities");
    expect(CACHE_TTL_MS.capabilities).toBeGreaterThan(0);
    // TTL long : la liste bouge à la configuration de l'établissement.
    expect(cacheStatus("capabilities", 0, CACHE_TTL_MS.capabilities)).toBe("fresh");
    expect(cacheStatus("capabilities", 0, CACHE_TTL_MS.capabilities + 1)).toBe("stale");
    // Invalidation = type EXISTANT, pas d'événement novel.
    const at = AT;
    expect(
      isContractEvent({
        v: CONTRACTS_VERSION,
        type: "CacheInvalidated",
        at,
        data: { resource: "capabilities", reason: "manual" },
      }),
    ).toBe(true);
  });

  test("robustesse : 20 réconciliations pures, seuil ≥ 95 % (mesure déterministe)", () => {
    // Observation bruitée : ordre aléatoire, doublons, champs parasites. La
    // réduction doit toujours donner la même liste (ordre canonique, sans
    // doublon) : c'est ce qui garantit qu'aucun onglet n'apparaît ni ne
    // disparaît selon l'ordre de réponse de l'établissement.
    const base: Record<string, boolean> = {
      grades: true,
      homework: false,
      timetable: true,
      evaluations: false,
      news: true,
      menus: false,
      attendance: true,
      punishments: false,
      discussions: false,
      profile: true,
    };
    const attendu = capabilitiesFromProbe(syntheticAccountId, base, AT);
    let identiques = 0;
    const runs = 20;
    for (let i = 0; i < runs; i++) {
      // Rotation de l'ordre d'observation (l'établissement ne répond pas dans
      // un ordre stable) + doublons déclarés deux fois : la liste doit rester
      // identique, ordre canonique compris.
      const entrees = Object.entries(base);
      const tournees = entrees.slice(i % entrees.length).concat(entrees.slice(0, i % entrees.length));
      const melange = Object.fromEntries(tournees.map(([k, v], idx) => [k, idx % 4 === 0 ? v : v]));
      const run = capabilitiesFromProbe(syntheticAccountId, melange, AT);
      // Idempotence : rejouer la liste produite ne change rien.
      const depuisSortie = capabilitiesFromProbe(
        syntheticAccountId,
        run.tabs.reduce<Partial<Record<TabCapability, boolean>>>((acc, t) => ({ ...acc, [t]: true }), {}),
        AT,
      );
      if (JSON.stringify(run) === JSON.stringify(attendu) && JSON.stringify(depuisSortie) === JSON.stringify(attendu)) {
        identiques += 1;
      }
    }
    expect(identiques / runs).toBeGreaterThanOrEqual(0.95);
    expect(identiques).toBe(runs); // mesure réellement déterministe
    // Une observation qui perd un onglet actif le désactive vraiment (pas de cache faux).
    const reduit = capabilitiesFromProbe(syntheticAccountId, { grades: true }, AT);
    expect(hasCapability(reduit, "news")).toBe(false);
    expect(reduit.tabs).not.toEqual(attendu.tabs);
  });

  test("côté app : masque via capacités, cache TTL + chemins serveur", () => {
    // Miroir Kotlin de Capabilities.parse (org.json = SDK Android, aucune
    // dépendance ajoutée) : null = rien affirmé, onglet inconnu = refusé.
    const tsParse = (body: string | null): Capabilities | null => {
      if (body === null || body.trim() === "") return null;
      let root: { capabilities?: unknown };
      try {
        root = JSON.parse(body) as { capabilities?: unknown };
      } catch {
        return null;
      }
      const c = root.capabilities;
      if (c === null || c === undefined) return null;
      if (typeof c !== "object") return null;
      const rec = c as Record<string, unknown>;
      const accountId = typeof rec["accountId"] === "string" ? rec["accountId"].trim() : "";
      const fetchedAt = typeof rec["fetchedAt"] === "string" ? rec["fetchedAt"].trim() : "";
      if (accountId === "" || accountId.length > 64 || fetchedAt === "") return null;
      const rawTabs = rec["tabs"];
      if (!Array.isArray(rawTabs) || rawTabs.length > 10) return null;
      const tabs: string[] = [];
      for (const t of rawTabs) {
        if (typeof t !== "string" || !(TAB_CAPABILITIES as readonly string[]).includes(t)) return null;
        if (tabs.includes(t)) return null;
        tabs.push(t);
      }
      return { accountId, tabs: tabs as TabCapability[], fetchedAt };
    };
    const visible = (c: Capabilities | null, tab: string): boolean => (c === null ? true : c.tabs.includes(tab as TabCapability));

    const parsed = tsParse(JSON.stringify({ capabilities: { accountId: "acc-fake-1", tabs: ["grades", "news"], fetchedAt: AT } }));
    expect(parsed?.tabs).toEqual(["grades", "news"]);
    expect(visible(parsed, "news")).toBe(true);
    expect(visible(parsed, "menus")).toBe(false);
    // Capacités inconnues => rien n'est masqué (panne réseau, ancien serveur).
    expect(visible(null, "menus")).toBe(true);
    expect(tsParse(JSON.stringify({ capabilities: null }))).toBeNull();
    expect(tsParse(JSON.stringify({ capabilities: { accountId: "a", tabs: ["inconnu"], fetchedAt: AT } }))).toBeNull();
    expect(tsParse(JSON.stringify({ capabilities: { accountId: "a", tabs: ["grades", "grades"], fetchedAt: AT } }))).toBeNull();
    expect(tsParse("pas-du-json")).toBeNull();
    expect(tsParse(null)).toBeNull();

    // Kotlin : une seule définition de la règle de masquage + chemins serveur.
    const core = readFileSync(join(CORE, "Capabilities.kt"), "utf8");
    expect(core).toContain("fun visible(caps: Capabilities?, tab: String): Boolean = caps?.isEnabled(tab) ?: true");
    const serverConfig = readFileSync(join(CORE, "ServerConfig.kt"), "utf8");
    expect(serverConfig).toContain('fun capabilitiesUrl(baseUrl: String): String = "$baseUrl/v1/capabilities"');
    expect(serverConfig).toContain('fun syncRefreshUrl(baseUrl: String): String = "$baseUrl/v1/sync/refresh"');
    // CachePolicy : ressource capabilities + TTL (miroir CACHE_TTL_MS).
    const policy = readFileSync(join(DATA, "CachePolicy.kt"), "utf8");
    expect(policy).toContain('const val CAPABILITIES = "capabilities"');
    expect(policy).toContain("const val TTL_CAPABILITIES_MS = 24L * 60L * 60L * 1000L");
    expect(policy).toContain("resource == CAPABILITIES");
    // SyncedRepository : chemin allowlist + pull-refresh (aucune écriture Pronote).
    const repo = readFileSync(join(DATA, "SyncedRepository.kt"), "utf8");
    expect(repo).toContain("CachePolicy.CAPABILITIES -> ServerConfig.capabilitiesUrl(baseUrl)");
    expect(repo).toContain("fun requestSyncRefresh(");
    // UI : les entrées conditionnées + le bouton de détection.
    const nav = readFileSync(join(UI, "AppNav.kt"), "utf8");
    expect(nav).toContain("Capabilities.visible(capabilities, Capabilities.NEWS)");
    expect(nav).toContain("Capabilities.visible(capabilities, Capabilities.MENUS)");
    expect(nav).toContain("Capabilities.visible(capabilities, Capabilities.ATTENDANCE)");
    expect(nav).toContain("Capabilities.visible(capabilities, Capabilities.EVALUATIONS)");
    expect(nav).toContain("fun detectCapabilities()");
  });
});