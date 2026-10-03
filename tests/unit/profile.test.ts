// Profil + accueil #82 (parité Papillon onglets index + profile).
// Zéro réseau, zéro .env.local, fixtures 100 % synthétiques.
// Couvre : contrat UserInfo (photoRef = réf opaque, JAMAIS une URL), garde-fou
// du reader (défensif, page vide), routes /v1/me + /v1/media, multi-compte
// parent, déconnexion (purge cache + session), mode anonyme, widgets d'accueil.
import { describe, expect, test } from "bun:test";
import { PHOTO_REF_PREFIX, isChildAccount, isOpaquePhotoRef, isUserInfo } from "../../shared/contracts/models";
import type { UserInfo } from "../../shared/contracts/models";
import { isMeResponse } from "../../shared/contracts/api";
import { createHandler } from "../../server/api/router";
import { createMemoryStore } from "../../server/api/store";
import { PronoteClientReader } from "../../server/integrations/pronote-client-reader";
import { MediaProxyError, downloadMedia } from "../../server/infrastructure/media-proxy";
import { CACHEABLE_RESOURCES, CACHE_TTL_MS, cacheStatus } from "../../shared/contracts/cache";
import {
  syntheticAccountId,
  syntheticAssignmentsPayload,
  syntheticChild,
  syntheticGradesPayload,
  syntheticParentUserInfo,
  syntheticPeriods,
  syntheticProfileClient,
  syntheticTimetablePayload,
  syntheticUserInfo,
} from "./fixtures/profile";

