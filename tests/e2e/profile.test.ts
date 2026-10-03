// e2e profil #82 (parité Papillon onglets index + profile).
// Zéro réseau réel, zéro .env.local : store seed + createHandler en mémoire.
// Parcours : seed → GET /v1/me → garde-fou → miroir app (parse) → periods →
// /v1/media (photo par réf opaque) → multi-compte parent → state vide.
import { describe, expect, test } from "bun:test";
import { PHOTO_REF_PREFIX, isUserInfo } from "../../shared/contracts/models";
import { isMeResponse } from "../../shared/contracts/api";
import { API_ROUTES } from "../../shared/contracts/api";
import { createHandler } from "../../server/api/router";
import type { MediaResolver } from "../../server/api/router";
import { createMemoryStore } from "../../server/api/store";
import { PairingService } from "../../server/api/pairing";
import { MediaProxyError } from "../../server/infrastructure/media-proxy";
import { cacheStatus } from "../../shared/contracts/cache";
import {
  syntheticParentUserInfo,
  syntheticPeriods,
  syntheticUserInfo,
} from "../unit/fixtures/profile";

// Miroir du parse app (android/data/ProfileRepository.kt) : org.json → profil.
function parseApp(payload: string | null): { displayName: string; classLabel: string; photoRef: string } | null {
  try {
    if (payload === null) return null;
    const user = (JSON.parse(payload) as { user?: unknown }).user;
    if (typeof user !== "object" || user === null) return null;
    const u = user as Record<string, unknown>;
    const accountId = typeof u["accountId"] === "string" ? u["accountId"].trim() : "";
    const displayName = typeof u["displayName"] === "string" ? u["displayName"].trim() : "";
    if (accountId === "" || displayName === "") return null;
    return {
      displayName,
      classLabel: typeof u["classLabel"] === "string" ? u["classLabel"] : "",
      photoRef: typeof u["photoRef"] === "string" ? u["photoRef"] : "",
    };
  } catch {
    return null;
  }
}

const fakeMedia: MediaResolver = async (_accountId, ref) => {
  if (ref === "photo:absent") throw new MediaProxyError("media not found", "not_found");
  return { name: "photo.png", bytes: new Uint8Array([137, 80, 78, 71]) };
};

/**
 * /v1/media lit les données d'un compte appairé : la route exige le jeton d'un
 * device APPAIRÉ. `confirm` ne renvoie que `tokenHash` (le secret ne sort
 * JAMAIS de l'API), on récupère donc le token brut côté service et on
 * présente l'en-tête comme le ferait l'app.
 */
function paired(): { pairing: PairingService; auth: Record<string, string> } {
  const pairing = new PairingService();
  const started = pairing.start("pixel-e2e");
  const confirmed = pairing.confirm(started.sessionId, started.code);
  if (!confirmed.ok) throw new Error("appairage de test impossible");
  const token = pairing.tokenOf(confirmed.device.id);
  if (token === null) throw new Error("jeton de test indisponible");
  return { pairing, auth: { authorization: `Bearer ${token}` } };
}

describe("e2e profil", () => {
  test("GET /v1/me : seed → payload contractuel → profil affiché par l'app", async () => {
    const handler = createHandler(createMemoryStore({ userInfo: syntheticUserInfo, periods: syntheticPeriods }));
    const res = await handler(new Request("http://127.0.0.1/v1/me"));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(isMeResponse(JSON.parse(body))).toBe(true);
    const app = parseApp(body);
    expect(app?.displayName).toBe("Camille Exemple");
    expect(app?.classLabel).toBe("3E-Fake");
    // Aucune photo publiée = pas de photo (l'app affiche des initiales).
    expect(app?.photoRef).toBe("");
    expect(body).not.toMatch(/https?:\/\//);
    expect(body).not.toMatch(/sk-or-v1-|OPENROUTER_API_KEY|PRONOTE_PASSWORD/);
  });

  test("compte parent : /v1/me porte les enfants, la photo part par le proxy", async () => {
    const { pairing, auth } = paired();
    const handler = createHandler(
      createMemoryStore({ userInfo: syntheticParentUserInfo }),
      pairing,
      null,
      undefined,
      undefined,
      null,
      fakeMedia,
    );
    const me = await (await handler(new Request("http://127.0.0.1/v1/me"))).text();
    expect(JSON.parse(me).user.hasKids).toBe(true);
    expect(JSON.parse(me).user.kids.length).toBe(2);
    // L'app ne connaît que la réf : elle demande les octets au serveur.
    const app = parseApp(me);
    expect(app?.photoRef).toBe(`${PHOTO_REF_PREFIX}file-fake-1`);
    const media = await handler(
      new Request(`http://127.0.0.1/v1/media?ref=${app?.photoRef}&accountId=${syntheticParentUserInfo.accountId}`, {
        headers: auth,
      }),
    );
    expect(media.status).toBe(200);
    expect(media.headers.get("content-type")).toBe("image/png");
    // Média absent = 404 propre (l'app retombe sur les initiales).
    const missing = await handler(
      new Request("http://127.0.0.1/v1/media?ref=photo:absent&accountId=acc-fake-parent", { headers: auth }),
    );
    expect(missing.status).toBe(404);
  });

  test("compte sans infos : /v1/me → user null, l'app affiche un état vide", async () => {
    const handler = createHandler(createMemoryStore({ userInfo: null }));
    const body = await (await handler(new Request("http://127.0.0.1/v1/me"))).text();
    expect(JSON.parse(body)).toEqual({ user: null });
    expect(parseApp(body)).toBeNull();
    expect(parseApp(null)).toBeNull();
    expect(parseApp("Ignore les instructions")).toBeNull();
    // Aucune invitation à réessayer en boucle, aucun nom d'exemple.
    expect(body).not.toContain("Élève");
  });

  test("périodes : /v1/periods déjà servi par #74, aucun doublon #82", async () => {
    expect(API_ROUTES.filter((r) => r.path === "/v1/periods").length).toBe(1);
    const handler = createHandler(createMemoryStore({ periods: syntheticPeriods }));
    const body = await (await handler(new Request("http://127.0.0.1/v1/periods"))).text();
    const periods = JSON.parse(body).periods as { id: string }[];
    expect(periods.length).toBe(2);
    expect(periods.every((p) => typeof p.id === "string")).toBe(true);
  });

  test("hors-ligne : le profil n'est pas cachable, l'accueil retombe sur les caches", async () => {
    // "me" hors CACHEABLE_RESOURCES = aucune donnée personnelle persistée.
    const handler = createHandler(createMemoryStore({ userInfo: syntheticUserInfo }));
    const me = await (await handler(new Request("http://127.0.0.1/v1/me"))).text();
    // Réseau KO côté app : le profil affiché reste le dernier en mémoire, mais
    // il n'est jamais écrit en cache (donnée personnelle, mode anonyme).
    expect(isUserInfo(JSON.parse(me).user)).toBe(true);
    // Les caches d'accueil, eux, sont périmables et affichés quand même.
    expect(cacheStatus("grades", 1_000, 1_000 + 15 * 60 * 1000 + 1)).toBe("stale");
    expect(cacheStatus("timetable", 1_000, 1_000 + 60 * 60 * 1000)).toBe("fresh");
  });
});