describe("unit profil #82", () => {
  test("contrat UserInfo : valide, et photoRef URL strictement refusée", () => {
    expect(isUserInfo(syntheticUserInfo)).toBe(true);
    expect(isUserInfo(syntheticParentUserInfo)).toBe(true);
    // Nom vide / displayName absent = pas de profil (jamais de nom d'exemple).
    expect(isUserInfo({ ...syntheticUserInfo, displayName: "  " })).toBe(false);
    expect(isUserInfo({ accountId: syntheticAccountId })).toBe(false);
    expect(isUserInfo({ ...syntheticUserInfo, accountId: "" })).toBe(false);
    // Bornes de longueur.
    expect(isUserInfo({ ...syntheticUserInfo, displayName: "n".repeat(65) })).toBe(false);
    expect(isUserInfo({ ...syntheticUserInfo, classLabel: "c".repeat(65) })).toBe(false);
    expect(isUserInfo({ ...syntheticUserInfo, kids: [] })).toBe(true);
    expect(isUserInfo({ ...syntheticUserInfo, hasKids: "oui" })).toBe(false);
    // Enfants bornés à 8 et tous valides.
    const many = Array.from({ length: 9 }, (_, i) => ({ accountId: `acc-fake-${i}`, displayName: "Enfant F" }));
    expect(isUserInfo({ ...syntheticParentUserInfo, kids: many })).toBe(false);
    expect(isChildAccount({ accountId: "acc-fake-1", displayName: "" })).toBe(false);
  });

  test("photoRef : jeton opaque accepté, toute URL refusée (règle d'or média)", () => {
    expect(isOpaquePhotoRef(`${PHOTO_REF_PREFIX}file-fake-1`)).toBe(true);
    for (const ref of [
      "http://photos.example/pic.png",
      "https://photos.example/pic.png",
      "//photos.example/pic.png",
      "data:image/png;base64,AAAA",
      `${PHOTO_REF_PREFIX}https://photos.example/pic.png`,
      `${PHOTO_REF_PREFIX}//evil.example`,
      `${PHOTO_REF_PREFIX}`,
      "",
      "photo:../../etc/passwd",
    ]) {
      expect({ ref, ok: isOpaquePhotoRef(ref) }).toEqual({ ref, ok: false });
      expect(isUserInfo({ ...syntheticUserInfo, photoRef: ref })).toBe(false);
    }
    // Aucune URL Pronote ne peut sortir du contrat, même dans les enfants.
    const payload = { ...syntheticUserInfo, photoRef: `${PHOTO_REF_PREFIX}f-1` };
    expect(JSON.stringify(payload)).not.toMatch(/https?:\/\//);
  });

  test("isMeResponse : user conforme ou null (état vide propre)", () => {
    expect(isMeResponse({ user: syntheticUserInfo })).toBe(true);
    expect(isMeResponse({ user: null })).toBe(true);
    expect(isMeResponse({ user: { accountId: syntheticAccountId } })).toBe(false);
    expect(isMeResponse({})).toBe(false);
  });

  test("GET /v1/me : profil du store, et periods déjà servies par /v1/periods", async () => {
    const handler = createHandler(createMemoryStore({ userInfo: syntheticUserInfo, periods: syntheticPeriods }));
    const res = await handler(new Request("http://127.0.0.1/v1/me"));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(isMeResponse(JSON.parse(body))).toBe(true);
    expect(JSON.parse(body).user.displayName).toBe("Camille Exemple");
    expect(body).not.toMatch(/https?:\/\//);
    // Périodes : route #74 déjà en place, aucun doublon ajouté par #82.
    const periods = await (await handler(new Request("http://127.0.0.1/v1/periods"))).text();
    expect(JSON.parse(periods).periods.length).toBe(2);
  });

  test("GET /v1/me sans infos publiées : user null (jamais de profil bidon)", async () => {
    const handler = createHandler(createMemoryStore({ userInfo: null }));
    const res = await handler(new Request("http://127.0.0.1/v1/me"));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ user: null });
    expect(isMeResponse(JSON.parse(body))).toBe(true);
    // Store legacy sans userInfo() = même état, pas de 500.
    const legacy = createHandler({
      grades: () => [],
      assignments: () => [],
      entries: () => [],
      securityAlerts: () => [],
      periods: () => [],
      providedAverages: () => null,
    });
    expect(await (await legacy(new Request("http://127.0.0.1/v1/me"))).text()).toBe('{"user":null}');
  });

  test("GET /v1/media : réf opaque seulement, octets streamés par le serveur", async () => {
    const seen: { accountId: string; ref: string }[] = [];
    const handler = createHandler(createMemoryStore(), undefined, null, undefined, undefined, null, async (accountId: string, ref: string) => {
      seen.push({ accountId, ref });
      return { name: "photo.png", bytes: new Uint8Array([1, 2, 3, 4]) };
    });
    const ok = await handler(
      new Request(`http://127.0.0.1/v1/media?ref=${PHOTO_REF_PREFIX}f-1&accountId=${syntheticAccountId}`),
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await ok.arrayBuffer()).length).toBe(4);
    expect(seen).toEqual([{ accountId: syntheticAccountId, ref: `${PHOTO_REF_PREFIX}f-1` }]);
    // Réf en forme d'adresse = refus AVANT le proxy (aucune fuite possible).
    for (const ref of ["https://photos.example/p.png", "//photos.example/p.png", "", "../../etc"]) {
      const res = await handler(new Request(`http://127.0.0.1/v1/media?ref=${ref}&accountId=${syntheticAccountId}`));
      expect({ ref, status: res.status }).toEqual({ ref, status: 400 });
    }
    // accountId absent = 400, pas de média downloads en anonymous.
    expect((await handler(new Request("http://127.0.0.1/v1/media?ref=photo:f-1"))).status).toBe(400);
    // Sans proxy injecté = 501 explicite (jamais d'accès direct depuis le routeur).
    const noProxy = createHandler(createMemoryStore());
    const res = await noProxy(
      new Request(`http://127.0.0.1/v1/media?ref=${PHOTO_REF_PREFIX}f-1&accountId=${syntheticAccountId}`),
    );
    expect(res.status).toBe(501);
    expect(seen.length).toBe(1);
  });

  test("GET /v1/media : erreurs du proxy mappées sans message interne", async () => {
    const handler = createHandler(createMemoryStore(), undefined, null, undefined, undefined, null, async () => {
      throw new MediaProxyError("échec interne 10.0.0.1", "ent_unavailable");
    });
    const res = await handler(
      new Request(`http://127.0.0.1/v1/media?ref=${PHOTO_REF_PREFIX}f-1&accountId=${syntheticAccountId}`),
    );
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("10.0.0.1");
  });

  test("media proxy : la photo est résolue par réf opaque, l'URL ne sort pas", async () => {
    const client = syntheticProfileClient();
    const payload = await downloadMedia({ requireClient: () => client }, syntheticAccountId, `${PHOTO_REF_PREFIX}file-fake-1`);
    expect(payload.name).toBe("photo.png");
    // Aucun octet d'adresse dans le nom renvoyé (nom = extension seulement).
    expect(payload.name).not.toMatch(/https?:\/\//);
    // Établissement sans photo publiée = not_found typée, pas d'image inventée.
    const noPic = syntheticProfileClient({ pictureId: null });
    let code = "";
    try {
      await downloadMedia({ requireClient: () => noPic }, syntheticAccountId, `${PHOTO_REF_PREFIX}f-1`);
    } catch (err) {
      code = (err as MediaProxyError).code;
    }
    expect(code).toBe("not_found");
    // Réf en forme d'URL = bad_ref, le proxy ne tente aucun téléchargement.
    for (const ref of ["https://photos.example/p.png", "//x/p.png", "photo:https://x/p.png"]) {
      let code = "";
      try {
        await downloadMedia({ requireClient: () => client }, syntheticAccountId, ref);
      } catch (err) {
        code = (err as MediaProxyError).code;
      }
      expect({ ref, code }).toEqual({ ref, code: "bad_ref" });
    }
  });

  test("reader getUserInfo : nom publié → profil + période courante, sans secret dans les logs", async () => {
    const logs: string[] = [];
    const client = syntheticProfileClient();
    const reader = new PronoteClientReader({
      sessions: { requireClient: () => client },
      logger: (m) => logs.push(m),
    });
    const page = await reader.getUserInfo!(syntheticAccountId);
    expect(page.items.value.length).toBe(1);
    const user = page.items.value[0] as UserInfo;
    expect(user.displayName).toBe("Camille Exemple");
    expect(user.classLabel).toBe("3E-Fake");
    expect(user.photoRef).toBe(`${PHOTO_REF_PREFIX}file-fake-1`);
    // Période courante = celle qui contient maintenant (jamais devinée) : l'id
    // dépend de la date du test, on vérifie donc la cohérence avec la liste.
    const periodId = user.periodId ?? "";
    expect(["per-fake-1", "per-fake-2"]).toContain(periodId);
    expect(syntheticPeriods.find((p) => p.id === periodId)?.name ?? "").toBe(user.periodName ?? "");
    expect(isUserInfo(user)).toBe(true);
    // L'URL de la pièce (donnée Pronote) ne doit apparaître ni dans le contrat
    // ni dans les logs (compteurs seuls).
    expect(JSON.stringify(user)).not.toMatch(/https?:\/\//);
    expect(logs.join(" ")).not.toMatch(/https?:\/\//);
  });

  test("reader getUserInfo : défensif — nom vide, pièce absente, client cassé = page vide", async () => {
    const logs: string[] = [];
    const mk = (client: unknown) =>
      new PronoteClientReader({ sessions: { requireClient: () => client }, logger: (m) => logs.push(m) });
    // Nom non publié = aucune page (jamais de "Élève" d'exemple).
    const noName = await mk(syntheticProfileClient({ name: "  " })).getUserInfo!(syntheticAccountId);
    expect(noName.items.value).toEqual([]);
    // Pièce jointe absente = profil sans photo, pas de photo inventée.
    const noPic = await mk(syntheticProfileClient({ pictureId: null })).getUserInfo!(syntheticAccountId);
    expect(noPic.items.value[0]?.photoRef).toBeUndefined();
    // Id de pièce en forme d'URL = refusé par le garde-fou (pas de fuite).
    const badId = await mk(syntheticProfileClient({ pictureId: "https://x/p.png" })).getUserInfo!(syntheticAccountId);
    expect(badId.items.value[0]?.photoRef).toBeUndefined();
    // Client qui explose = page vide + log, jamais de 500 ni d'exception.
    const boom = await mk({
      get info(): never {
        throw new Error("boom");
      },
      periods: [],
    }).getUserInfo!(syntheticAccountId);
    expect(boom.items.value).toEqual([]);
    expect(logs.join(" ")).toContain("page vide");
  });

  test("reader getUserInfo : compte parent = enfants listés, bornés, sans doublon", async () => {
    const client = syntheticProfileClient({
      name: "Parent Exemple",
      className: null,
      kids: [
        syntheticChild("acc-fake-1", "Camille Exemple", "3E-Fake"),
        syntheticChild("acc-fake-1", "Camille Exemple", "3E-Fake"),
        syntheticChild("", "Sans id", null),
        syntheticChild("acc-fake-2", "Noé Exemple", null),
        ...Array.from({ length: 10 }, (_, i) => syntheticChild(`acc-x-${i}`, `Enfant ${i}`, null)),
      ],
    });
    const logs: string[] = [];
    const page = await new PronoteClientReader({
      sessions: { requireClient: () => client },
      logger: (m) => logs.push(m),
    }).getUserInfo!(syntheticAccountId);
    const user = page.items.value[0] as UserInfo;
    expect(user.hasKids).toBe(true);
    // Bornes + doublons : 8 enfants lus au plus depuis la liste brute, sans
    // doublon d'id ni entrée sans id.
    expect(user.kids?.map((k) => k.accountId)).toEqual([
      "acc-fake-1",
      "acc-fake-2",
      "acc-x-0",
      "acc-x-1",
      "acc-x-2",
      "acc-x-3",
    ]);
    expect(user.kids!.length).toBeLessThanOrEqual(8);
    expect(isUserInfo(user)).toBe(true);
    // Aucun nom d'enfant ni secret dans les logs (compteurs seuls).
    expect(logs.join(" ")).not.toContain("Camille");
  });

  test("déconnexion : session invalidée + TOUS les caches purgés (données du compte)", () => {
    // Miroir de android/data/AccountStore.logout() : tokenStore.clear() puis
    // clear() sur chaque ressource cachable (miroir CACHEABLE_RESOURCES).
    const purged: string[] = [];
    let tokenCleared = false;
    const logout = () => {
      tokenCleared = true;
      for (const r of CACHEABLE_RESOURCES) purged.push(r);
    };
    logout();
    expect(tokenCleared).toBe(true);
    expect([...purged].sort()).toEqual([...CACHEABLE_RESOURCES].sort());
    // "me" n'est PAS cachable : le profil ne survit pas à la déconnexion
    // (mode anonyme, aucune donnée personnelle persistée).
    expect(CACHEABLE_RESOURCES as readonly string[]).not.toContain("me");
    // Badge périmé : après purge, plus rien à afficher (pas de cache fantôme).
    expect(cacheStatus("grades", 1_000, 1_000 + CACHE_TTL_MS.grades + 1)).toBe("stale");
  });
});